const BN = require("bn.js");
const { sha3 } = require("web3-utils");
const abiCoder = require("web3-eth-abi");
const { getCache } = require("./src/lib/ttlcache.js");

const ONE_DAY_IN_SECONDS = 24 * 60 * 60 * 1000;
let stateByKey = getCache(ONE_DAY_IN_SECONDS);

function _setCacheTimeout(ttlms) {
  stateByKey = getCache(ttlms);
}

function _getABIs(key) {
  const state = stateByKey.get(key);
  if (state) {
    return state.savedABIs;
  }
}

function _typeToString(input) {
  let inputString = input.type;
  if (input.type.includes("tuple")) {
    inputString = "(" + input.components.map(_typeToString).join(",") + ")";
    inputString += input.type.substring(5);
  }
  return inputString;
}

function _hasABI(key) {
  // return undef in case it doesn't exist, vs. false
  if (stateByKey.has(key)) {
    return true;
  }
}

function _addABI(key, abiArray) {
  const state = {
    savedABIs: [],
    methodIDs: {},
  };

  if (Array.isArray(abiArray)) {
    // Iterate new abi to generate method id"s
    abiArray.map(function (abi) {
      if (abi.name) {
        const signature = sha3(
          abi.name +
          "(" +
          abi.inputs
            .map(_typeToString)
            .join(",") +
          ")"
        );
        if (abi.type === "event") {
          state.methodIDs[signature.slice(2)] = abi;
        } else {
          state.methodIDs[signature.slice(2, 10)] = abi;
        }
      }
    });

    state.savedABIs = abiArray;

    stateByKey.set(key, state);
  } else {
    throw new Error("Expected ABI array, got " + typeof abiArray);
  }
}

function _removeABI(key) {
  stateByKey.delete(key);
}

function _removeAllABIs() {
  stateByKey.clear();
}

function _getMethodIDs(key) {
  const state = stateByKey.get(key);
  if (state) {
    return state.methodIDs;
  }
}

function _decodeMethod(key, data) {
  const state = stateByKey.get(key);
  if (!state) {
    return;
  }

  const methodID = data.slice(2, 10);
  const abiItem = state.methodIDs[methodID];
  if (abiItem) {
    let decoded = abiCoder.decodeParameters(abiItem.inputs, data.slice(10));

    let retData = {
      name: abiItem.name,
      params: [],
    };

    for (let i = 0; i < decoded.__length__; i++) {
      let param = decoded[i];
      let parsedParam = param;
      const isUint = abiItem.inputs[i].type.indexOf("uint") === 0;
      const isInt = abiItem.inputs[i].type.indexOf("int") === 0;
      const isAddress = abiItem.inputs[i].type.indexOf("address") === 0;

      if (isUint || isInt) {
        const isArray = Array.isArray(param);

        if (isArray) {
          parsedParam = param.map(val => new BN(val).toString());
        } else {
          parsedParam = new BN(param).toString();
        }
      }

      // Addresses returned by web3 are randomly cased so we need to standardize and lowercase all
      if (isAddress) {
        const isArray = Array.isArray(param);

        if (isArray) {
          parsedParam = param.map(_ => _.toLowerCase());
        } else {
          parsedParam = param.toLowerCase();
        }
      }

      retData.params.push({
        name: abiItem.inputs[i].name,
        value: parsedParam,
        type: abiItem.inputs[i].type,
      });
    }

    return retData;
  }
}

function _decodeLogItem(key, logItem) {
  const state = stateByKey.get(key);
  if (!state) {
    return;
  }

  if (logItem.topics.length > 0) {
    const methodID = logItem.topics[0].slice(2);
    const method = state.methodIDs[methodID];
    if (method) {
      const logData = logItem.data;
      let decodedParams = [];
      let dataIndex = 0;
      let topicsIndex = 1;

      let dataTypes = [];
      method.inputs.map(function (input) {
        if (!input.indexed) {
          dataTypes.push(input.type);
        }
      });

      const decodedData = abiCoder.decodeParameters(
        dataTypes,
        logData.slice(2)
      );

      // Loop topic and data to get the params
      method.inputs.map(function (param) {
        let decodedP = {
          name: param.name,
          type: param.type,
        };

        if (param.indexed) {
          decodedP.value = logItem.topics[topicsIndex];
          topicsIndex++;
        } else {
          decodedP.value = decodedData[dataIndex];
          dataIndex++;
        }

        if (param.type === "address") {
          decodedP.value = decodedP.value.toLowerCase();
          // 42 because len(0x) + 40
          if (decodedP.value.length > 42) {
            let toRemove = decodedP.value.length - 42;
            let temp = decodedP.value.split("");
            temp.splice(2, toRemove);
            decodedP.value = temp.join("");
          }
        }

        if (
          param.type === "uint256" ||
          param.type === "uint8" ||
          param.type === "int"
        ) {
          // ensure to remove leading 0x for hex numbers
          if (typeof decodedP.value === "string" && decodedP.value.startsWith("0x")) {
            decodedP.value = new BN(decodedP.value.slice(2), 16).toString(10);
          } else {
            decodedP.value = new BN(decodedP.value).toString(10);
          }

        }

        decodedParams.push(decodedP);
      });

      return {
        name: method.name,
        events: decodedParams,
        address: logItem.address,
      };
    }
  }
}

function _decodeLogs(key, logs) {
  const result = logs.map(logItem => _decodeLogItem(key, logItem)).filter(decoded => decoded);
  if (result.length > 0) {
    return result;
  }
}

module.exports = {
  setCacheTimeout: _setCacheTimeout,
  hasABI: _hasABI,
  getABIs: _getABIs,
  addABI: _addABI,
  getMethodIDs: _getMethodIDs,
  decodeMethod: _decodeMethod,
  decodeLogs: _decodeLogs,
  decodeLogItem: _decodeLogItem,
  removeABI: _removeABI,
  removeAllABIs: _removeAllABIs,
};

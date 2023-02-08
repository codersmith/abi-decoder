// a storage-unbounded ttl cache that is not an lru-cache,
// from https://www.npmjs.com/package/lru-cache
const getCache = (defaultTtlMs) => {
  const cache = {
    data: new Map(),
    timers: new Map(),
    set: (k, v, ttlms = defaultTtlMs) => {
      if (cache.timers.has(k)) {
        clearTimeout(cache.timers.get(k));
      }
      cache.timers.set(
        k,
        setTimeout(() => cache.delete(k), ttlms)
      );
      cache.data.set(k, v);
    },
    get: (k) => cache.data.get(k),
    has: (k) => cache.data.has(k),
    delete: (k) => {
      if (cache.timers.has(k)) {
        clearTimeout(cache.timers.get(k));
      }
      cache.timers.delete(k);
      return cache.data.delete(k);
    },
    clear: () => {
      cache.data.clear();
      for (const v of cache.timers.values()) {
        clearTimeout(v);
      }
      cache.timers.clear();
    },
    size: () => {
      return cache.data.size;
    },
  };
  return cache;
};

module.exports = {
  getCache,
};

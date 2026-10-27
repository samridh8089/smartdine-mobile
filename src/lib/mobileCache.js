/**
 * High-speed in-memory & session cache for instant mobile screen renders (Stale-While-Revalidate).
 * Eliminates blank screens and blocking loaders when switching tabs or reopening screens.
 */

const cacheStore = new Map();

export const mobileCache = {
  get(key) {
    if (!key) return null;
    const entry = cacheStore.get(key);
    if (!entry) return null;
    // Data is usable immediately
    return entry.data;
  },

  set(key, data) {
    if (!key) return;
    cacheStore.set(key, {
      data,
      timestamp: Date.now()
    });
  },

  has(key) {
    return cacheStore.has(key);
  },

  clear(prefix) {
    if (!prefix) {
      cacheStore.clear();
      return;
    }
    for (const key of cacheStore.keys()) {
      if (key.startsWith(prefix)) {
        cacheStore.delete(key);
      }
    }
  }
};

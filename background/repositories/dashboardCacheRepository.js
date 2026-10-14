(() => {
  const KEY = 'dashboardCache';

  self.DashboardCacheRepository = Object.freeze({
    async get() {
      const stored = await chrome.storage.local.get(KEY);
      return stored[KEY] || null;
    },

    set(data) {
      return chrome.storage.local.set({
        [KEY]: { data, fetchedAt: new Date().toISOString() },
      });
    },

    clear() {
      return chrome.storage.local.remove(KEY);
    },
  });
})();

(() => {
  async function getDashboardData({ refresh = false } = {}) {
    if (!refresh) {
      const cached = await DashboardCacheRepository.get();
      if (cached) {
        return {
          data: cached.data,
          cached: true,
          cachedAt: cached.fetchedAt,
        };
      }
    }

    const data = await buildDashboardFromStorage();
    const cachedAt = new Date().toISOString();
    await DashboardCacheRepository.set(data);
    return { data, cached: false, cachedAt };
  }

  self.DashboardQueryService = Object.freeze({ getDashboardData });
})();

(() => {
  const handlers = {
    async requestTokenRefresh(request) {
      const token = await AuthenticationService.refresh(request.staleToken || null);
      return { success: true, token };
    },

    async getStudentPhoto(request) {
      const data = await buscarFotoDoAluno(request.matricula, request.idTurma);
      return { success: true, data };
    },

    async getDashboardData(request) {
      const refresh = request.action === 'refreshDashboardData' || request.forceRefresh;
      const result = await DashboardQueryService.getDashboardData({ refresh });
      return { success: true, ...result };
    },
  };

  function resolveHandler(action) {
    if (action === 'requestTokenRefresh') return handlers.requestTokenRefresh;
    if (action === 'getStudentPhoto') return handlers.getStudentPhoto;
    if (action === 'getDashboardData' || action === 'refreshDashboardData') {
      return handlers.getDashboardData;
    }
    return null;
  }

  self.RuntimeMessageController = Object.freeze({
    register() {
      chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        const handler = resolveHandler(request?.action);
        if (!handler) return false;

        handler(request)
          .then(sendResponse)
          .catch((error) => {
            const message = AppErrors.report(error, `Ação ${request.action} falhou`);
            sendResponse({ success: false, error: message });
          });
        return true;
      });
    },
  });
})();

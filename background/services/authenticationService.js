(() => {
  async function ensureAuthenticated() {
    let { nrDoc } = await chrome.storage.local.get('nrDoc');
    let token = null;

    try {
      token = await AuthManager.getValidToken();
    } catch (error) {
      console.info('[Background] Token indisponível:', error.message);
    }

    if (!token || !nrDoc) {
      token = await trySilentTokenRefresh(token);
      ({ nrDoc } = await chrome.storage.local.get('nrDoc'));
    }

    if (token && nrDoc) {
      try {
        await listarEscolasProfessor(nrDoc);
        return { token, nrDoc };
      } catch (error) {
        console.warn('[Background] Validação da sessão falhou:', error.message);
        token = await trySilentTokenRefresh(token);
        ({ nrDoc } = await chrome.storage.local.get('nrDoc'));
      }
    }

    if (token && nrDoc) return { token, nrDoc };
    throw new Error('Autenticação não concluída. Por favor, tente novamente.');
  }

  self.AuthenticationService = Object.freeze({
    ensureAuthenticated,
    refresh(staleToken = null) {
      return trySilentTokenRefresh(staleToken);
    },
  });
})();

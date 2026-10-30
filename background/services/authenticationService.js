(() => {
  const NR_DOC_CAPTURE_TIMEOUT = 15000;

  async function waitForNrDoc(timeout = NR_DOC_CAPTURE_TIMEOUT) {
    const current = await chrome.storage.local.get('nrDoc');
    if (current.nrDoc) return current.nrDoc;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, nrDoc = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        chrome.storage.onChanged.removeListener(storageListener);
        error ? reject(error) : resolve(nrDoc);
      };

      const storageListener = (changes, namespace) => {
        if (namespace === 'local' && changes.nrDoc?.newValue) {
          finish(null, changes.nrDoc.newValue);
        }
      };
      const timeoutId = setTimeout(() => {
        finish(new Error('Não foi possível capturar o documento do professor. Abra o portal EscolaRS e aguarde o carregamento.'));
      }, timeout);

      chrome.storage.onChanged.addListener(storageListener);
      // Fecha a janela entre a leitura inicial e o registro do listener.
      chrome.storage.local.get('nrDoc').then(({ nrDoc }) => {
        if (nrDoc) finish(null, nrDoc);
      }).catch((error) => finish(error));
    });
  }

  async function ensureAuthenticated() {
    let { nrDoc } = await chrome.storage.local.get('nrDoc');
    let token = null;

    try {
      token = await AuthManager.getValidToken();
    } catch (error) {
      console.info('[Background] Token indisponível:', error.message);
    }

    if (!token) {
      token = await trySilentTokenRefresh(token);
      ({ nrDoc } = await chrome.storage.local.get('nrDoc'));
    }

    // A primeira captura pode salvar o token antes do nrDoc. Aguarda a gravação
    // assíncrona do content script/webRequest antes de desistir da autenticação.
    if (token && !nrDoc) {
      try {
        nrDoc = await waitForNrDoc();
      } catch (error) {
        AppErrors.report(error, '[Background] Captura inicial do nrDoc');
        token = await trySilentTokenRefresh(token);
        ({ nrDoc } = await chrome.storage.local.get('nrDoc'));
        if (token && !nrDoc) nrDoc = await waitForNrDoc();
      }
    }

    if (token && nrDoc) {
      try {
        await listarEscolasProfessor(nrDoc);
        return { token, nrDoc };
      } catch (error) {
        AppErrors.report(error, 'Validação da sessão falhou');
        token = await trySilentTokenRefresh(token);
        ({ nrDoc } = await chrome.storage.local.get('nrDoc'));
        if (token && !nrDoc) nrDoc = await waitForNrDoc();
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

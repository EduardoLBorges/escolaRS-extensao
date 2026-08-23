/**
 * AuthManager — Gerenciador Central de Autenticação
 *
 * Única fonte de verdade para o token Bearer da extensão.
 * Funciona em dois contextos:
 *   - Service Worker (background.js): realiza o refresh diretamente via trySilentTokenRefresh.
 *   - Páginas de extensão (dashboard, chamada, avaliacoes): delega o refresh ao SW via sendMessage.
 *
 * Carregado antes de api/escolaRS.js em todos os contextos.
 */
const AuthManager = (() => {
  // ── Estado Interno ────────────────────────────────────────────────────────

  /** Token em memória. Invalidado via storage.onChanged. */
  let _token = null;

  /** Singleton de refresh para evitar múltiplas renovações simultâneas. */
  let _refreshPromise = null;

  /** Verdadeiro quando executando no Service Worker (sem DOM). */
  const _isSW = typeof window === 'undefined';

  const LOG = '[AuthManager]';

  // ── Sincronização com Storage ─────────────────────────────────────────────

  // Mantém o cache em memória sempre sincronizado com o storage.
  // Quando o background captura um novo token via webRequest, todos os contextos
  // são notificados automaticamente por este listener.
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && 'escolaRsToken' in changes) {
        _token = changes.escolaRsToken.newValue || null;
        if (_token) {
          console.log(`${LOG} Cache atualizado via storage.onChanged.`);
        }
      }
    });
  }

  // ── Helpers Privados ──────────────────────────────────────────────────────

  async function _readStorage() {
    const { escolaRsToken } = await chrome.storage.local.get('escolaRsToken');
    _token = escolaRsToken || null;
    return _token;
  }

  /**
   * Executa a renovação de token, garantindo apenas uma por vez.
   * SW: chama trySilentTokenRefresh diretamente (definida em api/escolaRS.js).
   * Página: envia mensagem ao background para executar o refresh.
   * @param {string|null} staleToken - Token que causou falha (para comparação).
   * @returns {Promise<string|null>}
   */
  async function _doRefresh(staleToken = null) {
    if (_refreshPromise) {
      console.log(`${LOG} Renovação já em curso. Aguardando...`);
      return _refreshPromise;
    }

    _refreshPromise = (async () => {
      try {
        if (_isSW) {
          // No Service Worker, trySilentTokenRefresh está no escopo global (de escolaRS.js).
          // A referência é resolvida em tempo de execução — não em tempo de definição — por isso funciona
          // mesmo que authManager.js seja importado antes de escolaRS.js via importScripts.
          if (typeof trySilentTokenRefresh === 'function') {
            console.log(`${LOG} SW: iniciando trySilentTokenRefresh...`);
            return await trySilentTokenRefresh(staleToken);
          }
          console.error(`${LOG} trySilentTokenRefresh não encontrada no escopo do SW.`);
          return null;
        }

        // Contexto de página: delega ao Service Worker via sendMessage.
        console.log(`${LOG} Página: solicitando refresh ao background...`);
        return await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: 'requestTokenRefresh', staleToken },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error(`${LOG} Erro ao contatar background:`, chrome.runtime.lastError.message);
                return resolve(null);
              }
              resolve(response?.token || null);
            }
          );
        });
      } finally {
        _refreshPromise = null;
      }
    })();

    return _refreshPromise;
  }

  // ── API Pública ───────────────────────────────────────────────────────────

  return {
    /**
     * Retorna um token válido para uso imediato.
     * Ordem de resolução: cache em memória → storage → refresh ativo.
     * @returns {Promise<string>}
     * @throws {Error} Se não for possível obter um token válido
     */
    async getValidToken() {
      if (_token) return _token;

      const stored = await _readStorage();
      if (stored) return stored;

      console.log(`${LOG} Token ausente. Tentando renovação...`);
      const refreshed = await _doRefresh(null);
      if (refreshed) {
        _token = refreshed;
        return refreshed;
      }

      throw new Error('Sessão não encontrada. Abra o portal EscolaRS e faça login.');
    },

    /**
     * Chamado quando uma requisição retornou 401 ou 403.
     * Invalida o cache, verifica se há token mais recente no storage,
     * ou dispara uma renovação completa.
     * @param {string} staleToken - O token que causou a falha de auth.
     * @returns {Promise<string|null>} Novo token, ou null se falhar.
     */
    async handleAuthFailure(staleToken) {
      console.warn(`${LOG} Falha de autenticação. Verificando token...`);

      // Invalida o cache se ainda é o token que falhou.
      if (_token === staleToken) _token = null;

      // Outra requisição paralela pode já ter renovado antes de nós.
      const stored = await _readStorage();
      if (stored && stored !== staleToken) {
        console.log(`${LOG} Token mais recente já disponível no storage.`);
        return stored;
      }

      return _doRefresh(staleToken);
    },

    /**
     * Atualiza o cache em memória com um novo token.
     * Chamado pelo background após capturar um token via webRequest ou refresh_token.
     * @param {string|null} token
     */
    update(token) {
      _token = token || null;
    },

    /**
     * Invalida o cache em memória, forçando a próxima leitura a ir ao storage.
     */
    invalidate() {
      _token = null;
    },
  };
})();

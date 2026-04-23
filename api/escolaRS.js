/**
 * API Module - EscolaRS
 * Responsável apenas por fazer chamadas à API do EscolaRS
 */

const API_BASE_URL = 'https://secweb.procergs.com.br/ise-escolars-professor/rest/professor';
const API_TIMEOUT = 30000; // 30 segundos de timeout
const MAX_RETRY_ATTEMPTS = 2;
const TOKEN_REFRESH_TIMEOUT = 15000; // 15 segundos para renovação silenciosa
const PORTAL_URL = 'https://professor.escola.rs.gov.br/';
const LOG_PREFIX = '[EscolaRS API]';

// Singleton para garantir que apenas uma renovação ocorra por vez
let activeTokenRefreshPromise = null;

// Cache do último token validado com sucesso nesta instância do Worker
let lastWorkingToken = null;

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Lê o token atual do chrome.storage.local.
 * @returns {Promise<string|null>}
 */
async function getTokenFromStorage() {
  const { escolaRsToken } = await chrome.storage.local.get('escolaRsToken');
  return escolaRsToken || null;
}

/**
 * Monta o objeto de opções para o fetch.
 * @param {string} token - Token de autenticação.
 * @param {Object} options - Opções customizadas (method, body).
 * @param {AbortSignal} signal - Sinal de cancelamento.
 * @returns {Object}
 */
function buildFetchOptions(token, options, signal) {
  const fetchOpts = {
    method: options.method || 'GET',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json',
    },
    signal,
  };

  if (options.body) {
    fetchOpts.body = JSON.stringify(options.body);
  }

  return fetchOpts;
}

// ─── Core Fetch ─────────────────────────────────────────────────────

/**
 * Faz uma chamada genérica à API do EscolaRS com timeout e lógica de repetição para token expirado.
 * @param {string} endpoint - Endpoint relativo.
 * @param {string} token - Token de autenticação inicial.
 * @param {Object} [options={}] - Opções customizadas para o fetch.
 * @param {number} [timeout=API_TIMEOUT] - Timeout em milissegundos.
 * @returns {Promise<Object>} Resposta JSON da API.
 */
async function fetchEscolaRS(endpoint, token, options = {}, timeout = API_TIMEOUT) {
  const url = `${API_BASE_URL}/${endpoint}`;
  let currentToken = lastWorkingToken || token;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
      response = await fetch(url, buildFetchOptions(currentToken, options, controller.signal));
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Timeout na requisição (${timeout}ms) para: ${endpoint}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.ok) {
      lastWorkingToken = currentToken;
      return response.json();
    }

    // Tenta renovar o token apenas na primeira tentativa (e se permitido)
    if (isAuthError(response.status) && attempt === 1 && options.autoRefreshToken !== false) {
      const refreshedToken = await tryRecoverToken(currentToken, endpoint);
      if (refreshedToken) {
        currentToken = refreshedToken;
        continue;
      }
    }

    const errorBody = await readErrorBody(response);
    throw new Error(`Erro na API (${response.status}: ${response.statusText}). Detalhes: ${errorBody}`);
  }
}

function isAuthError(status) {
  return status === 401 || status === 403;
}

async function readErrorBody(response) {
  try { return await response.text(); } catch { return ''; }
}

/**
 * Tenta recuperar um token válido.
 * @param {string} staleToken - O token que falhou.
 * @param {string} endpoint - Endpoint para log.
 * @returns {Promise<string|null>} Novo token ou null se falhar.
 */
async function tryRecoverToken(staleToken, endpoint) {
  console.warn(`${LOG_PREFIX} Erro de auth em: ${endpoint}. Verificando renovação...`);

  try {
    // 1. Checa se o token atual já mudou (outra requisição renovou?)
    const storedToken = await getTokenFromStorage();
    if (storedToken && storedToken !== staleToken) {
      console.log(`${LOG_PREFIX} Token novo já presente. Retentando...`);
      return storedToken;
    }

    // 2. Dispara renovação única
    console.log(`${LOG_PREFIX} Iniciando renovação única via popup...`);
    const newToken = await trySilentTokenRefresh(staleToken);
    
    if (newToken) {
      console.log(`${LOG_PREFIX} Token renovado com sucesso.`);
      return newToken;
    }
  } catch (e) {
    console.error(`${LOG_PREFIX} Falha na recuperação de token:`, e);
  }

  return null;
}

// ─── Token Refresh Singleton ────────────────────────────────────────

/**
 * Tenta forçar a renovação do token de forma invisível/rápida.
 */
async function trySilentTokenRefresh(staleToken = null) {
  if (activeTokenRefreshPromise) {
    console.log(`${LOG_PREFIX} Aguardando renovação já em curso...`);
    return activeTokenRefreshPromise;
  }

  activeTokenRefreshPromise = (async () => {
    let windowId = null;
    let storageListener = null;
    let timeoutId = null;

    const cleanup = () => {
      if (storageListener) chrome.storage.onChanged.removeListener(storageListener);
      if (timeoutId) clearTimeout(timeoutId);
      if (windowId) chrome.windows.remove(windowId).catch(() => {});
      activeTokenRefreshPromise = null;
    };

    try {
      // Checagem extra de storage logo no início do IIFE
      const storedToken = await getTokenFromStorage();
      if (staleToken && storedToken && storedToken !== staleToken) {
        return storedToken;
      }

      return await new Promise((resolve, reject) => {
        storageListener = (changes, namespace) => {
          if (namespace === 'local' && changes.escolaRsToken?.newValue) {
            const newToken = changes.escolaRsToken.newValue;
            cleanup();
            resolve(newToken);
          }
        };

        chrome.storage.onChanged.addListener(storageListener);

        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error('Timeout na renovação do token.'));
        }, TOKEN_REFRESH_TIMEOUT);

        chrome.windows.create(
          { url: PORTAL_URL, state: 'normal', width: 400, height: 600, focused: true, type: 'popup' },
          (win) => {
            if (chrome.runtime.lastError) {
              cleanup();
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              windowId = win.id;
            }
          }
        );
      });
    } catch (err) {
      cleanup();
      throw err;
    } finally {
      activeTokenRefreshPromise = null;
    }
  })();

  return activeTokenRefreshPromise;
}

// ─── Public API Functions ───────────────────────────────────────────

async function listarEscolasProfessor(nrDoc, token) {
  return fetchEscolaRS(`listarEscolasDoProfessorEChamadas/${nrDoc}`, token);
}

async function listarResultadosTurma(turmaId, discId, idRecHumano, token, options = {}) {
  return fetchEscolaRS(
    `listarAulasDaTurmaComResultado/${turmaId}/${discId}/${idRecHumano}/false`,
    token,
    options
  );
}

async function registrarChamadaAula(turmaId, discId, data, idRecHumano, payload, token) {
  return fetchEscolaRS(`chamada`, token, { method: 'POST', body: payload });
}

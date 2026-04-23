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
 * @param {Object} [options={}] - Opções customizadas para o fetch (método, body, etc).
 * @param {number} [timeout=API_TIMEOUT] - Timeout em milissegundos.
 * @returns {Promise<Object>} Resposta JSON da API.
 * @throws {Error} Se a requisição falhar, expirar o timeout, ou a repetição não for bem-sucedida.
 */
async function fetchEscolaRS(endpoint, token, options = {}, timeout = API_TIMEOUT) {
  const url = `${API_BASE_URL}/${endpoint}`;
  let currentToken = token;

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
      return response.json();
    }

    // Tenta renovar o token apenas na primeira tentativa
    if (isAuthError(response.status) && attempt === 1) {
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

/**
 * Verifica se o status HTTP indica erro de autenticação.
 * @param {number} status
 * @returns {boolean}
 */
function isAuthError(status) {
  return status === 401 || status === 403;
}

/**
 * Lê o corpo da resposta de erro de forma segura.
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function readErrorBody(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Tenta recuperar um token válido — primeiro do storage, depois via renovação silenciosa.
 * @param {string} staleToken - O token que falhou.
 * @param {string} endpoint - Endpoint para log.
 * @returns {Promise<string|null>} Novo token ou null se falhar.
 */
async function tryRecoverToken(staleToken, endpoint) {
  console.warn(`${LOG_PREFIX} Erro de auth em: ${endpoint}. Verificando renovação...`);

  try {
    // 1. Checa se outra requisição paralela já renovou o token
    const storedToken = await getTokenFromStorage();
    if (storedToken && storedToken !== staleToken) {
      console.log(`${LOG_PREFIX} Token novo detectado no storage. Retentando imediatamente...`);
      return storedToken;
    }

    // 2. Se o token no storage ainda é o mesmo (velho), dispara a renovação
    console.log(`${LOG_PREFIX} Token ainda é o mesmo. Iniciando renovação única...`);
    await trySilentTokenRefresh(staleToken);

    // 3. Pega o token atualizado após a renovação
    const updatedToken = await getTokenFromStorage();
    if (updatedToken) {
      console.log(`${LOG_PREFIX} Continuando após renovação...`);
      return updatedToken;
    }
  } catch (e) {
    console.error(`${LOG_PREFIX} Falha no processo de renovação:`, e);
  }

  return null;
}

// ─── Token Refresh Singleton ────────────────────────────────────────

let activeTokenRefreshPromise = null;

/**
 * Tenta forçar a renovação do token de forma invisível/rápida.
 * Cria uma aba com o portal EscolaRS e aguarda a interceptação do webRequest atualizar o storage.
 * Múltiplas chamadas simultâneas aguardarão a mesma Promise (singleton).
 * @param {string} [staleToken=null] - O token que falhou.
 */
async function trySilentTokenRefresh(staleToken = null) {
  // Se já tem uma renovação rolando, só pega a carona
  if (activeTokenRefreshPromise) {
    console.log(`${LOG_PREFIX} Já existe renovação em curso. Await singleton...`);
    return activeTokenRefreshPromise;
  }

  // Define a lógica de renovação e atribui IMEDIATAMENTE ao singleton
  activeTokenRefreshPromise = (async () => {
    let windowId = null;
    let storageListener = null;
    let timeoutId = null;

    const cleanup = () => {
      console.log(`${LOG_PREFIX} Cleanup de renovação...`);
      if (storageListener) chrome.storage.onChanged.removeListener(storageListener);
      if (timeoutId) clearTimeout(timeoutId);
      if (windowId) chrome.windows.remove(windowId).catch(() => {});
    };

    try {
      // 1. Checagem atômica de storage logo no início
      const storedToken = await getTokenFromStorage();
      if (staleToken && storedToken && storedToken !== staleToken) {
        console.log(`${LOG_PREFIX} Singleton detectou token já renovado no storage.`);
        return storedToken;
      }

      // 2. Abre a janela e espera
      return await new Promise((resolve, reject) => {
        storageListener = (changes, namespace) => {
          if (namespace === 'local' && changes.escolaRsToken?.newValue) {
            const newToken = changes.escolaRsToken.newValue;
            console.log(`${LOG_PREFIX} Sucesso! Novo token capturado via Storage Observer.`);
            cleanup();
            resolve(newToken);
          }
        };

        chrome.storage.onChanged.addListener(storageListener);

        timeoutId = setTimeout(() => {
          console.warn(`${LOG_PREFIX} Timeout na renovação silenciosa.`);
          cleanup();
          reject(new Error('Timeout ao aguardar renovação do token.'));
        }, TOKEN_REFRESH_TIMEOUT);

        chrome.windows.create(
          { url: PORTAL_URL, state: 'normal', width: 400, height: 600, focused: true, type: 'popup' },
          (win) => {
            if (chrome.runtime.lastError) {
              cleanup();
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              windowId = win.id;
              console.log(`${LOG_PREFIX} Janela de renovação aberta:`, windowId);
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

/**
 * Lista escolas, turmas e disciplinas do professor
 * @param {string} nrDoc - Número de documento do professor
 * @param {string} token - Token de autenticação
 * @returns {Promise<Object>}
 */
async function listarEscolasProfessor(nrDoc, token) {
  return fetchEscolaRS(`listarEscolasDoProfessorEChamadas/${nrDoc}`, token);
}

/**
 * Lista resultados (notas) de uma turma em uma disciplina
 * @param {string} turmaId - ID da turma
 * @param {string} discId - ID da disciplina
 * @param {string} idRecHumano - ID do recurso humano
 * @param {string} token - Token de autenticação
 * @returns {Promise<Object>}
 */
async function listarResultadosTurma(turmaId, discId, idRecHumano, token) {
  return fetchEscolaRS(
    `listarAulasDaTurmaComResultado/${turmaId}/${discId}/${idRecHumano}/false`,
    token
  );
}

/**
 * Registra a chamada e conteúdo de uma aula em uma data
 * @param {number} turmaId - ID da turma
 * @param {number} discId - ID da disciplina
 * @param {string} data - Data no formato YYYY-MM-DD
 * @param {number} idRecHumano - ID do recurso humano
 * @param {Object} payload - Dados da chamada e conteúdo
 * @param {string} token - Token de autenticação
 * @returns {Promise<Object>}
 */
async function registrarChamadaAula(turmaId, discId, data, idRecHumano, payload, token) {
  return fetchEscolaRS(
    `chamada`,
    token,
    { method: 'POST', body: payload }
  );
}

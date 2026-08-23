/**
 * API Module — EscolaRS
 *
 * Responsável exclusivamente pelas chamadas HTTP à API do EscolaRS.
 * Autenticação é gerenciada pelo AuthManager (auth/authManager.js),
 * que deve ser carregado antes deste módulo.
 *
 * Nenhuma função pública recebe token como parâmetro — o token é
 * obtido de forma transparente via AuthManager.getValidToken().
 */

const API_BASE_URL = 'https://secweb.procergs.com.br/ise-escolars-professor/rest/professor';
const API_TIMEOUT = 30000; // 30 segundos
const MAX_RETRY_ATTEMPTS = 2;
const TOKEN_REFRESH_TIMEOUT = 15000; // Timeout do popup de renovação
const PORTAL_URL = 'https://professor.escola.rs.gov.br/';
const LOG_PREFIX = '[EscolaRS API]';

// ─── Helpers de Fetch ────────────────────────────────────────────────────────

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

function isAuthError(status) {
  return status === 401 || status === 403;
}

async function readErrorBody(response) {
  try { return await response.text(); } catch { return ''; }
}

// ─── Core Fetch ──────────────────────────────────────────────────────────────

/**
 * Ponto central de todas as chamadas à API do EscolaRS.
 * Obtém o token via AuthManager, aplica timeout e faz retry automático em 401/403.
 *
 * @param {string} endpoint - Endpoint relativo (sem a base URL).
 * @param {Object} [options={}] - Opções de fetch: method, body.
 * @param {number} [timeout=API_TIMEOUT]
 * @returns {Promise<Object>} Resposta JSON da API.
 */
async function fetchEscolaRS(endpoint, options = {}, timeout = API_TIMEOUT) {
  const url = `${API_BASE_URL}/${endpoint}`;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    // Sempre obtém o token mais atualizado do AuthManager no início de cada tentativa.
    const token = await AuthManager.getValidToken();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
      response = await fetch(url, buildFetchOptions(token, options, controller.signal));
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Timeout na requisição (${timeout}ms) para: ${endpoint}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.ok) return response.json();

    // Na primeira tentativa com erro de auth, delega a recuperação ao AuthManager.
    if (isAuthError(response.status) && attempt === 1) {
      const newToken = await AuthManager.handleAuthFailure(token);
      if (newToken) continue; // Segunda tentativa usará o token renovado via getValidToken()
    }

    const errorBody = await readErrorBody(response);
    throw new Error(`Erro na API (${response.status}: ${response.statusText}). Detalhes: ${errorBody}`);
  }
}

// ─── Renovação de Token (exclusivo do Service Worker) ───────────────────────
//
// Estas funções são chamadas pelo AuthManager quando está no contexto SW.
// Não fazem sentido em contexto de página (chrome.windows não está disponível
// de forma previsível em páginas da extensão).

/**
 * Usa o refresh_token via POST à SOE para obter um novo access_token silenciosamente.
 * @param {string} refreshToken
 * @returns {Promise<string|null>}
 */
async function executeBackgroundTokenRefresh(refreshToken) {
  try {
    const url = 'https://www.soe.rs.gov.br/soeauth/connect/token';
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: 'ise.i2.qAeyKT7HD0RZ7N1t76Q5etE',
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) throw new Error(`SOE retornou ${res.status}`);

    const data = await res.json();
    if (data.access_token && data.token_type) {
      const novoToken = `${data.token_type} ${data.access_token}`;
      const updateData = { escolaRsToken: novoToken };
      if (data.refresh_token) updateData.escolaRsRefreshToken = data.refresh_token;
      await chrome.storage.local.set(updateData);
      return novoToken;
    }
    return null;
  } catch (err) {
    console.error(`${LOG_PREFIX} executeBackgroundTokenRefresh falhou:`, err);
    return null;
  }
}

/**
 * Tenta renovar o token silenciosamente.
 * Estratégia: POST com refresh_token → fallback para popup de login.
 * Chamada pelo AuthManager quando está no contexto Service Worker.
 *
 * @param {string|null} staleToken - Token expirado (para comparação).
 * @returns {Promise<string>} Novo token.
 */
async function trySilentTokenRefresh(staleToken = null) {
  let windowId = null;
  let storageListener = null;
  let timeoutId = null;

  const cleanup = () => {
    if (storageListener) chrome.storage.onChanged.removeListener(storageListener);
    if (timeoutId) clearTimeout(timeoutId);
    if (windowId) chrome.windows.remove(windowId).catch(() => {});
  };

  try {
    // 1. Verifica se já existe token mais novo no storage (outra requisição pode ter renovado).
    const { escolaRsToken: stored } = await chrome.storage.local.get('escolaRsToken');
    if (stored && stored !== staleToken) return stored;

    // 2. Tenta POST com o refresh_token (mais rápido e silencioso).
    const { escolaRsRefreshToken } = await chrome.storage.local.get('escolaRsRefreshToken');
    if (escolaRsRefreshToken) {
      console.log(`${LOG_PREFIX} Tentando renovação via POST (refresh_token)...`);
      const newToken = await executeBackgroundTokenRefresh(escolaRsRefreshToken);
      if (newToken) {
        console.log(`${LOG_PREFIX} Renovação via POST bem-sucedida.`);
        return newToken;
      }
    }

    // 3. Fallback: abre popup de login e aguarda o token aparecer no storage.
    console.log(`${LOG_PREFIX} Fallback para popup de login...`);
    return await new Promise((resolve, reject) => {
      storageListener = (changes, namespace) => {
        if (namespace === 'local' && changes.escolaRsToken?.newValue) {
          cleanup();
          resolve(changes.escolaRsToken.newValue);
        }
      };

      chrome.storage.onChanged.addListener(storageListener);

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout na renovação do token via popup.'));
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
  }
}

// ─── Funções Públicas da API ─────────────────────────────────────────────────
//
// Nenhuma função recebe ou manipula token. A autenticação é completamente
// transparente — gerenciada por fetchEscolaRS + AuthManager.

async function listarEscolasProfessor(nrDoc) {
  return fetchEscolaRS(`listarEscolasDoProfessorEChamadas/${nrDoc}`);
}

async function listarResultadosTurma(turmaId, discId, idRecHumano) {
  return fetchEscolaRS(`listarAulasDaTurmaComResultado/${turmaId}/${discId}/${idRecHumano}/false`);
}

async function registrarChamadaAula(turmaId, discId, data, idRecHumano, payload) {
  return fetchEscolaRS(`chamada`, { method: 'POST', body: payload });
}

async function buscarFotoDoAluno(matricula, idTurma) {
  return fetchEscolaRS(`buscarFotoDoAluno/${matricula}/${idTurma}`);
}

async function listarAvaliacoesTurma(turmaId, discId, profId) {
  return fetchEscolaRS(`listarAvaliacoesTurma/${turmaId}/${discId}/${profId}`);
}

async function registrarResultadoInstrumentoLista(payload) {
  return fetchEscolaRS(`registrarResultadoInstrumentoLista`, { method: 'POST', body: payload });
}

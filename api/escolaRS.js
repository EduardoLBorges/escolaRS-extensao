/**
 * API Module - EscolaRS
 * Responsável apenas por fazer chamadas à API do EscolaRS
 */

const API_BASE_URL = 'https://secweb.procergs.com.br/ise-escolars-professor/rest/professor';
const API_TIMEOUT = 30000; // 30 segundos de timeout

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

  // Tenta a requisição até 2 vezes (a segunda vez ocorre apenas se o token for atualizado)
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
      const fetchOptions = {
        method: options.method || 'GET',
        headers: {
          "Authorization": currentToken,
          "Content-Type": "application/json"
        },
        signal: controller.signal
      };
      
      if (options.body) {
        fetchOptions.body = JSON.stringify(options.body);
      }

      response = await fetch(url, fetchOptions);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Timeout na requisição (${timeout}ms) para: ${endpoint}`);
      }
      throw error; // Outros erros de rede (ex: sem conexão)
    } finally {
      clearTimeout(timeoutId);
    }

    // Se a requisição foi bem-sucedida, retorna o JSON.
    if (response.ok) {
      return response.json();
    }

    // Se o token expirou (401 ou 403) e esta é a primeira tentativa, tenta atualizar o token.
    if ((response.status === 401 || response.status === 403) && attempt === 1) {
      console.warn('[EscolaRS API] Token expirado ou inválido (401/403). Tentando renovação silenciosa...');
      try {
        currentToken = await trySilentTokenRefresh(currentToken);
        if (currentToken) {
           console.log('[EscolaRS API] Token renovado com sucesso. Retentando requisição...');
           continue; // Pula para a próxima iteração e tenta novamente
        }
      } catch (e) {
        console.error('[EscolaRS API] Falha na renovação silenciosa do token:', e);
      }
    }

    // Se a requisição falhou por outro motivo, ou se a segunda tentativa também falhou.
    let errorBody = '';
    try {
      // Tenta ler o corpo da resposta para obter mais detalhes do erro.
      errorBody = await response.text();
    } catch {
      // Ignora se o corpo não puder ser lido.
    }
    throw new Error(`Erro na API (${response.status}: ${response.statusText}). Detalhes: ${errorBody}`);
  }
}

let activeTokenRefreshPromise = null;

/**
 * Tenta forçar a renovação do token de forma invisível/rápida.
 * Cria uma aba com o portal EscolaRS e aguarda a interceptação do webRequest atualizar o storage.
 * Múltiplas chamadas simultâneas aguardarão a mesma aba/Promise.
 * @param {string} [staleToken=null] - O token que falhou, usado para checar se já houve renovação por outra requisição.
 */
async function trySilentTokenRefresh(staleToken = null) {
  if (activeTokenRefreshPromise) {
    return activeTokenRefreshPromise;
  }

  // 1. Antes de mais nada, checa se o token no storage já é diferente do que falhou.
  // Se for, significa que outra requisição paralela já renovou o token com sucesso.
  if (staleToken) {
    const authData = await chrome.storage.local.get("escolaRsToken");
    if (authData.escolaRsToken && authData.escolaRsToken !== staleToken) {
      console.log('[EscolaRS API] Token no storage já foi renovado por outra requisição. Ignorando abertura de janela.');
      return authData.escolaRsToken;
    }
  }

  // 2. Re-checagem após o await (pode ter iniciado uma renovação enquanto esperávamos o storage)
  if (activeTokenRefreshPromise) {
    return activeTokenRefreshPromise;
  }

  activeTokenRefreshPromise = new Promise((resolve, reject) => {
    let timeoutId;
    let windowId;

    const cleanup = () => {
      chrome.storage.onChanged.removeListener(storageListener);
      clearTimeout(timeoutId);
      if (windowId) chrome.windows.remove(windowId).catch(() => {});
      activeTokenRefreshPromise = null;
    };

    const storageListener = (changes, namespace) => {
      if (namespace === 'local' && changes.escolaRsToken && changes.escolaRsToken.newValue) {
        cleanup();
        resolve(changes.escolaRsToken.newValue);
      }
    };

    chrome.storage.onChanged.addListener(storageListener);

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout ao aguardar renovação do token no background. Pode ser necessário login manual."));
    }, 15000); // 15s de limite para a renovação silenciosa

    chrome.windows.create({
      url: 'https://professor.escola.rs.gov.br/',
      state: 'normal',
      width: 400,
      height: 600,
      focused: true,
      type: 'popup'
    }, (windowInfo) => {
      windowId = windowInfo.id;
    });
  });

  return activeTokenRefreshPromise;
}


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

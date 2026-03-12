/**
 * API Module - EscolaRS
 * Responsável apenas por fazer chamadas à API do EscolaRS
 */

const API_BASE_URL = 'https://secweb.procergs.com.br/ise-escolars-professor/rest/professor';
const API_TIMEOUT = 30000; // 30 segundos de timeout

/**
 * Faz uma chamada genérica à API do EscolaRS com timeout.
 * Em caso de 401, busca o token mais recente do storage e retenta uma vez.
 * @param {string} endpoint - Endpoint relativo
 * @param {string} token - Token de autenticação (Bearer token)
 * @param {number} timeout - Timeout em ms (padrão: 30s)
 * @returns {Promise<Object>} Resposta JSON da API
 * @throws {Error} Se a requisição falhar ou expirar timeout
 */
async function fetchEscolaRS(endpoint, token, timeout = API_TIMEOUT) {
  const url = `${API_BASE_URL}/${endpoint}`;

  async function doRequest(authToken) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          "Authorization": authToken,
          "Content-Type": "application/json"
        },
        signal: controller.signal
      });
      return response;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Timeout na requisição (${timeout}ms) para: ${endpoint}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  let response = await doRequest(token);

  // Se o token expirou, buscar o mais recente do storage (atualizado pelo webRequest) e retentar
  if (response.status === 401) {
    console.warn('[EscolaRS API] Token expirado (401). Buscando token atualizado do storage...');
    try {
      const authData = await chrome.storage.local.get(["escolaRsToken"]);
      const tokenAtualizado = authData.escolaRsToken;

      if (tokenAtualizado && tokenAtualizado !== token) {
        console.log('[EscolaRS API] Token atualizado encontrado. Retentando requisição...');
        response = await doRequest(tokenAtualizado);
      }
    } catch (e) {
      console.error('[EscolaRS API] Erro ao buscar token atualizado:', e);
    }
  }

  if (!response.ok) {
    throw new Error(`Erro na API (${response.status}): ${response.statusText}`);
  }

  return response.json();
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

async function exportFunctions() {
  return {
    fetchEscolaRS,
    listarEscolasProfessor,
    listarResultadosTurma
  };
}

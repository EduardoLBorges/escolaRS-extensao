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
 * @param {number} [timeout=API_TIMEOUT] - Timeout em milissegundos.
 * @returns {Promise<Object>} Resposta JSON da API.
 * @throws {Error} Se a requisição falhar, expirar o timeout, ou a repetição não for bem-sucedida.
 */
async function fetchEscolaRS(endpoint, token, timeout = API_TIMEOUT) {
  const url = `${API_BASE_URL}/${endpoint}`;
  let currentToken = token;

  // Tenta a requisição até 2 vezes (a segunda vez ocorre apenas se o token for atualizado)
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          "Authorization": currentToken,
          "Content-Type": "application/json"
        },
        signal: controller.signal
      });
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

    // Se o token expirou (401) e esta é a primeira tentativa, tenta atualizar o token.
    if (response.status === 401 && attempt === 1) {
      console.warn('[EscolaRS API] Token expirado (401). Buscando token atualizado do storage...');
      try {
        const storage = await chrome.storage.local.get("escolaRsToken");
        const newToken = storage.escolaRsToken;

        if (newToken && newToken !== currentToken) {
          console.log('[EscolaRS API] Token atualizado encontrado. Retentando requisição...');
          currentToken = newToken;
          continue; // Pula para a próxima iteração do laço (tentativa 2)
        }
      } catch (e) {
        console.error('[EscolaRS API] Erro ao buscar token atualizado do storage:', e);
        // Se falhar ao buscar o token, não tenta novamente e lança o erro da requisição original.
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

/**
 * API Module - EscolaRS
 * Responsável apenas por fazer chamadas à API do EscolaRS
 */

const API_BASE_URL = 'https://secweb.procergs.com.br/ise-escolars-professor/rest/professor';
const API_TIMEOUT = 30000; // 30 segundos de timeout

/**
 * Faz uma chamada genérica à API do EscolaRS com timeout
 * @param {string} endpoint - Endpoint relativo (ex: "listarEscolasDoProfessor/123")
 * @param {string} token - Token de autenticação (Bearer token)
 * @param {number} timeout - Timeout em ms (padrão: 30s)
 * @returns {Promise<Object>} Resposta JSON da API
 * @throws {Error} Se a requisição falhar ou expirar timeout
 */
async function fetchEscolaRS(endpoint, token, timeout = API_TIMEOUT) {
  const url = `${API_BASE_URL}/${endpoint}`;
  
  // Criar AbortController para timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 
        "Authorization": token, 
        "Content-Type": "application/json" 
      },
      signal: controller.signal
    });
    
    if (!response.ok) {
      throw new Error(`Erro na API (${response.status}): ${response.statusText}`);
    }
    
    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Timeout na requisição (${timeout}ms) para: ${endpoint}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Lista escolas, turmas e disciplinas do professor
 * @param {string} nrDoc - Número de documento do professor
 * @param {string} token - Token de autenticação
 * @returns {Promise<Object>} Estrutura com escolas, turmas e disciplinas
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
 * @returns {Promise<Object>} Estrutura com alunos e suas notas
 */
async function listarResultadosTurma(turmaId, discId, idRecHumano, token) {
  return fetchEscolaRS(
    `listarAulasDaTurmaComResultado/${turmaId}/${discId}/${idRecHumano}/false`,
    token
  );
}

// Exportar funções para uso em outros módulos
async function exportFunctions() {
  return {
    fetchEscolaRS,
    listarEscolasProfessor,
    listarResultadosTurma
  };
}

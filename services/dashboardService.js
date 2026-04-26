/**
 * Dashboard Service - Orquestração de construção do dashboard
 * Responsável por coordenar chamadas à API e lógica de negócio
 */

const CONCURRENCY_LIMIT = 5; // Limite de requisições simultâneas
const AUTH_MISSING_ERROR = 'Dados de autenticação não encontrados. Por favor, acesse o portal EscolaRS primeiro.';

// ─── Batch Processing ───────────────────────────────────────────────

/**
 * Processa uma lista de itens em lotes para controlar a concorrência.
 * @param {Array} items - Lista de itens para processar.
 * @param {Function} task - Função que retorna uma Promise para cada item.
 * @param {number} batchSize - Tamanho de cada lote.
 * @param {Function} [onProgress=null] - Callback de progresso.
 * @returns {Promise<Array>} Retorna os resultados no formato de Promise.allSettled.
 */
async function processInBatches(items, task, batchSize, onProgress = null) {
  const allResults = [];

  for (let position = 0; position < items.length; position += batchSize) {
    const batch = items.slice(position, position + batchSize);
    const batchResults = await Promise.allSettled(batch.map(task));

    allResults.push(...batchResults);

    if (onProgress) {
      const processed = Math.min(position + batchSize, items.length);
      onProgress({
        percentage: Math.round((processed / items.length) * 100),
        status: `Processando turmas... (${processed}/${items.length})`,
      });
    }
  }

  return allResults;
}

// ─── Data Transformation Helpers ────────────────────────────────────

/**
 * Achata a estrutura aninhada de escolas/turmas/disciplinas em uma lista plana de tarefas.
 * @param {Array} escolas - Lista de escolas com turmas e disciplinas.
 * @returns {Array<Object>} Lista plana de tarefas, uma por disciplina.
 */
function flattenDisciplineTasks(escolas) {
  const tasks = [];

  for (const escola of escolas) {
    for (const turma of escola.turmas) {
      for (const disc of turma.disciplinas) {
        tasks.push({
          escolaId: escola.id,
          escolaNome: escola.nome,
          turmaId: turma.id,
          turmaNome: turma.nome,
          turmaSerie: turma.idSerie,
          discId: disc.id,
          discNome: disc.nome,
          discCargaHoraria: disc.qtAulasPrevistas,
        });
      }
    }
  }

  return tasks;
}

/**
 * Reconstrói a estrutura aninhada de escolas a partir dos resultados das tarefas.
 * @param {Array<Object>} tasks - Lista original de tarefas (para metadados).
 * @param {Array<PromiseSettledResult>} results - Resultados do processamento em lote.
 * @returns {Array<Object>} Lista de escolas com turmas e disciplinas preenchidas.
 */
function buildEscolasFromResults(tasks, results) {
  const escolasMap = new Map();

  results.forEach((result, idx) => {
    const task = tasks[idx];

    // Garantir que a escola exista no Map
    if (!escolasMap.has(task.escolaNome)) {
      escolasMap.set(task.escolaNome, { nome: task.escolaNome, turmas: new Map() });
    }
    const escola = escolasMap.get(task.escolaNome);

    // Garantir que a turma exista no Map da escola
    if (!escola.turmas.has(task.turmaNome)) {
      escola.turmas.set(task.turmaNome, {
        id: task.turmaId,
        nome: task.turmaNome,
        serie: task.turmaSerie,
        disciplinas: [],
      });
    }
    const turma = escola.turmas.get(task.turmaNome);

    // Adicionar a disciplina (com sucesso ou com erro)
    if (result.status === 'fulfilled') {
      turma.disciplinas.push({
        id: task.discId,
        disciplina: result.value.discNome,
        carga_horaria: result.value.discCargaHoraria,
        alunos: result.value.alunos,
        erro: null,
      });
    } else {
      const mensagemErro = result.reason?.message || 'Erro desconhecido ao carregar disciplina';
      console.warn(`[Dashboard] Erro ao carregar ${task.turmaNome} - ${task.discNome}:`, mensagemErro);
      turma.disciplinas.push({
        id: task.discId,
        disciplina: task.discNome,
        carga_horaria: task.discCargaHoraria,
        alunos: [],
        erro: mensagemErro,
      });
    }
  });

  // Converter os Maps para arrays para o payload final
  return Array.from(escolasMap.values()).map((escola) => ({
    ...escola,
    turmas: Array.from(escola.turmas.values()),
  }));
}

// ─── Main Dashboard Builder ─────────────────────────────────────────

/**
 * Constrói o objeto completo do dashboard com todos os dados do professor.
 * Aplica um limite de concorrência global para todas as chamadas de API.
 *
 * @param {string} token - Token de autenticação
 * @param {string} nrDoc - Número de documento do professor
 * @param {Function} [onProgress=null] - Callback para atualizar progresso
 * @returns {Promise<Object>} Objeto com estrutura: { professor, cpf, data_exportacao, escolas[] }
 * @throws {Error} Se falhar na autenticação ou API
 */
async function getDashboardData(token, nrDoc, onProgress = null) {
  if (!token || !nrDoc) {
    throw new Error(AUTH_MISSING_ERROR);
  }

  // 1. Buscar dados iniciais (escolas, turmas, etc.)
  const infoInicial = await listarEscolasProfessor(nrDoc, token);

  // Se a chamada acima disparou uma renovação, precisamos do token novo
  // para as próximas chamadas paralelas no processInBatches.
  const currentToken = await getTokenFromStorage() || token;

  if (currentToken !== token) {
    console.log('[Dashboard Service] Token atualizado após chamada inicial.');
  }

  const { idRecHumano } = infoInicial;

  if (onProgress) onProgress({ percentage: 0, status: 'Iniciando busca de turmas...' });

  // 2. Criar uma lista plana de todas as disciplinas a serem buscadas
  const allTasks = flattenDisciplineTasks(infoInicial.escolas);

  // 3. Processar a lista plana com limite de concorrência
  const allResults = await processInBatches(
    allTasks,
    async (task) => {
      // autoRefreshToken: false — o token já foi validado na chamada inicial.
      // Se falhar aqui, não deve abrir popup; será reportado como erro da disciplina.
      const resultados = await listarResultadosTurma(
        task.turmaId, task.discId, idRecHumano, currentToken,
        { autoRefreshToken: false }
      );
      return {
        ...task,
        alunos: resultados.alunos.map(aluno => processarAluno({ ...aluno, idTurma: task.turmaId })),
        erro: null,
      };
    },
    CONCURRENCY_LIMIT,
    onProgress
  );

  // Se TODAS as requisições falharem, aborta para não sobrescrever o cache com erros
  if (allResults.length > 0 && allResults.every((r) => r.status === 'rejected')) {
    const firstError = allResults[0].reason?.message || 'Erro desconhecido';
    console.error('[Dashboard Service] Todas as requisições do batch falharam. Primeiro erro:', firstError);
    
    if (firstError.includes('401') || firstError.includes('403')) {
      throw new Error('Sua sessão expirou ou o token é inválido. Por favor, faça login novamente no portal EscolaRS.');
    }
    
    throw new Error(`Falha ao carregar dados: ${firstError}. Verifique sua conexão ou se o portal está acessível.`);
  }

  // 4. Reconstruir a estrutura de dados aninhada
  const escolas = buildEscolasFromResults(allTasks, allResults);

  if (onProgress) onProgress({ percentage: 100, status: 'Finalizado!' });

  return {
    professor: infoInicial.nome,
    cpf: nrDoc,
    idRecHumano,
    data_exportacao: new Date().toISOString(),
    escolas,
  };
}

let activeDashboardBuildPromise = null;

/**
 * Wrapper que lê autenticação do storage e constrói o dashboard.
 * Usa um singleton para evitar múltiplos builds simultâneos.
 * @returns {Promise<Object>} Dados do dashboard
 */
async function buildDashboardFromStorage() {
  if (activeDashboardBuildPromise) {
    console.log('[Dashboard Service] Já existe um build em progresso. Aguardando...');
    return activeDashboardBuildPromise;
  }

  activeDashboardBuildPromise = (async () => {
    try {
      let authData = await chrome.storage.local.get(['escolaRsToken', 'nrDoc']);

      if (!authData.escolaRsToken) {
        console.log('[Dashboard Service] Token ausente. Tentando renovação inicial...');
        await trySilentTokenRefresh(null);
        authData = await chrome.storage.local.get(['escolaRsToken', 'nrDoc']);
      }

      if (!authData.escolaRsToken || !authData.nrDoc) {
        throw new Error(AUTH_MISSING_ERROR);
      }

      return await getDashboardData(authData.escolaRsToken, authData.nrDoc, (progress) => {
        chrome.runtime.sendMessage({
          action: 'updateProgress',
          percentage: progress.percentage,
          status: progress.status,
        }).catch(() => {});
      });
    } finally {
      activeDashboardBuildPromise = null;
    }
  })();

  return activeDashboardBuildPromise;
}

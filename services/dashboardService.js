/**
 * Dashboard Service - Orquestração de construção do dashboard
 * Responsável por coordenar chamadas à API e lógica de negócio
 */

const CONCURRENCY_LIMIT = 5; // Limite de requisições simultâneas

/**
 * Processa uma lista de itens em lotes para controlar a concorrência.
 * @param {Array} items - Lista de itens para processar.
 * @param {Function} task - Função que retorna uma Promise para cada item.
 * @param {number} batchSize - Tamanho de cada lote.
 * @returns {Promise<Array>} Retorna os resultados no formato de Promise.allSettled.
 */
async function processInBatches(items, task, batchSize, onProgress = null) {
  let position = 0;
  let allResults = [];
  while (position < items.length) {
    const itemsForBatch = items.slice(position, position + batchSize);
    
    // O mapeamento para a task deve ocorrer dentro do allSettled
    const batchPromises = itemsForBatch.map(item => task(item));
    const batchResults = await Promise.allSettled(batchPromises);

    allResults = [...allResults, ...batchResults];
    position += batchSize;

    if (onProgress) {
      const percentage = Math.round((position / items.length) * 100);
      onProgress({
        percentage: Math.min(100, percentage), // Garante que não passe de 100%
        status: `Processando turmas... (${position > items.length ? items.length : position}/${items.length})`
      });
    }
  }
  return allResults;
}


/**
 * Constrói o objeto completo do dashboard com todos os dados do professor.
 * Aplica um limite de concorrência global para todas as chamadas de API.
 *
 * @param {string} token - Token de autenticação
 * @param {string} nrDoc - Número de documento do professor
 * @param {Function} onProgress - Callback para atualizar progresso (opcional)
 * @returns {Promise<Object>} Objeto com estrutura: { professor, cpf, data_exportacao, escolas[] }
 * @throws {Error} Se falhar na autenticação ou API
 */
async function getDashboardData(token, nrDoc, onProgress = null) {
  if (!token || !nrDoc) {
    throw new Error("Dados de autenticação não encontrados. Por favor, acesse o portal EscolaRS primeiro.");
  }

  // 1. Buscar dados iniciais (escolas, turmas, etc.)
  const infoInicial = await listarEscolasProfessor(nrDoc, token);
  const idRecHumano = infoInicial.idRecHumano;

  if (onProgress) onProgress({ percentage: 0, status: 'Iniciando busca de turmas...' });

  // 2. Criar uma lista plana de todas as disciplinas a serem buscadas
  const allDisciplineTasks = [];
  infoInicial.escolas.forEach(escola => {
    escola.turmas.forEach(turma => {
      turma.disciplinas.forEach(disc => {
        allDisciplineTasks.push({
          escolaId: escola.id,
          escolaNome: escola.nome,
          turmaId: turma.id,
          turmaNome: turma.nome,
          turmaSerie: turma.idSerie,
          discId: disc.id,
          discNome: disc.nome,
          discCargaHoraria: disc.qtAulasPrevistas
        });
      });
    });
  });

  // 3. Processar a lista plana com limite de concorrência
  const allResults = await processInBatches(
    allDisciplineTasks,
    async (task) => {
      const resultados = await listarResultadosTurma(
        task.turmaId,
        task.discId,
        idRecHumano,
        token
      );
      const alunosComMedia = resultados.alunos.map(processarAluno);
      return {
        ...task, // Passar os dados da tarefa para a próxima fase
        alunos: alunosComMedia,
        erro: null
      };
    },
    CONCURRENCY_LIMIT,
    onProgress
  );

  // Se todas as requisições falharem (ex: sem conexão), aborta tudo para não sobrescrever o cache com erros
  if (allResults.length > 0) {
    const allRejected = allResults.every(r => r.status === 'rejected');
    if (allRejected) {
      throw new Error("Sem conexão com a internet ou portal indisponível. A atualização foi cancelada para preservar seus dados salvos.");
    }
  }

  // 4. Reconstruir a estrutura de dados aninhada
  const escolasMap = new Map();

  allResults.forEach((resultado, idx) => {
    const taskOriginal = allDisciplineTasks[idx];

    // Garantir que a escola exista no Map
    if (!escolasMap.has(taskOriginal.escolaNome)) {
      escolasMap.set(taskOriginal.escolaNome, {
        nome: taskOriginal.escolaNome,
        turmas: new Map()
      });
    }
    const escolaNoMapa = escolasMap.get(taskOriginal.escolaNome);

    // Garantir que a turma exista no Map da escola
    if (!escolaNoMapa.turmas.has(taskOriginal.turmaNome)) {
      escolaNoMapa.turmas.set(taskOriginal.turmaNome, {
        nome: taskOriginal.turmaNome,
        serie: taskOriginal.turmaSerie,
        disciplinas: []
      });
    }
    const turmaNoMapa = escolaNoMapa.turmas.get(taskOriginal.turmaNome);
    
    // Adicionar a disciplina (com sucesso ou com erro)
    if (resultado.status === 'fulfilled') {
      turmaNoMapa.disciplinas.push({
        disciplina: resultado.value.discNome,
        carga_horaria: resultado.value.discCargaHoraria,
        alunos: resultado.value.alunos,
        erro: null
      });
    } else {
      const mensagemErro = resultado.reason?.message || 'Erro desconhecido ao carregar disciplina';
      console.warn(`[Dashboard] Erro ao carregar ${taskOriginal.turmaNome} - ${taskOriginal.discNome}:`, mensagemErro);
      turmaNoMapa.disciplinas.push({
        disciplina: taskOriginal.discNome,
        carga_horaria: taskOriginal.discCargaHoraria,
        alunos: [],
        erro: mensagemErro
      });
    }
  });

  // 5. Converter os Maps para arrays para o payload final
  const escolasFinal = Array.from(escolasMap.values()).map(escola => ({
    ...escola,
    turmas: Array.from(escola.turmas.values())
  }));

  if (onProgress) onProgress({ percentage: 100, status: 'Finalizado!' });

  return {
    professor: infoInicial.nome,
    cpf: nrDoc,
    data_exportacao: new Date().toISOString(),
    escolas: escolasFinal
  };
}

/**
 * Wrapper que lê autenticação do storage e constrói o dashboard
 * @returns {Promise<Object>} Dados do dashboard
 */
async function buildDashboardFromStorage() {
  let authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);

  if (!authData.escolaRsToken) {
    console.log('[Dashboard] Token ausente. Tentando renovação silenciosa inicial...');
    try {
      await trySilentTokenRefresh();
      authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);
    } catch (e) {
      console.warn('[Dashboard] Renovação inicial falhou:', e);
    }
  }

  if (!authData.escolaRsToken || !authData.nrDoc) {
    throw new Error("Dados de autenticação não encontrados. Por favor, acesse o portal EscolaRS primeiro.");
  }

  return getDashboardData(authData.escolaRsToken, authData.nrDoc, (progress) => {
    chrome.runtime.sendMessage({
      action: 'updateProgress',
      percentage: progress.percentage,
      status: progress.status
    }).catch(() => {});
  });
}

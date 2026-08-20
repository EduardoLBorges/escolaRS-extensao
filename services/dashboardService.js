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
      const taskToken = (await getTokenFromStorage()) || currentToken;
      const resultados = await listarResultadosTurma(
        task.turmaId, task.discId, idRecHumano, taskToken,
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

/**
 * Calcula estatísticas gerais do dashboard.
 * @param {Object} data 
 * @returns {Object}
 */
function calculateStats(data) {
  let totalAlunos = 0;
  let totalTurmas = 0;
  let totalNotas = 0;
  let alunosComMedia = 0;
  let aprovados = 0;

  if (!data || !data.escolas) return { totalAlunos: 0, totalTurmas: 0, mediaGeral: 0, aprovados: 0, percentualAprovados: 0 };

  for (const escola of data.escolas) {
    for (const turma of escola.turmas) {
      totalTurmas++;
      for (const disc of turma.disciplinas) {
        const alunosAtivos = getAlunosAtivos(disc.alunos);
        totalAlunos += alunosAtivos.length;
        for (const aluno of alunosAtivos) {
          if (aluno.mediaFinal > 0) {
            totalNotas += aluno.mediaFinal;
            alunosComMedia++;
            if (aluno.mediaFinal >= 6) aprovados++;
          }
        }
      }
    }
  }

  const mediaGeral = alunosComMedia > 0 ? (totalNotas / alunosComMedia).toFixed(1) : 0;
  const percentualAprovados = totalAlunos > 0 ? ((aprovados / totalAlunos) * 100).toFixed(1) : 0;

  return { totalAlunos, totalTurmas, mediaGeral, aprovados, percentualAprovados };
}

/**
 * Calcula estatísticas filtradas para a UI.
 */
function calculateFilteredStats(dashboardData, escolaFiltro, turmaFiltro, alunoFiltro) {
  let totalAlunos = 0;
  let aprovados = 0, emRecuperacao = 0, reprovados = 0, semNota = 0;
  const periodoNotas = {};
  let allAlunos = [];

  if (!dashboardData || !dashboardData.escolas) return null;

  for (const escola of dashboardData.escolas) {
    if (escolaFiltro && escola.nome !== escolaFiltro) continue;
    for (const turma of escola.turmas) {
      if (turmaFiltro && turma.nome !== turmaFiltro) continue;
      for (const disc of turma.disciplinas) {
        const alunosAtivos = getAlunosAtivos(disc.alunos || []);
        for (const aluno of alunosAtivos) {
          if (alunoFiltro && !aluno.nome.toLowerCase().includes(alunoFiltro)) continue;
          allAlunos.push(aluno);
        }
      }
    }
  }

  totalAlunos = allAlunos.length;
  if (totalAlunos === 0) return null;

  const { periodos } = detectarTipoEPeriodos(allAlunos);

  for (const aluno of allAlunos) {
    if (aluno.mediaFinal > 0) {
      if (aluno.mediaFinal >= 6) aprovados++;
      else if (aluno.mediaFinal >= 5) emRecuperacao++;
      else reprovados++;
    }
    for (const per of periodos) {
      const notaTxt = getNotaTexto(aluno.notas, per);
      const nota = parseFloat(String(notaTxt).replace('*', '').replace(',', '.'));
      if (!isNaN(nota)) {
        if (!periodoNotas[per]) periodoNotas[per] = [];
        periodoNotas[per].push(nota);
      }
    }
  }

  const periodAverages = periodos.map((per) => {
    const lista = periodoNotas[per] || [];
    const media = lista.length > 0 ? (lista.reduce((a, b) => a + b, 0) / lista.length) : null;
    let ap = 0, rec = 0, rep = 0;
    for (const nota of lista) {
      if (nota >= 6) ap++;
      else if (nota >= 5) rec++;
      else rep++;
    }
    const sn = totalAlunos - (ap + rec + rep);
    return { label: per, media, aprovados: ap, emRecuperacao: rec, reprovados: rep, semNota: sn };
  });

  semNota = totalAlunos - (aprovados + emRecuperacao + reprovados);

  return { totalAlunos, aprovados, emRecuperacao, reprovados, semNota, periodAverages };
}

/**
 * Busca cálculos de aproveitamento (soma/média) para o período selecionado.
 * Funciona tanto no Service Worker quanto no contexto de página (dashboard.html).
 */
async function fetchPreVisualizacao(dashboardData, periodoStr, callbacks = {}) {
  const { onProgress } = callbacks;

  if (!dashboardData || !dashboardData.idRecHumano || !dashboardData.escolas) return {};

  // Lê o token diretamente do storage — funciona em qualquer contexto da extensão
  const storageData = await chrome.storage.local.get('escolaRsToken');
  const token = storageData.escolaRsToken;
  if (!token) throw new Error('Token de autenticação não encontrado. Faça login no portal EscolaRS.');

  const API_BASE = 'https://secweb.procergs.com.br/ise-escolars-professor/rest/professor';
  const idRecHumano = dashboardData.idRecHumano;

  const numMatch = periodoStr.match(/\d+/);
  if (!numMatch) return {};
  const idPeriodo = numMatch[0];
  const isSemestre = periodoStr.toLowerCase().includes('sem');
  const targetType = isSemestre ? 'sem' : 'trim';

  /**
   * Realiza uma chamada GET autenticada à API.
   */
  async function apiFetch(endpoint) {
    // Se fetchEscolaRS estiver disponível no escopo (Service Worker), usa ele.
    // Caso contrário (contexto de página), usa fetch nativo.
    if (typeof fetchEscolaRS === 'function') {
      return fetchEscolaRS(endpoint, token);
    }
    const url = `${API_BASE}/${endpoint}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error(`Erro na API (${response.status})`);
    return response.json();
  }

  const tasks = [];
  for (const escola of dashboardData.escolas) {
    for (const turma of escola.turmas) {
      for (const disc of turma.disciplinas) {
        if (!disc.erro && disc.id && turma.id) {
          let idPeriodoCalculo = null;
          if (disc.alunos) {
            for (const aluno of disc.alunos) {
              if (aluno.listaResultados) {
                const res = aluno.listaResultados.find(r => {
                  const nomeP = (r.nomePeriodo || '').toLowerCase();
                  return nomeP.includes(targetType) && nomeP.includes(idPeriodo) && !nomeP.includes('er');
                });
                if (res) {
                  idPeriodoCalculo = res.idPeriodoAvaliacao || res.idPeriodo || res.periodoId || res.idPeriodoAvaliacaoData || res.id;
                  if (idPeriodoCalculo) break;
                }
              }
            }
          }

          // Fallback: busca via listarAvaliacoesTurma
          if (!idPeriodoCalculo) {
            try {
              const arrayAvals = await apiFetch(`listarAvaliacoesTurma/${turma.id}/${disc.id}/${idRecHumano}`);
              if (Array.isArray(arrayAvals)) {
                const avEncontrada = arrayAvals.find(a => {
                  const desc = (a.descricao || '').toLowerCase();
                  return desc.includes(targetType) && desc.includes(idPeriodo) && !desc.includes('er');
                });
                if (avEncontrada) {
                  idPeriodoCalculo = avEncontrada.id;
                }
              }
            } catch (err) {
              console.warn(`[Dashboard Service] Falha ao buscar período via listarAvaliacoesTurma para turma ${turma.id}:`, err.message);
            }
          }

          if (idPeriodoCalculo) {
            tasks.push({ idTurma: turma.id, idDisciplina: disc.id, idPeriodoAvaliacao: idPeriodoCalculo });
          }
        }
      }
    }
  }

  if (tasks.length === 0) return {};

  const resultados = {};
  let concluidos = 0;

  const chunkSize = 3;
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const chunk = tasks.slice(i, i + chunkSize);
    await Promise.allSettled(chunk.map(async task => {
      try {
        const endpoint = `v2/calcularAproveitamentos/professor/${idRecHumano}/turma/${task.idTurma}/disciplina/${task.idDisciplina}/periodo/${task.idPeriodoAvaliacao}/area/false`;
        const data = await apiFetch(endpoint);
        if (data && data.calculosAproveitamentos) {
          for (const calc of data.calculosAproveitamentos) {
            const valObj = { soma: calc.soma, media: calc.media };
            if (calc.idAluno !== undefined && calc.idAluno !== null) {
              resultados[`${calc.idAluno}_${task.idDisciplina}`] = valObj;
            }
            if (calc.matricula !== undefined && calc.matricula !== null) {
              resultados[`${calc.matricula}_${task.idDisciplina}`] = valObj;
            }
            if (calc.id !== undefined && calc.id !== null) {
              resultados[`${calc.id}_${task.idDisciplina}`] = valObj;
            }
          }
        }
      } catch (e) {
        console.error('[Dashboard Service] Erro na pre-visualizacao:', e);
      } finally {
        concluidos++;
        if (onProgress) onProgress(Math.round((concluidos / tasks.length) * 100));
      }
    }));
  }

  return resultados;
}


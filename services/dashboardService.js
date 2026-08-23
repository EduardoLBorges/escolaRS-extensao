/**
 * Dashboard Service — Orquestração de construção do dashboard
 * Coordena chamadas à API e lógica de negócio.
 * Token gerenciado de forma transparente pelo AuthManager via fetchEscolaRS.
 */

const CONCURRENCY_LIMIT = 5;
const AUTH_MISSING_ERROR = 'Dados de autenticação não encontrados. Por favor, acesse o portal EscolaRS primeiro.';

// ─── Batch Processing ─────────────────────────────────────────────────────────

/**
 * Processa uma lista de itens em lotes para controlar a concorrência.
 * @param {Array} items
 * @param {Function} task - Função que retorna Promise para cada item.
 * @param {number} batchSize
 * @param {Function} [onProgress]
 * @returns {Promise<Array>} Resultados no formato Promise.allSettled.
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

// ─── Data Transformation Helpers ─────────────────────────────────────────────

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

function buildEscolasFromResults(tasks, results) {
  const escolasMap = new Map();

  results.forEach((result, idx) => {
    const task = tasks[idx];

    if (!escolasMap.has(task.escolaNome)) {
      escolasMap.set(task.escolaNome, { nome: task.escolaNome, turmas: new Map() });
    }
    const escola = escolasMap.get(task.escolaNome);

    if (!escola.turmas.has(task.turmaNome)) {
      escola.turmas.set(task.turmaNome, {
        id: task.turmaId,
        nome: task.turmaNome,
        serie: task.turmaSerie,
        disciplinas: [],
      });
    }
    const turma = escola.turmas.get(task.turmaNome);

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

  return Array.from(escolasMap.values()).map((escola) => ({
    ...escola,
    turmas: Array.from(escola.turmas.values()),
  }));
}

// ─── Main Dashboard Builder ───────────────────────────────────────────────────

/**
 * Constrói o objeto completo do dashboard.
 * Token obtido de forma transparente via AuthManager (sem parâmetro explícito).
 *
 * @param {string} nrDoc - Número de documento do professor.
 * @param {Function} [onProgress]
 * @returns {Promise<Object>} { professor, cpf, idRecHumano, data_exportacao, escolas[] }
 */
async function getDashboardData(nrDoc, onProgress = null) {
  if (!nrDoc) throw new Error(AUTH_MISSING_ERROR);

  const infoInicial = await listarEscolasProfessor(nrDoc);
  const { idRecHumano } = infoInicial;

  if (onProgress) onProgress({ percentage: 0, status: 'Iniciando busca de turmas...' });

  const allTasks = flattenDisciplineTasks(infoInicial.escolas);

  const allResults = await processInBatches(
    allTasks,
    async (task) => {
      const resultados = await listarResultadosTurma(task.turmaId, task.discId, idRecHumano);
      return {
        ...task,
        alunos: resultados.alunos.map(aluno => processarAluno({ ...aluno, idTurma: task.turmaId })),
        erro: null,
      };
    },
    CONCURRENCY_LIMIT,
    onProgress
  );

  if (allResults.length > 0 && allResults.every((r) => r.status === 'rejected')) {
    const firstError = allResults[0].reason?.message || 'Erro desconhecido';
    console.error('[Dashboard Service] Todas as requisições do batch falharam:', firstError);

    if (firstError.includes('401') || firstError.includes('403')) {
      throw new Error('Sua sessão expirou. Por favor, faça login novamente no portal EscolaRS.');
    }

    throw new Error(`Falha ao carregar dados: ${firstError}`);
  }

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
 * Lê o nrDoc do storage e constrói o dashboard.
 * Singleton para evitar builds simultâneos.
 */
async function buildDashboardFromStorage() {
  if (activeDashboardBuildPromise) {
    console.log('[Dashboard Service] Build já em progresso. Aguardando...');
    return activeDashboardBuildPromise;
  }

  activeDashboardBuildPromise = (async () => {
    try {
      const { nrDoc } = await chrome.storage.local.get('nrDoc');

      if (!nrDoc) {
        // Sem nrDoc, verifica se consegue token (o que dispararia refresh se necessário).
        // Se token existe mas nrDoc não, o usuário não fez ainda a primeira requisição ao portal.
        await AuthManager.getValidToken(); // Lança erro se não houver token.
        throw new Error(AUTH_MISSING_ERROR);
      }

      return await getDashboardData(nrDoc, (progress) => {
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

// ─── Estatísticas ─────────────────────────────────────────────────────────────

function calculateStats(data) {
  let totalAlunos = 0, totalTurmas = 0, totalNotas = 0, alunosComMedia = 0, aprovados = 0;

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

// ─── Pré-visualização de Aproveitamentos ─────────────────────────────────────

/**
 * Busca cálculos de aproveitamento (soma/média) para o período selecionado.
 * Usa fetchEscolaRS diretamente — token gerenciado pelo AuthManager de forma transparente.
 * Funciona em ambos os contextos (SW e página), sem necessidade de apiFetch interno.
 */
async function fetchPreVisualizacao(dashboardData, periodoStr, callbacks = {}) {
  const { onProgress } = callbacks;

  if (!dashboardData || !dashboardData.idRecHumano || !dashboardData.escolas) return {};

  const idRecHumano = dashboardData.idRecHumano;
  const numMatch = periodoStr.match(/\d+/);
  if (!numMatch) return {};

  const idPeriodo = numMatch[0];
  const isSemestre = periodoStr.toLowerCase().includes('sem');
  const targetType = isSemestre ? 'sem' : 'trim';

  const tasks = [];
  for (const escola of dashboardData.escolas) {
    for (const turma of escola.turmas) {
      for (const disc of turma.disciplinas) {
        if (disc.erro || !disc.id || !turma.id) continue;

        let idPeriodoCalculo = null;

        // Tenta resolver o ID do período a partir dos dados já carregados no dashboard.
        if (disc.alunos) {
          for (const aluno of disc.alunos) {
            if (!aluno.listaResultados) continue;
            const res = aluno.listaResultados.find(r => {
              const nomeP = (r.nomePeriodo || '').toLowerCase();
              return nomeP.includes(targetType) && nomeP.includes(idPeriodo) && !nomeP.includes('er');
            });
            if (res) {
              idPeriodoCalculo = res.idPeriodoAvaliacao || res.idPeriodo || res.periodoId || res.id;
              if (idPeriodoCalculo) break;
            }
          }
        }

        // Fallback: busca via listarAvaliacoesTurma (fetchEscolaRS com auth automático).
        if (!idPeriodoCalculo) {
          try {
            const arrayAvals = await fetchEscolaRS(`listarAvaliacoesTurma/${turma.id}/${disc.id}/${idRecHumano}`);
            if (Array.isArray(arrayAvals)) {
              const avEncontrada = arrayAvals.find(a => {
                const desc = (a.descricao || '').toLowerCase();
                return desc.includes(targetType) && desc.includes(idPeriodo) && !desc.includes('er');
              });
              if (avEncontrada) idPeriodoCalculo = avEncontrada.id;
            }
          } catch (err) {
            console.warn(`[Dashboard Service] Falha ao buscar período para turma ${turma.id}:`, err.message);
          }
        }

        if (idPeriodoCalculo) {
          tasks.push({ idTurma: turma.id, idDisciplina: disc.id, idPeriodoAvaliacao: idPeriodoCalculo });
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
        const data = await fetchEscolaRS(endpoint);
        if (data?.calculosAproveitamentos) {
          for (const calc of data.calculosAproveitamentos) {
            const valObj = { soma: calc.soma, media: calc.media };
            if (calc.idAluno != null) resultados[`${calc.idAluno}_${task.idDisciplina}`] = valObj;
            if (calc.matricula != null) resultados[`${calc.matricula}_${task.idDisciplina}`] = valObj;
            if (calc.id != null) resultados[`${calc.id}_${task.idDisciplina}`] = valObj;
          }
        }
      } catch (e) {
        console.error('[Dashboard Service] Erro na pré-visualização:', e);
      } finally {
        concluidos++;
        if (onProgress) onProgress(Math.round((concluidos / tasks.length) * 100));
      }
    }));
  }

  return resultados;
}

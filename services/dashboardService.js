/**
 * Dashboard Service - Orquestração de construção do dashboard
 * Responsável por coordenar chamadas à API e lógica de negócio
 */

/**
 * Constrói o objeto completo do dashboard com todos os dados do professor.
 * O token é lido uma vez do storage no início e passado para todas as chamadas.
 * Em caso de 401, o fetchEscolaRS automaticamente busca o token mais recente.
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

  const totalTurmas = infoInicial.escolas.reduce((acc, escola) => acc + escola.turmas.length, 0);

  const dashboardPayload = {
    professor: infoInicial.nome,
    cpf: nrDoc,
    data_exportacao: new Date().toISOString(),
    escolas: []
  };

  let turmaAtual = 0;

  // 2. Processar escolas em paralelo mantendo ordem
  const escolas = await Promise.all(infoInicial.escolas.map(async (escola) => {
    const turmas = await Promise.all(escola.turmas.map(async (turma) => {
      turmaAtual++;
      const percentage = Math.round((turmaAtual / totalTurmas) * 100);

      if (onProgress) {
        onProgress({
          percentage,
          status: `Processando ${turma.nome} (${turmaAtual}/${totalTurmas})`
        });
      }

      onProgress({
        percentage,
        status: `Gerando tabela com as notas`
      })

      // Todas as disciplinas desta turma em paralelo
      const disciplinasResultados = await Promise.allSettled(
        turma.disciplinas.map(async (disc) => {
          const resultados = await listarResultadosTurma(
            turma.id,
            disc.id,
            idRecHumano,
            token
          );

          const alunosComMedia = resultados.alunos.map(processarAluno);

          return {
            disciplina: disc.nome,
            carga_horaria: disc.qtAulasPrevistas,
            alunos: alunosComMedia,
            erro: null
          };
        })
      );

      const disciplinas = disciplinasResultados.map((resultado, idx) => {
        if (resultado.status === 'fulfilled') {
          return resultado.value;
        } else {
          const disc = turma.disciplinas[idx];
          const mensagemErro = resultado.reason?.message || 'Erro desconhecido ao carregar disciplina';
          console.warn(`[Dashboard] Erro ao carregar ${turma.nome} - ${disc.nome}:`, mensagemErro);
          return {
            disciplina: disc.nome,
            carga_horaria: disc.qtAulasPrevistas,
            alunos: [],
            erro: mensagemErro
          };
        }
      });

      return {
        nome: turma.nome,
        serie: turma.idSerie,
        disciplinas: disciplinas
      };
    }));

    return {
      nome: escola.nome,
      turmas: turmas
    };
  }));

  dashboardPayload.escolas = escolas;
  return dashboardPayload;
}

/**
 * Wrapper que lê autenticação do storage e constrói o dashboard
 * @returns {Promise<Object>} Dados do dashboard
 */
async function buildDashboardFromStorage() {
  const authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);

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

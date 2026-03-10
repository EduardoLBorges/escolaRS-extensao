/**
 * Dashboard Service - Orquestração de construção do dashboard
 * Responsável por coordenar chamadas à API e lógica de negócio
 */

/**
 * Constrói o objeto completo do dashboard com todos os dados do professor
 * OTIMIZAÇÃO: Requisições por turma executadas em PARALELO usando Promise.all
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

  // Calcular total de turmas para rastreamento de progresso
  const totalTurmas = infoInicial.escolas.reduce((acc, escola) => acc + escola.turmas.length, 0);

  const dashboardPayload = {
    professor: infoInicial.nome,
    cpf: nrDoc,
    data_exportacao: new Date().toISOString(),
    escolas: []
  };

  let turmaAtual = 0;

  // 2. Processar escolas mantendo ordem
  const escolas = await Promise.all(infoInicial.escolas.map(async (escola) => {
    const turmas = await Promise.all(escola.turmas.map(async (turma) => {
      turmaAtual++;
      const percentage = Math.round((turmaAtual / totalTurmas) * 100);

      // Chamar callback de progresso
      if (onProgress) {
        onProgress({
          percentage,
          status: `Processando ${turma.nome} (${turmaAtual}/${totalTurmas})`
        });
      }

      // *** PARALELIZAÇÃO: Todas as disciplinas desta turma em paralelo ***
      // Usar allSettled para capturar erros sem parar o carregamento
      const disciplinasResultados = await Promise.allSettled(
        turma.disciplinas.map(async (disc) => {
          const resultados = await listarResultadosTurma(
            turma.id,
            disc.id,
            idRecHumano,
            token
          );
          
          // Processa alunos adicionando médias e notas
          const alunosComMedia = resultados.alunos.map(processarAluno);

          return {
            disciplina: disc.nome,
            carga_horaria: disc.qtAulasPrevistas,
            alunos: alunosComMedia,
            erro: null // Sucesso
          };
        })
      );

      // Processar resultados de allSettled
      const disciplinas = disciplinasResultados.map((resultado, idx) => {
        if (resultado.status === 'fulfilled') {
          return resultado.value;
        } else {
          // Capturar erro
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
 * Wrapper assíncrono para getDashboardData que integra com chrome.storage
 * @returns {Promise<Object>} Dados do dashboard
 * @throws {Error} Se falhar
 */
async function buildDashboardFromStorage() {
  const authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);
  
  if (!authData.escolaRsToken || !authData.nrDoc) {
    throw new Error("Dados de autenticação não encontrados. Por favor, acesse o portal EscolaRS primeiro.");
  }

  return getDashboardData(authData.escolaRsToken, authData.nrDoc, (progress) => {
    // Enviar mensagem de progresso para o dashboard
    chrome.runtime.sendMessage({
      action: 'updateProgress',
      percentage: progress.percentage,
      status: progress.status
    }).catch(() => {
      // Ignorar erros se não há listener (dashboard não aberto)
    });
  });
}

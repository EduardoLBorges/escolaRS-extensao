// Função auxiliar para buscar dados na API
async function fetchEscolaRS(endpoint, token) {
  const url = `https://secweb.procergs.com.br/ise-escolars-professor/rest/professor/${endpoint}`;
  console.log(`[Background] Buscando: ${url}`);
  
  const response = await fetch(url, {
    method: 'GET',
    headers: { 
      "Authorization": token,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Erro na API (${response.status}): ${response.statusText}`);
  }
  return response.json();
}

// Função principal de processamento
async function processarExportacao(sendResponse) {
  try {
    // Busca dados do storage
    const data = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);
    
    if (!data.escolaRsToken || !data.nrDoc) {
      sendResponse({ success: false, error: "Token não encontrado. Recarregue a página do EscolaRS (F5)." });
      return;
    }

    console.log("[Background] Iniciando extração para:", data.nrDoc);

    // 1. Busca Escolas e Turmas
    const infoInicial = await fetchEscolaRS(`listarEscolasDoProfessorEChamadas/${data.nrDoc}`, data.escolaRsToken);
    const idRecHumano = infoInicial.idRecHumano;

    let exportacaoFinal = {
      professor: infoInicial.nome,
      cpf: data.nrDoc,
      data_exportacao: new Date().toISOString(),
      escolas: []
    };

    // 2. Loop pelas escolas
    for (let escola of infoInicial.escolas) {
      let escolaObj = { nome: escola.nome, turmas: [] };
      
      for (let turma of escola.turmas) {
        let turmaObj = { 
          nome: turma.nome, 
          serie: turma.idSerie, 
          disciplinas: [] 
        };
        
        for (let disc of turma.disciplinas) {
          // Busca notas
          const resultados = await fetchEscolaRS(
            `listarAulasDaTurmaComResultado/${turma.id}/${disc.id}/${idRecHumano}`, 
            data.escolaRsToken
          );
          
          turmaObj.disciplinas.push({
            disciplina: disc.nome,
            carga_horaria: disc.qtAulasPrevistas,
            alunos: resultados.alunos.map(aluno => ({
              matricula: aluno.matricula,
              nome: aluno.nome,
              situacao: aluno.situacao.descricao,
              notas: aluno.listaResultados.map(res => ({
                 trimestre: res.nomePeriodo,
                 nota: res.resultado
              }))
            }))
          });
        }
        escolaObj.turmas.push(turmaObj);
      }
      exportacaoFinal.escolas.push(escolaObj);
    }

    console.log("[Background] Exportação concluída!");
    sendResponse({ success: true, data: exportacaoFinal });

  } catch (error) {
    console.error("[Background] Erro fatal:", error);
    sendResponse({ success: false, error: error.message });
  }
}

// OUVINTE DE MENSAGENS (A parte crítica)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "exportarDados") {
    console.log("[Background] Mensagem recebida. Iniciando processo...");
    
    // Chama a função async, mas não espera ela (promise) aqui dentro
    processarExportacao(sendResponse);
    
    // OBRIGATÓRIO: Retornar true imediatamente para manter o canal aberto
    return true; 
  }
});
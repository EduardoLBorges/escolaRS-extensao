// --- FUNÇÕES DE LÓGICA CENTRAL ---

/**
 * Busca todos os dados do professor, calcula as médias e retorna um único objeto.
 */
async function getDashboardData() {
  console.log('[Background] getDashboardData foi chamada.');

  // 1. Obter token e nrDoc do storage
  const authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);
  if (!authData.escolaRsToken || !authData.nrDoc) {
    throw new Error("Dados de autenticação não encontrados. Por favor, acesse o portal EscolaRS primeiro.");
  }

  // 2. Buscar dados iniciais (escolas, turmas, etc.)
  const infoInicial = await fetchEscolaRS(`listarEscolasDoProfessorEChamadas/${authData.nrDoc}`, authData.escolaRsToken);
  const idRecHumano = infoInicial.idRecHumano;

  const dashboardPayload = {
    professor: infoInicial.nome,
    cpf: authData.nrDoc,
    data_exportacao: new Date().toISOString(),
    escolas: []
  };

  // 3. Iterar e buscar os detalhes de cada turma
  for (let escola of infoInicial.escolas) {
    const escolaObj = { nome: escola.nome, turmas: [] };
    
    for (let turma of escola.turmas) {
      const turmaObj = { 
        nome: turma.nome, 
        serie: turma.idSerie, 
        disciplinas: [] 
      };
      
      for (let disc of turma.disciplinas) {
        const resultados = await fetchEscolaRS(
          `listarAulasDaTurmaComResultado/${turma.id}/${disc.id}/${idRecHumano}/false`, 
          authData.escolaRsToken
        );
        
        const alunosComMedia = resultados.alunos.map(aluno => ({
          ...aluno,
          mediaFinal: calcularMediaFinal(aluno.listaResultados || []),
          // Mapeia as notas para o formato esperado pelo dashboard.js
          notas: (aluno.listaResultados || []).map(res => ({
             trimestre: res.nomePeriodo,
             nota: res.resultado
          }))
        }));

        turmaObj.disciplinas.push({
          disciplina: disc.nome,
          carga_horaria: disc.qtAulasPrevistas,
          alunos: alunosComMedia
        });
      }
      escolaObj.turmas.push(turmaObj);
    }
    dashboardPayload.escolas.push(escolaObj);
  }

  console.log('[Background] Payload do dashboard montado:', dashboardPayload);
  return dashboardPayload;
}


// --- OUVINTES DE EVENTOS DA EXTENSÃO ---

// Abre o dashboard ou guia o usuário se a autenticação não for encontrada
chrome.action.onClicked.addListener(async (tab) => {
  const authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');

  // Se temos autenticação, abre o dashboard
  if (authData.escolaRsToken && authData.nrDoc) {
    // Verifica se o dashboard já está aberto
    const existingTabs = await chrome.tabs.query({ url: dashboardUrl });
    if (existingTabs.length > 0) {
      chrome.tabs.update(existingTabs[0].id, { active: true });
      chrome.windows.update(existingTabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: dashboardUrl });
    }
    return;
  }

  // Se não temos autenticação, ajuda o usuário
  const portalUrl = "https://professor.escola.rs.gov.br/*";
  const portalTabs = await chrome.tabs.query({ url: portalUrl });

  if (portalTabs.length > 0) {
    // Se uma aba do portal já existe, foca nela
    const targetTab = portalTabs[0];
    chrome.tabs.update(targetTab.id, { active: true });
    chrome.windows.update(targetTab.windowId, { focused: true });
    // Notifica o usuário para tentar de novo
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'EscolaRS Export',
      message: 'Verificando sua autenticação. Por favor, aguarde alguns segundos e clique no ícone da extensão novamente.'
    });
  } else {
    // Se não há aba do portal, abre uma nova
    chrome.tabs.create({ url: "https://professor.escola.rs.gov.br/" });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'EscolaRS Export',
      message: 'Por favor, faça o login no portal EscolaRS. Depois de logado, clique no ícone da extensão novamente.'
    });
  }
});

// Ouve por pedidos de dados vindos do dashboard
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getDashboardData") {
    (async () => {
      try {
        const data = await getDashboardData();
        sendResponse({ success: true, data: data });
      } catch (error) {
        console.error('[Background] Erro ao construir dados do dashboard:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Indica resposta assíncrona
  }
});


// --- FUNÇÕES DE CÁLCULO E API ---

async function fetchEscolaRS(endpoint, token) {
  const url = `https://secweb.procergs.com.br/ise-escolars-professor/rest/professor/${endpoint}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { "Authorization": token, "Content-Type": "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Erro na API (${response.status}): ${response.statusText}`);
  }
  return response.json();
}

function getNotaValor(lista, periodo) {
  // Normaliza string removendo todos os diacríticos e símbolos especiais
  const normalizarString = (str) => {
    return String(str)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ");
  };
  
  const periodoNormalizado = normalizarString(periodo);
  
  const item = lista.find(r => {
    const nomeNormalizado = normalizarString(r.nomePeriodo || r.trimestre || "");
    return nomeNormalizado === periodoNormalizado;
  });
  
  if (!item || item.resultado === "--" || item.resultado == null || item.nota === "--" || item.nota == null) {
    return -1;
  }
  
  const valor = item.resultado ?? item.nota;
  return parseFloat(String(valor).replace(",", "."));
}

function calcularMediaFinal(listaResultados) {
  // Cria um mapa dos períodos encontrados para fácil acesso
  const periodos = {};
  
  for (const resultado of listaResultados) {
    const nomePeriodo = (resultado.nomePeriodo || "").toLowerCase().trim();
    const valor = resultado.resultado;
    
    // Armazena apenas se o valor não é "-"
    if (valor && valor !== "--" && valor !== "-") {
      periodos[nomePeriodo] = parseFloat(String(valor).replace(",", "."));
    }
  }
  
  // Encontra os trimestres e ERs
  let trim1 = -1, trim2 = -1, trim3 = -1;
  
  // Procura pelos padrões dos períodos (case-insensitive)
  for (const [chave, valor] of Object.entries(periodos)) {
    if (chave.includes("trim") && chave.includes("1") && !chave.includes("er")) {
      trim1 = Math.max(trim1, valor);
    } else if (chave.includes("1") && chave.includes("tri")) {
      trim1 = Math.max(trim1, valor);
    }
    
    if (chave.includes("trim") && chave.includes("2") && !chave.includes("er")) {
      trim2 = Math.max(trim2, valor);
    } else if (chave.includes("2") && chave.includes("tri")) {
      trim2 = Math.max(trim2, valor);
    }
    
    if (chave.includes("trim") && chave.includes("3") && !chave.includes("er")) {
      trim3 = Math.max(trim3, valor);
    } else if (chave.includes("3") && chave.includes("tri")) {
      trim3 = Math.max(trim3, valor);
    }
  }
  
  // Se algum trimestre não foi encontrado, retorna 0
  if (trim1 < 0 || trim2 < 0 || trim3 < 0) {
    return 0;
  }

  const media = ((trim1 * 3) + (trim2 * 3) + (trim3 * 4)) / 10;
  return parseFloat(media.toFixed(1));
}

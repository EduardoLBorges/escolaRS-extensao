// --- IMPORTAÇÃO DE MÓDULOS ---
// Nota: Em Manifest V3, utilizamos importScripts para Worker scripts
// Os módulos são carregados antes deste arquivo
importScripts('api/escolaRS.js', 'utils/notas.js', 'services/dashboardService.js');


// --- OUVINTES DE EVENTOS DA EXTENSÃO ---

// Abre o dashboard ou guia o usuário se a autenticação não for encontrada
chrome.action.onClicked.addListener(async (tab) => {
  const authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);
  const dashboardUrl = chrome.runtime.getURL('ui/dashboard/dashboard.html');

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
      iconUrl: 'images/icons/icon128.png',
      title: 'EscolaRS Export',
      message: 'Verificando sua autenticação. Por favor, aguarde alguns segundos e clique no ícone da extensão novamente.'
    });
  } else {
    // Se não há aba do portal, abre uma nova
    chrome.tabs.create({ url: "https://professor.escola.rs.gov.br/" });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icons/icon128.png',
      title: 'EscolaRS Export',
      message: 'Por favor, faça o login no portal EscolaRS. Depois de logado, clique no ícone da extensão novamente.'
    });
  }
});

// Ouve por pedidos de dados vindos do dashboard
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Listener para tokens capturados via interceptação de requisições
  if (request.action === "salvarTokenAutenticacao") {
    (async () => {
      if (!request.token) {
        sendResponse({ success: false, error: "Token vazio" });
        return;
      }

      try {
        // Obter token anterior
        const authData = await chrome.storage.local.get(["escolaRsToken"]);
        const tokenAnterior = authData.escolaRsToken;

        // Só salvar se o token mudou
        if (tokenAnterior !== request.token) {
          await chrome.storage.local.set({ escolaRsToken: request.token });
          console.log('[Background] Token de autenticação capturado e atualizado via interceptação');
        }

        sendResponse({ success: true, mensagem: "Token salvo com sucesso" });
      } catch (error) {
        console.error('[Background] Erro ao salvar token:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Indica resposta assíncrona
  }

  if (request.action === "getDashboardData") {
    (async () => {
      try {
        // Delega para o serviço de dashboard
        const data = await buildDashboardFromStorage();
        sendResponse({ success: true, data: data });
      } catch (error) {
        console.error('[Background] Erro ao construir dados do dashboard:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Indica resposta assíncrona
  }
});

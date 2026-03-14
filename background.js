// --- IMPORTAÇÃO DE MÓDULOS ---
importScripts('api/escolaRS.js', 'utils/notas.js', 'services/dashboardService.js');


// --- INTERCEPTAÇÃO DE TOKEN VIA webRequest ---
// Captura o token Bearer de qualquer requisição feita pelo navegador
// às URLs do EscolaRS — funciona independente de contexto ou framework do SPA

let ultimoToken = null;

const DASHBOARD_CACHE_KEY = 'dashboardCache';

function getCachedDashboardData() {
  return new Promise((resolve) => {
    chrome.storage.local.get([DASHBOARD_CACHE_KEY], (result) => {
      const cached = result[DASHBOARD_CACHE_KEY] || null;
      resolve(cached);
    });
  });
}

function setCachedDashboardData(data) {
  chrome.storage.local.set({
    [DASHBOARD_CACHE_KEY]: {
      data,
      fetchedAt: new Date().toISOString()
    }
  });
}

function clearCachedDashboardData() {
  chrome.storage.local.remove([DASHBOARD_CACHE_KEY]);
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const authHeader = details.requestHeaders.find(
      (h) => h.name.toLowerCase() === 'authorization'
    );

    if (!authHeader || !authHeader.value) return;

    const match = authHeader.value.match(/^Bearer\s+(.+)$/i);
    if (!match) return;

    const tokenCapturado = authHeader.value;

    if (tokenCapturado === ultimoToken) return;
    ultimoToken = tokenCapturado;

    chrome.storage.local.set({ escolaRsToken: tokenCapturado }, () => {
      console.log('[Background] Token atualizado via webRequest.');
    });
  },
  {
    urls: [
      "https://*.procergs.com.br/*",
      "https://professor.escola.rs.gov.br/*"
    ]
  },
  ["requestHeaders"]
);


// --- OUVINTES DE EVENTOS DA EXTENSÃO ---

chrome.action.onClicked.addListener(async (tab) => {
  const authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);
  const dashboardUrl = chrome.runtime.getURL('ui/dashboard/dashboard.html');

  if (authData.escolaRsToken && authData.nrDoc) {
    const existingTabs = await chrome.tabs.query({ url: dashboardUrl });
    if (existingTabs.length > 0) {
      chrome.tabs.update(existingTabs[0].id, { active: true });
      chrome.windows.update(existingTabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: dashboardUrl });
    }
    return;
  }

  const portalTabs = await chrome.tabs.query({ url: "https://professor.escola.rs.gov.br/*" });

  if (portalTabs.length > 0) {
    const targetTab = portalTabs[0];
    chrome.tabs.update(targetTab.id, { active: true });
    chrome.windows.update(targetTab.windowId, { focused: true });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icons/icon128.png',
      title: 'EscolaRS Export',
      message: 'Autenticação não realizada. Por favor, atualize a página e clique no ícone da extensão novamente.'
    });
  } else {
    chrome.tabs.create({ url: "https://professor.escola.rs.gov.br/" });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icons/icon128.png',
      title: 'EscolaRS Export',
      message: 'Por favor, faça o login no portal EscolaRS. Depois de logado, clique no ícone da extensão novamente.'
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getDashboardData" || request.action === "refreshDashboardData") {
    (async () => {
      try {
        if (request.action === "refreshDashboardData" || request.forceRefresh) {
          clearCachedDashboardData();
        }

        const cached = await getCachedDashboardData();
        if (cached && request.action !== "refreshDashboardData" && !request.forceRefresh) {
          sendResponse({
            success: true,
            data: cached.data,
            cached: true,
            cachedAt: cached.fetchedAt
          });
          return;
        }

        const data = await buildDashboardFromStorage();
        setCachedDashboardData(data);

        sendResponse({
          success: true,
          data,
          cached: false,
          cachedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error('[Background] Erro ao construir dados do dashboard:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});

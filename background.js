// --- IMPORTAÇÃO DE MÓDULOS ---
importScripts('api/escolaRS.js', 'utils/notas.js', 'services/dashboardService.js');


// --- INTERCEPTAÇÃO DE AUTENTICAÇÃO VIA webRequest ---
// Captura o token Bearer e o nrDoc de requisições feitas pelo navegador
// às URLs do EscolaRS — funciona independente de contexto ou framework do SPA

let ultimoToken = null;
let ultimoNrDoc = null;

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
    // 1. Capturar Token de Autenticação
    const authHeader = details.requestHeaders.find(
      (h) => h.name.toLowerCase() === 'authorization'
    );

    if (authHeader && authHeader.value) {
      const match = authHeader.value.match(/^Bearer\s+(.+)$/i);
      if (match) {
        const tokenCapturado = authHeader.value;
        if (tokenCapturado !== ultimoToken) {
          ultimoToken = tokenCapturado;
          chrome.storage.local.set({ escolaRsToken: tokenCapturado }, () => {
            console.log('[Background] Token atualizado via webRequest.');
          });
        }
      }
    }

    // 2. Capturar nrDoc da URL
    const nrDocRegex = /listarEscolasDoProfessorEChamadas\/(\d+)/;
    const urlMatch = details.url.match(nrDocRegex);

    if (urlMatch && urlMatch[1]) {
      const nrDocCapturado = urlMatch[1];
      if (nrDocCapturado !== ultimoNrDoc) {
        ultimoNrDoc = nrDocCapturado;
        chrome.storage.local.set({ nrDoc: nrDocCapturado }, () => {
          console.log('[Background] nrDoc atualizado via webRequest.');
        });
      }
    }
  },
  {
    urls: [
      "https://*.procergs.com.br/*",
      "https://professor.escola.rs.gov.br/*"
    ]
  },
  ["requestHeaders"]
);

// Limpa cache em memória do background caso algum dado seja apagado manualmente no DevTools
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.escolaRsToken && !changes.escolaRsToken.newValue) {
      ultimoToken = null;
    }
    if (changes.nrDoc && !changes.nrDoc.newValue) {
      ultimoNrDoc = null;
    }
  }
});


// --- OUVINTES DE EVENTOS DA EXTENSÃO ---

chrome.action.onClicked.addListener(async (tab) => {
  let authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);
  
  // Se já temos token e nrDoc, valida se ainda é funcional
  if (authData.escolaRsToken && authData.nrDoc) {
    console.log('[Background] Validando token existente...');
    try {
      // Uma chamada simples para testar o token. Se falhar com 401, o fetchEscolaRS
      // disparará o trySilentTokenRefresh automaticamente.
      await listarEscolasProfessor(authData.nrDoc, authData.escolaRsToken);
      console.log('[Background] Token validado com sucesso.');
      authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]); // Pega o token possivelmente renovado
    } catch (e) {
      console.warn('[Background] Token inválido ou erro na validação. Renovação disparada:', e);
      // O fetchEscolaRS já deve ter disparado a renovação, mas por segurança garantimos aqui
      authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);
    }
  } else if (!authData.escolaRsToken) {
    console.log('[Background] Token ausente no clique inicial. Tentando renovar silenciosamente...');
    try {
      await trySilentTokenRefresh(null);
      authData = await chrome.storage.local.get(["escolaRsToken", "nrDoc"]);
    } catch (e) {
      console.log('[Background] Renovação no clique falhou:', e);
    }
  }

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

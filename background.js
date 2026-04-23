// --- IMPORTAÇÃO DE MÓDULOS ---
importScripts('api/escolaRS.js', 'utils/notas.js', 'services/dashboardService.js');


// ─── Constantes & Estado ────────────────────────────────────────────

const DASHBOARD_CACHE_KEY = 'dashboardCache';
const NOTIFICATION_ICON = 'images/icons/icon128.png';
const NOTIFICATION_TITLE = 'EscolaRS Export';
const PORTAL_MATCH_URL = 'https://professor.escola.rs.gov.br/*';
const API_URL_PATTERNS = [
  'https://*.procergs.com.br/*',
  'https://professor.escola.rs.gov.br/*',
];

let ultimoToken = null;
let ultimoNrDoc = null;

// ─── Cache Helpers ──────────────────────────────────────────────────

async function getCachedDashboardData() {
  const result = await chrome.storage.local.get([DASHBOARD_CACHE_KEY]);
  return result[DASHBOARD_CACHE_KEY] || null;
}

function setCachedDashboardData(data) {
  chrome.storage.local.set({
    [DASHBOARD_CACHE_KEY]: {
      data,
      fetchedAt: new Date().toISOString(),
    },
  });
}

function clearCachedDashboardData() {
  chrome.storage.local.remove([DASHBOARD_CACHE_KEY]);
}

// ─── Auth Helpers ───────────────────────────────────────────────────

/**
 * Lê token e nrDoc do chrome.storage.
 * @returns {Promise<{escolaRsToken: string|null, nrDoc: string|null}>}
 */
async function getAuthData() {
  return chrome.storage.local.get(['escolaRsToken', 'nrDoc']);
}

/**
 * Exibe uma notificação ao usuário.
 * @param {string} message - Mensagem da notificação.
 */
function notifyUser(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: NOTIFICATION_ICON,
    title: NOTIFICATION_TITLE,
    message,
  });
}

// ─── Dashboard Tab Management ───────────────────────────────────────

/**
 * Abre ou foca a aba do dashboard.
 */
async function openOrFocusDashboard() {
  const dashboardUrl = chrome.runtime.getURL('ui/dashboard/dashboard.html');
  const existingTabs = await chrome.tabs.query({ url: dashboardUrl });

  if (existingTabs.length > 0) {
    chrome.tabs.update(existingTabs[0].id, { active: true });
    chrome.windows.update(existingTabs[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: dashboardUrl });
  }
}

/**
 * Lida com o caso em que não há autenticação disponível.
 * Foca a aba do portal existente ou abre uma nova e notifica o usuário.
 */
async function handleMissingAuth() {
  const portalTabs = await chrome.tabs.query({ url: PORTAL_MATCH_URL });

  if (portalTabs.length > 0) {
    chrome.tabs.update(portalTabs[0].id, { active: true });
    chrome.windows.update(portalTabs[0].windowId, { focused: true });
    notifyUser('Autenticação não realizada. Por favor, atualize a página e clique no ícone da extensão novamente.');
  } else {
    chrome.tabs.create({ url: 'https://professor.escola.rs.gov.br/' });
    notifyUser('Por favor, faça o login no portal EscolaRS. Depois de logado, clique no ícone da extensão novamente.');
  }
}

// ─── INTERCEPTAÇÃO DE AUTENTICAÇÃO VIA webRequest ───────────────────
// Captura o token Bearer e o nrDoc de requisições feitas pelo navegador
// às URLs do EscolaRS — funciona independente de contexto ou framework do SPA

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    captureTokenFromHeaders(details.requestHeaders);
    captureNrDocFromUrl(details.url);
  },
  { urls: API_URL_PATTERNS },
  ['requestHeaders']
);

/**
 * Extrai e persiste o token Bearer dos headers da requisição.
 * @param {Array} headers - Lista de headers da requisição.
 */
function captureTokenFromHeaders(headers) {
  const authHeader = headers.find((h) => h.name.toLowerCase() === 'authorization');
  if (!authHeader?.value) return;

  const match = authHeader.value.match(/^Bearer\s+(.+)$/i);
  if (!match) return;

  const tokenCapturado = authHeader.value;
  if (tokenCapturado === ultimoToken) return;

  ultimoToken = tokenCapturado;
  chrome.storage.local.set({ escolaRsToken: tokenCapturado }, () => {
    console.log('[Background] Token atualizado via webRequest.');
  });
}

/**
 * Extrai e persiste o nrDoc da URL da requisição.
 * @param {string} url - URL da requisição interceptada.
 */
function captureNrDocFromUrl(url) {
  const urlMatch = url.match(/listarEscolasDoProfessorEChamadas\/(\d+)/);
  if (!urlMatch?.[1]) return;

  const nrDocCapturado = urlMatch[1];
  if (nrDocCapturado === ultimoNrDoc) return;

  ultimoNrDoc = nrDocCapturado;
  chrome.storage.local.set({ nrDoc: nrDocCapturado }, () => {
    console.log('[Background] nrDoc atualizado via webRequest.');
  });
}

// Limpa cache em memória do background caso algum dado seja apagado manualmente no DevTools
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;
  if (changes.escolaRsToken && !changes.escolaRsToken.newValue) ultimoToken = null;
  if (changes.nrDoc && !changes.nrDoc.newValue) ultimoNrDoc = null;
});


// ─── OUVINTES DE EVENTOS DA EXTENSÃO ────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  let authData = await getAuthData();

  // Se já temos token e nrDoc, valida se ainda é funcional
  if (authData.escolaRsToken && authData.nrDoc) {
    console.log('[Background] Validando token existente...');
    try {
      // Uma chamada simples para testar o token. Se falhar com 401, o fetchEscolaRS
      // disparará o trySilentTokenRefresh automaticamente.
      await listarEscolasProfessor(authData.nrDoc, authData.escolaRsToken);
      console.log('[Background] Token validado com sucesso.');
      authData = await getAuthData(); // Pega o token possivelmente renovado
    } catch (e) {
      console.warn('[Background] Token inválido ou erro na validação. Renovação disparada:', e);
      authData = await getAuthData();
    }
  } else if (!authData.escolaRsToken) {
    console.log('[Background] Token ausente no clique inicial. Tentando renovar silenciosamente...');
    try {
      await trySilentTokenRefresh(null);
      authData = await getAuthData();
    } catch (e) {
      console.log('[Background] Renovação no clique falhou:', e);
    }
  }

  if (authData.escolaRsToken && authData.nrDoc) {
    await openOrFocusDashboard();
    return;
  }

  await handleMissingAuth();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStudentPhoto') {
    (async () => {
      try {
        const { escolaRsToken } = await chrome.storage.local.get('escolaRsToken');
        const result = await buscarFotoDoAluno(request.matricula, request.idTurma, escolaRsToken);
        sendResponse({ success: true, data: result });
      } catch (error) {
        console.error('[Background] Erro ao buscar foto do aluno:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.action !== 'getDashboardData' && request.action !== 'refreshDashboardData') {
    return;
  }

  (async () => {
    try {
      const isRefresh = request.action === 'refreshDashboardData' || request.forceRefresh;

      if (!isRefresh) {
        const cached = await getCachedDashboardData();
        if (cached) {
          sendResponse({ success: true, data: cached.data, cached: true, cachedAt: cached.fetchedAt });
          return;
        }
      }

      const data = await buildDashboardFromStorage();
      setCachedDashboardData(data);
      sendResponse({ success: true, data, cached: false, cachedAt: new Date().toISOString() });
    } catch (error) {
      console.error('[Background] Erro ao construir dados do dashboard:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true;
});

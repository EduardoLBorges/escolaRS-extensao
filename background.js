// --- IMPORTAÇÃO DE MÓDULOS ---
// authManager.js deve ser importado ANTES de escolaRS.js para que AuthManager
// esteja disponível quando trySilentTokenRefresh for definida.
importScripts(
  'auth/authManager.js',
  'api/escolaRS.js',
  'utils/aluno.js',
  'utils/string.js',
  'utils/notas.js',
  'utils/filtroParser.js',
  'services/dashboardService.js'
);

// ─── Constantes & Estado ─────────────────────────────────────────────────────

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

// ─── Cache do Dashboard ───────────────────────────────────────────────────────

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

// ─── Helpers de UI ────────────────────────────────────────────────────────────

function notifyUser(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: NOTIFICATION_ICON,
    title: NOTIFICATION_TITLE,
    message,
  });
}

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
 * Garante que temos autenticação completa (token válido e nrDoc).
 * Se faltar qualquer credencial ou a sessão estiver expirada, tenta renovação silenciosa
 * e recorre ao popup de login se necessário.
 * @returns {Promise<{token: string, nrDoc: string}>}
 */
async function ensureAuthentication() {
  let { nrDoc } = await chrome.storage.local.get('nrDoc');
  let token = null;

  try {
    token = await AuthManager.getValidToken();
  } catch (e) {
    console.log('[Background] getValidToken falhou ou expirado:', e.message);
  }

  // Se faltar token ou nrDoc, dispara renovação (tenta POST e depois popup de login)
  if (!token || !nrDoc) {
    console.log('[Background] Credenciais incompletas. Iniciando trySilentTokenRefresh...');
    token = await trySilentTokenRefresh(token);
    const updated = await chrome.storage.local.get('nrDoc');
    nrDoc = updated.nrDoc;
  }

  // Valida com uma chamada real de API
  if (token && nrDoc) {
    try {
      await listarEscolasProfessor(nrDoc);
      return { token, nrDoc };
    } catch (apiErr) {
      console.warn('[Background] Validação com API falhou, forçando popup:', apiErr.message);
      token = await trySilentTokenRefresh(token);
      const updated = await chrome.storage.local.get('nrDoc');
      nrDoc = updated.nrDoc;
      if (token && nrDoc) {
        return { token, nrDoc };
      }
    }
  }

  if (token && nrDoc) {
    return { token, nrDoc };
  }

  throw new Error('Autenticação não concluída. Por favor, tente novamente.');
}

// ─── Interceptação de Token via webRequest ────────────────────────────────────
//
// Captura o token Bearer e o nrDoc diretamente dos headers das requisições do portal.
// Esta é a fonte primária de tokens — não requer interação do usuário.

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    captureTokenFromHeaders(details.requestHeaders);
    captureNrDocFromUrl(details.url);
  },
  { urls: API_URL_PATTERNS },
  ['requestHeaders']
);

function captureTokenFromHeaders(headers) {
  const authHeader = headers.find((h) => h.name.toLowerCase() === 'authorization');
  if (!authHeader?.value) return;

  const match = authHeader.value.match(/^Bearer\s+(.+)$/i);
  if (!match) return;

  const tokenCapturado = authHeader.value;
  if (tokenCapturado === ultimoToken) return;

  ultimoToken = tokenCapturado;

  // Persiste no storage E atualiza o cache em memória do AuthManager.
  // Isso garante que todos os contextos (SW e páginas) recebam o token novo imediatamente.
  chrome.storage.local.set({ escolaRsToken: tokenCapturado }, () => {
    AuthManager.update(tokenCapturado);
    console.log('[Background] Token capturado e AuthManager atualizado via webRequest.');
  });
}

function captureNrDocFromUrl(url) {
  const urlMatch = url.match(/listarEscolasDoProfessorEChamadas\/(\d+)/);
  if (!urlMatch?.[1]) return;

  const nrDocCapturado = urlMatch[1];
  if (nrDocCapturado === ultimoNrDoc) return;

  ultimoNrDoc = nrDocCapturado;
  chrome.storage.local.set({ nrDoc: nrDocCapturado }, () => {
    console.log('[Background] nrDoc atualizado:', nrDocCapturado);
  });
}

// Limpa estado local se dados forem apagados manualmente (ex: DevTools).
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;
  if (changes.escolaRsToken && !changes.escolaRsToken.newValue) {
    ultimoToken = null;
    AuthManager.invalidate();
  }
  if (changes.nrDoc && !changes.nrDoc.newValue) ultimoNrDoc = null;
});

// ─── Ouvintes de Eventos da Extensão ─────────────────────────────────────────

// Clique no ícone da extensão: valida autenticação (abrindo popup se necessário) e abre o dashboard.
chrome.action.onClicked.addListener(async () => {
  try {
    await ensureAuthentication();
    await openOrFocusDashboard();
  } catch (e) {
    console.warn('[Background] Falha de autenticação no clique:', e.message);
    notifyUser('Falha de autenticação com o Portal EscolaRS. Tente novamente.');
  }
});

// ─── Handlers de Mensagens ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // Solicitação de refresh de token de um contexto de página.
  // Páginas não podem criar janelas popup diretamente; delegam ao SW.
  if (request.action === 'requestTokenRefresh') {
    (async () => {
      try {
        console.log('[Background] Página solicitou renovação de token.');
        const newToken = await trySilentTokenRefresh(request.staleToken || null);
        sendResponse({ success: true, token: newToken });
      } catch (error) {
        console.error('[Background] Falha ao renovar token para página:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Busca foto do aluno (chamada de página via message passing).
  if (request.action === 'getStudentPhoto') {
    (async () => {
      try {
        const result = await buscarFotoDoAluno(request.matricula, request.idTurma);
        sendResponse({ success: true, data: result });
      } catch (error) {
        console.error('[Background] Erro ao buscar foto do aluno:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Dados do dashboard (com ou sem força de refresh).
  if (request.action === 'getDashboardData' || request.action === 'refreshDashboardData') {
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
  }
});

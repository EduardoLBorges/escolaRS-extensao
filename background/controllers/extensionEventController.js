(() => {
  const API_URL_PATTERNS = [
    'https://*.procergs.com.br/*',
    'https://professor.escola.rs.gov.br/*',
  ];
  const NOTIFICATION_ICON = 'images/icons/icon128.png';
  const NOTIFICATION_TITLE = 'EscolaRS Export';

  let lastToken = null;
  let lastDocumentNumber = null;

  function captureToken(headers) {
    const authorization = headers.find((header) => header.name.toLowerCase() === 'authorization')?.value;
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match || authorization === lastToken) return;

    lastToken = authorization;
    chrome.storage.local.set({ escolaRsToken: authorization }, () => {
      AuthManager.update(authorization);
    });
  }

  function captureDocumentNumber(url) {
    const documentNumber = url.match(/listarEscolasDoProfessorEChamadas\/(\d+)/)?.[1];
    if (!documentNumber || documentNumber === lastDocumentNumber) return;

    lastDocumentNumber = documentNumber;
    chrome.storage.local.set({ nrDoc: documentNumber });
  }

  function notify(message) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: NOTIFICATION_ICON,
      title: NOTIFICATION_TITLE,
      message,
    });
  }

  async function openDashboard() {
    const dashboardUrl = chrome.runtime.getURL('ui/dashboard/dashboard.html');
    const tabs = await chrome.tabs.query({ url: dashboardUrl });
    if (tabs.length) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
      return;
    }
    await chrome.tabs.create({ url: dashboardUrl });
  }

  self.ExtensionEventController = Object.freeze({
    register() {
      chrome.webRequest.onBeforeSendHeaders.addListener(
        (details) => {
          captureToken(details.requestHeaders || []);
          captureDocumentNumber(details.url);
        },
        { urls: API_URL_PATTERNS },
        ['requestHeaders'],
      );

      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        if (changes.escolaRsToken && !changes.escolaRsToken.newValue) {
          lastToken = null;
          AuthManager.invalidate();
        }
        if (changes.nrDoc && !changes.nrDoc.newValue) lastDocumentNumber = null;
      });

      chrome.action.onClicked.addListener(async () => {
        try {
          await AuthenticationService.ensureAuthenticated();
          await openDashboard();
        } catch (error) {
          console.warn('[Background] Falha ao abrir dashboard:', error.message);
          notify('Falha de autenticação com o Portal EscolaRS. Tente novamente.');
        }
      });
    },
  });
})();

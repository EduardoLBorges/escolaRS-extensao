/**
 * Content Script da Extensão EscolaRS
 * Injetado em professor.escola.rs.gov.br e www.soe.rs.gov.br
 * Objetivo: Capturar o refresh_token invisivelmente para uso nas requisições em background.
 */

function captureOidcInfo() {
  try {
    const storages = [localStorage, sessionStorage];
    storages.forEach(storage => {
      if (!storage) return;
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key) continue;
        const val = storage.getItem(key);
        if (val && val.includes('refresh_token')) {
          try {
            const parsed = JSON.parse(val);
            if (parsed.refresh_token) {
              chrome.storage.local.get('escolaRsRefreshToken', (res) => {
                if (res.escolaRsRefreshToken !== parsed.refresh_token) {
                  chrome.storage.local.set({ escolaRsRefreshToken: parsed.refresh_token }, () => {
                    console.log('[EscolaRS Extensão] Refresh token capturado automaticamente do storage key:', key);
                  });
                }
              });
            }
            if (parsed.access_token && parsed.token_type) {
              const fullToken = `${parsed.token_type} ${parsed.access_token}`;
              chrome.storage.local.get('escolaRsToken', (res) => {
                if (res.escolaRsToken !== fullToken) {
                  chrome.storage.local.set({ escolaRsToken: fullToken });
                }
              });
            }
          } catch (e) {
            // Ignora se não for JSON válido
          }
        }
      }
    });
  } catch (err) {
    console.warn('[EscolaRS Extensão] Erro ao tentar extrair dados OIDC do storage:', err);
  }
}

// Executa a captura na inicialização
captureOidcInfo();

// Ouve qualquer alteração feita no storage pelo front-end do portal
window.addEventListener('storage', () => {
  captureOidcInfo();
});

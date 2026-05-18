/**
 * Content Script da Extensão EscolaRS
 * Injetado em professor.escola.rs.gov.br e www.soe.rs.gov.br
 * Objetivo: Capturar o refresh_token invisivelmente para uso nas requisições em background.
 */

function captureOidcInfo() {
  try {
    const oidcData = localStorage.getItem('user-oidc') || sessionStorage.getItem('user-oidc');
    if (oidcData) {
      const parsed = JSON.parse(oidcData);
      
      if (parsed.refresh_token) {
        chrome.storage.local.get('escolaRsRefreshToken', (res) => {
          if (res.escolaRsRefreshToken !== parsed.refresh_token) {
            chrome.storage.local.set({ escolaRsRefreshToken: parsed.refresh_token }, () => {
              console.log('[EscolaRS Extensão] Refresh token atualizado via storage da página.');
            });
          }
        });
      }
      
      // Também podemos aproveitar para manter o access token sincronizado
      if (parsed.access_token && parsed.token_type) {
        const fullToken = `${parsed.token_type} ${parsed.access_token}`;
        chrome.storage.local.get('escolaRsToken', (res) => {
          if (res.escolaRsToken !== fullToken) {
            chrome.storage.local.set({ escolaRsToken: fullToken });
          }
        });
      }
    }
  } catch (err) {
    console.warn('[EscolaRS Extensão] Erro ao tentar extrair dados OIDC do storage:', err);
  }
}

// Executa a captura na inicialização
captureOidcInfo();

// Ouve as mudanças que o front-end original faça no sessionStorage / localStorage
window.addEventListener('storage', (e) => {
  if (e.key === 'user-oidc') {
    captureOidcInfo();
  }
});

// Script injetado na página para interceptar requisições e capturar token
// Este script é injetado ANTES do carregamento do DOM para ter acesso ao fetch/XHR originais

(function() {
  'use strict';

  let ultimoToken = null;

  // Função para enviar token ao background.js
  function salvarToken(token) {
    if (!token || token === ultimoToken) return; // Evitar duplicatas

    ultimoToken = token;
    
    // Enviar para o background script via chrome.runtime
    try {
      chrome.runtime.sendMessage(
        { 
          action: 'salvarTokenAutenticacao',
          token: token
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.debug('[EscolaRS] Erro ao enviar token:', chrome.runtime.lastError);
          }
        }
      );
    } catch (e) {
      console.debug('[EscolaRS] Erro ao comunicar com background:', e);
    }
  }

  // Extrair token de um header Authorization
  function extrairToken(authHeader) {
    if (!authHeader) return null;
    
    // Formato: "Bearer token_value"
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
  }

  // Interceptar Fetch API
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const request = new Request(...args);
    const authHeader = request.headers.get('Authorization');
    
    if (authHeader) {
      const token = extrairToken(authHeader);
      if (token) {
        salvarToken(token);
      }
    }

    return originalFetch.apply(this, args);
  };

  // Interceptar XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    const originalSetRequestHeader = this.setRequestHeader;
    
    this.setRequestHeader = function(header, value) {
      if (header.toLowerCase() === 'authorization') {
        const token = extrairToken(value);
        if (token) {
          salvarToken(token);
        }
      }
      return originalSetRequestHeader.apply(this, arguments);
    };

    return originalOpen.apply(this, [method, url, ...rest]);
  };

  // Também tentar capturar via eventos de Network (alternativa)
  document.addEventListener('beforeunload', () => {
    // Buscar do sessionStorage se disponível
    try {
      const storedToken = sessionStorage.getItem('token_bearer');
      if (storedToken) {
        salvarToken(storedToken);
      }
    } catch (e) {
      // Ignorar erro
    }
  });

})();

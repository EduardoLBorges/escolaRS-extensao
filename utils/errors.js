/** Tratamento comum de erros para páginas, content script, worker e service worker. */
(() => {
  const PREFIX = '[EscolaRS]';

  function getMessage(error, fallback = 'Ocorreu um erro inesperado.') {
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error.message === 'string' && error.message.trim()) return error.message;
    return fallback;
  }

  function report(error, context = 'Erro da aplicação', options = {}) {
    const message = getMessage(error, options.fallback);
    const details = error instanceof Error ? error : new Error(message);
    console.error(`${PREFIX} ${context}:`, details);
    return message;
  }

  function installGlobalHandlers(scope = globalThis) {
    if (!scope?.addEventListener || scope.__escolaRsErrorHandlersInstalled) return;
    scope.__escolaRsErrorHandlersInstalled = true;

    scope.addEventListener('error', (event) => {
      // Evita registrar novamente erros reportados por scripts externos sem detalhes.
      report(event.error || event.message, `Erro não tratado${event.filename ? ` em ${event.filename}:${event.lineno || 0}` : ''}`);
    });
    scope.addEventListener('unhandledrejection', (event) => {
      report(event.reason, 'Promise rejeitada sem tratamento');
    });
  }

  const api = Object.freeze({ getMessage, report, installGlobalHandlers });
  if (typeof globalThis !== 'undefined') globalThis.AppErrors = api;
  if (typeof self !== 'undefined' && self.addEventListener) installGlobalHandlers(self);
})();

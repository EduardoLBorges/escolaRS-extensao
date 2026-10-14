importScripts(
  'auth/authManager.js',
  'api/escolaRS.js',
  'utils/aluno.js',
  'utils/string.js',
  'utils/notas.js',
  'utils/filtroParser.js',
  'services/dashboardService.js',
  'background/repositories/dashboardCacheRepository.js',
  'background/services/authenticationService.js',
  'background/services/dashboardQueryService.js',
  'background/controllers/runtimeMessageController.js',
  'background/controllers/extensionEventController.js',
);

ExtensionEventController.register();
RuntimeMessageController.register();

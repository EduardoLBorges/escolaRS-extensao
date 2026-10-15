# Repository Guidelines

## Project Structure & Module Organization

This repository is a Chrome Manifest V3 extension with no compilation step. `manifest.json` declares permissions, entry points, and accessible resources. `background.js` and `background/` contain the service worker and its controllers, services, and repositories; `content.js` reads portal context; `auth/` and `api/` manage authentication and EscolaRS requests. Business logic lives in `services/` and `utils/`. The user interfaces are grouped under `ui/dashboard/`, `ui/chamada/`, `ui/avaliacoes/`, and `ui/omr/`; OMR image processing runs in `ui/omr/omr-worker.js`. Shared libraries and icons are in `libs/`, `ui/libs/`, and `images/`. Technical behavior is documented in `DOCUMENTACAO.md`.

## Build, Test, and Development

There is no package manager, build script, or automated test suite configured. To develop, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose the repository root. After edits, use the extension’s **Reload** control; inspect extension and service worker errors in Chrome’s extension details and developer tools. Exercise the affected workflow in the EscolaRS portal with an authorized account. Keep `manifest.json` paths in sync when adding extension pages, workers, or resources.

## Coding Style & Naming

Use the existing vanilla JavaScript, HTML, and CSS conventions; there is no formatter or linter configuration. Follow nearby indentation and naming. Use `camelCase` for JavaScript functions and variables, descriptive filenames, and keep UI files with their feature (`ui/<feature>/<feature>.js`, `.html`, `.css`). Put shared business logic in `services/` or `utils/` rather than duplicating it across screens. Avoid editing minified vendor files unless updating the dependency itself.

## Testing Guidelines

No test framework or coverage requirement is configured. Verify changes manually in Chrome, checking the relevant screen, background service worker, and portal interactions. For API or grade changes, verify representative valid, empty, and error cases where applicable. Do not use real student data in screenshots or documentation.

## Commits and Pull Requests

Recent commits use short, imperative summaries, often in Portuguese (for example, `Aceitar nota nula ao salvar resultados`) and sometimes English. Keep each commit focused and describe the user-visible change. Pull requests should explain the behavior changed, list manual verification steps, reference related issues when available, and include screenshots for UI changes. Call out manifest permission or API behavior changes explicitly.

## Security and Configuration

The extension handles authentication tokens and student information locally. Never commit credentials, session tokens, or identifiable student data; use anonymized examples. Request only the host permissions and browser capabilities needed for a feature.

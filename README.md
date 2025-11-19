# Arte Subtitle Translator Extension

This repository bootstraps the MV3 browser extension that will eventually translate Arte.tv subtitles into English.

## Getting started

```bash
npm install
```

### Develop

The project does not run a traditional dev server because it targets the browser extension runtime. Use the watch build to continuously emit assets into `dist/` and then reload the extension in your browser.

```bash
npm run dev
```

### Production build

```bash
npm run build
```

The build step bundles background, content and options scripts via Vite, copies static assets from `public/`, and includes `manifest.json` inside `dist/` so the folder can be loaded as an unpacked extension.

### Linting and formatting

```bash
npm run lint
npm run format
```

## Project layout

- `src/background` – background service worker entry point.
- `src/content` – content script that finds Arte video subtitles.
- `src/options` – logic powering the options page UI.
- `src/shared` – utilities shared across the different extension contexts.
- `public` – static assets copied verbatim to `dist/` (currently just the options page markup).
- `manifest.json` – MV3 manifest copied into `dist/` during the build.
- `TASKS.md` – original project specification and backlog.

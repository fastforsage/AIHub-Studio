# AIHub Studio Linux

Independent Linux rewrite of AIHub Studio using Electron, bundled Chromium, React and TypeScript.

Target: Arch Linux / CachyOS x86_64, Wayland and X11.

## Implemented

- Electron desktop runtime with isolated preload bridge;
- XDG-compliant application paths;
- AI catalog with categories and Add / Change / Del context menus;
- Cloud Site entries and OpenAI-compatible Local AI entries;
- persistent catalog configuration;
- embedded Chromium tabs using WebContentsView;
- persistent isolated browser profiles per website provider;
- global HTTP, HTTPS, SOCKS4 and SOCKS5 proxy configuration;
- automatic Local AI model discovery via /v1/models;
- model selection and chat via /v1/chat/completions;
- local chat state is temporary and is not archived or persisted;
- unit tests, Electron Chromium smoke test, TypeScript check and Arch package installation CI.

## Local AI defaults

- Name: Local LLM
- API type: openai (OpenAI-compatible)
- Host: localhost
- Port: 11434
- Category: Local AI
- Models: automatic discovery

The app requests model discovery when the user opens the connection or presses Refresh models. It does not start or install a local inference server.

## Development

Use Node.js 24 LTS and npm.

    npm install
    npm run dev
    npm test
    npm run typecheck
    npm run build
    npm run smoke

## Build the native Arch package

    npm run package:dir

This stages the application in release/linux-unpacked. The native package is then built from linux/packaging/arch/PKGBUILD with makepkg inside an Arch Linux container, as demonstrated by the CI workflow.

The generated package uses the .pkg.tar.zst format and can be installed with:

    sudo pacman -U ./<package>.pkg.tar.zst

See docs/ for architecture, security, Local AI API behavior, Browser Manager and installation.

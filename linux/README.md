# AIHub Studio Linux

Independent Linux rewrite of AIHub Studio using Electron, Chromium, React and TypeScript.

Target: Arch Linux / CachyOS x86_64, Wayland and X11.

## Current scope
The current foundation stage contains:
- Electron main process and hardened preload bridge;
- React workspace shell;
- XDG-compliant application paths;
- AI catalog, category management and persistent Local AI/Cloud Site configuration;
- secure Browser Manager based on WebContentsView and persistent isolated profiles;
- global browser proxy settings;
- unit tests and Linux CI.

The next stage adds the OpenAI-compatible Local AI request client and automatic model discovery. Message capture and chat archiving are explicitly out of scope for now.

## Development
Use Node.js 24 LTS and npm.

    npm install
    npm run dev
    npm test
    npm run typecheck
    npm run build

See docs/ for the requirements, architecture, security baseline and Arch installation notes.

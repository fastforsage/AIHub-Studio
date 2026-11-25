# AIHub Studio Linux

Independent Linux rewrite of AIHub Studio using Electron, Chromium, React and TypeScript.

Target: Arch Linux / CachyOS x86_64, Wayland and X11.

## Current scope
The current foundation stage contains:
- Electron main process and hardened preload bridge;
- React workspace shell;
- XDG-compliant application paths;
- URL validation helper for website entries;
- unit tests and Linux CI.

The next stages add the sidebar catalog/categories, Browser Manager, and OpenAI-compatible Local AI. Message capture and chat archiving are explicitly out of scope for now.

## Development
Use Node.js 24 LTS and npm.

    npm install
    npm run dev
    npm test
    npm run typecheck
    npm run build

See docs/ for the requirements, architecture, security baseline and Arch installation notes.

# Arch Linux / CachyOS development setup

## Requirements
- Arch Linux x86_64 or CachyOS x86_64.
- Node.js 24 LTS.
- npm.
- Desktop session with Wayland or X11.

Electron 45.5.0 is pinned for the initial foundation. The Electron release published on 2026-11-24 embeds Chromium 156.0.8078.109 and Node.js 24.22.3.

## Install dependencies
Run from the linux directory:

    npm install

## Development

    npm run dev

## Verification

    npm test
    npm run typecheck
    npm run build

The initial stage produces a development application build. Arch packaging/PKGBUILD is a later milestone and is not considered complete yet.

Run the application as a normal user. Do not run Electron with sudo.

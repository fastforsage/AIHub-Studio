# Arch Linux / CachyOS installation and development

## Target

- Arch Linux x86_64
- CachyOS x86_64
- KDE Plasma, GNOME or another desktop environment
- Wayland or X11

## Runtime dependencies

The native Arch package declares Chromium/Electron runtime dependencies in `packaging/arch/PKGBUILD`, including GTK, NSS, ALSA, X11, Mesa, Secret Service and desktop integration libraries.

The application bundles its own Electron/Chromium runtime. A separate system Chromium installation is not required.

## Install a release package

Download the `AIHub-Studio-Linux-Arch-x64` CI artifact and install its `.pkg.tar.zst` file:

    sudo pacman -U ./aihub-studio-0.1.0-1-x86_64.pkg.tar.zst

The actual filename may include a package release or architecture suffix. Substitute the exact downloaded filename.

Start AIHub Studio from the desktop launcher or:

    aihub-studio

Run the application as the regular desktop user. Do not run Electron with sudo.

## Build from source

Install Node.js 24, npm and Docker (for the Arch packaging container), then from `linux/`:

    npm install
    npm run package:dir

This creates `release/linux-unpacked/`. The native Arch package is built with `makepkg` using `packaging/arch/PKGBUILD` inside an Arch Linux container. The CI script demonstrates the complete process.

## Verify

    npm test
    npm run typecheck
    npm run build
    npm run smoke

CI additionally builds the Arch package with `makepkg`, installs it via `pacman` in a clean Arch container and checks the desktop entry, launcher and bundled executable.

## Desktop runtime validation

The Arch container check verifies package installation, not the desktop runtime on a physical CachyOS machine. The first CachyOS user test must confirm:
- application launches from KDE Plasma launcher;
- the window is grouped under the correct application icon;
- Chromium works in Wayland and X11 sessions;
- the browser profile and site cookies survive a restart;
- the global proxy works with a reachable test proxy;
- Local AI requests work against a user-configured OpenAI-compatible endpoint.

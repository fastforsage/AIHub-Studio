# Linux packaging

## Arch Linux and CachyOS

The first distributable format is the native Arch package produced by electron-builder's pacman target.

- Target architecture: x86_64.
- Build tool: electron-builder 26.18.1.
- Output directory: linux/release/.
- Install command: sudo pacman -U ./<package>.pacman.
- Package metadata declares the GTK, NSS, X11 compatibility, desktop integration, accessibility and Secret Service dependencies used by Electron.

The upstream electron-builder documentation currently marks the pacman target as beta. CI therefore performs a real package install inside a clean Arch Linux container, verifies pacman metadata and checks that the desktop entry and application executable are installed.

## Build command

    npm run package:pacman

This command first creates the Electron production build and then packages it for x86_64 Arch systems.

## Scope

The package is a native package for pacman. An AUR PKGBUILD and signed repository distribution are separate future release-engineering tasks; they are not needed to install this package directly.

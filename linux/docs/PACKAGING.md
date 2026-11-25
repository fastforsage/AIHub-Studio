# Linux packaging

## Arch Linux and CachyOS

The Linux release uses a native Arch package built with `makepkg` from the repository's `packaging/arch/PKGBUILD`.

- Target architecture: x86_64.
- Electron application staging: electron-builder 26.18.1 `dir` target.
- Package builder: Arch `makepkg`.
- Package format: `.pkg.tar.zst`.
- Output: `linux/release/`.
- Install: `sudo pacman -U ./<package>.pkg.tar.zst`.

The PKGBUILD installs the bundled Electron/Chromium application into `/opt/aihub-studio`, provides `/usr/bin/aihub-studio`, and installs a desktop entry into `/usr/share/applications/`.

CI runs `makepkg` in a clean Arch Linux container, installs declared runtime dependencies, installs the resulting package with `pacman`, and verifies the launcher, desktop entry and application executable before publishing the package artifact.

## Build the unpacked Electron application

    npm run package:dir

This generates `release/linux-unpacked/`.

## Native package

From an Arch Linux environment, prepare a tarball containing the `linux-unpacked/` directory using the naming convention in the CI workflow, then run:

    makepkg --noconfirm

The CI script `packaging/arch/ci-build-install-test.sh` demonstrates the build and clean-container installation test.

## Future distribution

The checked-in PKGBUILD is the source of truth for Arch packaging and can later be submitted to AUR or used in a signed repository. Neither AUR publication nor repository signing is part of this initial MVP.

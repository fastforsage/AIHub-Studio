# AIHub Studio Alpha 0.1.10

**Release channel:** Alpha  
**Target:** Windows 10/11 x64  
**Installer:** `AIHubStudio-Setup-x64.msi`

## Highlights

- Shared Electron + Chromium + React + TypeScript application promoted to the main application line.
- Persistent left-side provider catalog with expandable categories and Favorites.
- Provider websites in tabs with a shared persistent Chromium profile.
- Local OpenAI-compatible API connections and model discovery.
- HTTP/HTTPS/SOCKS4/SOCKS5 proxy settings.
- Diagnostics and log viewer.
- Windows x64 MSI packaging in GitHub Actions.

## Validation

The preceding main build (0.1.9) passed the Windows CI pipeline: 143 tests across 15 test files, TypeScript check, Electron production build, Chromium WebContentsView smoke test, Windows x64 packaging, WiX MSI build, and MSI artifact verification.

Alpha 0.1.10 is a documentation and release-label update on top of that baseline. The Windows CI run completed successfully on 2026-11-25 (run #14, commit `cf302e8cd6109fa543b05ee5953c8cb903b33d4a`). All 143 tests across 15 test files passed. TypeScript check, Electron production build, Chromium WebContentsView smoke test, Windows x64 packaging, WiX MSI build, and MSI verification all passed. The MSI artifact is `AIHubStudio-Windows10-x64-MSI` (136,843,395 bytes): [download from GitHub Actions](https://github.com/fastforsage/AIHub-Studio/actions/runs/45684725937). The artifact is retained until 2026-12-09.

## Known limitations

Conversation capture/archive, SQLite chat history, attachment extraction/export, Dockhand integration, and remote GPU telemetry are not included in this alpha.

## License

The project is distributed under the MIT License. See [LICENSE](LICENSE).

## Disclaimer

Use of third-party AI provider websites and APIs is at the user's own risk. The user is responsible for complying with provider terms and applicable laws, and for having a lawful basis and required permissions for any collection or processing of data. See [Russian documentation](docs/README.ru.md) and [English documentation](docs/README.en.md) for the full notice.

This is an early test release. It is supplied “AS IS”, subject to the limits and non-excludable rights under applicable law.

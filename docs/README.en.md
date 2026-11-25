# AIHub Studio — Documentation (EN)

**Documentation version:** Alpha 0.1.10  
**Product status:** Early alpha

AIHub Studio is an Electron desktop workspace with bundled Chromium for accessing AI provider websites and local models through OpenAI-compatible APIs.

## Alpha features

- Persistent AI provider catalog in the left sidebar.
- Expandable categories and Favorites.
- Add, edit, and delete category/provider entries.
- Provider websites open as tabs in one shared workspace.
- Shared Chromium profile with persistent sessions and cookies.
- Connections to local OpenAI-compatible APIs.
- Automatic model discovery through `/v1/models`.
- Local model requests through `/v1/chat/completions`.
- HTTP, HTTPS, SOCKS4, and SOCKS5 proxy configuration.
- Built-in diagnostics and log viewer.
- Provider/service availability checks.

The catalog may change over time. Listing a provider does not imply a partnership, endorsement, or official integration.

## Windows installation

1. Download the MSI from the Artifacts section of the relevant GitHub Actions workflow or from the published Alpha Release.
2. Run the installer with the permissions required by Windows Installer.
3. Follow the installer prompts.
4. Launch **AIHub Studio** from the Start menu.

The alpha MSI targets Windows 10/11 x64. CI packages the installer on a Windows runner using WiX Toolset 5.0.2.

## First steps

1. Expand a category in the left sidebar.
2. Select an AI website to open it in a workspace tab.
3. Sign in directly on the provider's official website. AIHub Studio does not issue provider accounts.
4. To use a local model, add a Local AI endpoint that exposes an OpenAI-compatible API.
5. Configure a proxy in Settings if required.
6. Use the built-in log viewer for troubleshooting.

Website sessions and cookies are stored in the application's Chromium profile. Do not share the same Windows user profile with untrusted users.

## Local data locations

On Windows:

- Settings and provider catalog: `%APPDATA%\AIHubStudio`
- Chromium data and sessions: `%LOCALAPPDATA%\AIHubStudio\Data`
- Logs: `%LOCALAPPDATA%\AIHubStudio\Logs`

Back up required settings before deleting these folders. Removing browser profile data may permanently remove local sessions and cookies.

On Linux, the application uses the user's XDG directories:

- `$XDG_CONFIG_HOME/AIHubStudio` (default: `~/.config/AIHubStudio`)
- `$XDG_DATA_HOME/AIHubStudio` (default: `~/.local/share/AIHubStudio`)
- `$XDG_STATE_HOME/AIHubStudio` (default: `~/.local/state/AIHubStudio`)

## Privacy and data handling

AIHub Studio is a client-side workspace for provider websites and local APIs. When a website is opened, the embedded browser communicates with that provider. Depending on the provider and its policies, the provider may receive the user's IP address, cookies, browser headers, prompts, uploaded files, and other request data.

Local settings, the Chromium profile, cookies, and application logs are stored on the user's device in the locations listed above. Review logs before sharing them: they may contain URLs, diagnostic details, or other potentially sensitive information.

**The current alpha does not claim to provide automatic conversation archiving, attachment extraction, or centralized collection of chat contents.** Browser tabs must not be treated as a conversation archive or backup.

## Important disclaimer — responsibility for data obtained from AI providers

AIHub Studio is an independent third-party client. It is not an official product, representative, or partner of any listed AI provider unless expressly stated. Provider names, logos, and trademarks belong to their respective owners.

**The user is solely responsible for ensuring that access to provider websites and APIs, and the collection, viewing, copying, storage, export, disclosure, and further processing of any provider data, are lawful.** The user must:

- comply with each provider's terms of service, automated-access rules, and usage limits;
- obtain all permissions, consents, and other lawful bases required for data collection and processing;
- comply with applicable privacy, data-protection, confidentiality, copyright, database-rights, and cybersecurity laws;
- not circumvent technical restrictions, access controls, rate limits, or security measures;
- not collect or distribute another party's personal, confidential, or legally protected data without a valid legal basis;
- secure their accounts, cookies, tokens, local browser profiles, and backups.

The project maintainers do not control third-party services, their availability, responses, policies, interface changes, account suspensions, or access decisions. The software is provided **“AS IS” and “AS AVAILABLE”**, without a promise of uninterrupted operation, compatibility with every provider, or fitness for a particular purpose.

To the maximum extent permitted by applicable law, the developers and maintainers disclaim liability for the user's actions when interacting with third-party providers, the user's violations of provider terms, unlawful data collection or processing by the user, and changes, outages, or decisions made by third-party services. Nothing in this notice excludes liability or statutory rights that cannot legally be excluded or limited. This notice is not legal advice.

## Alpha limitations

This alpha is intended for evaluation and testing. Bugs, UI changes, and provider incompatibilities are expected. The following are **not currently represented as implemented**:

- automatic conversation capture and archiving;
- SQLite chat history and message deduplication;
- attachment extraction and export;
- Dockhand integration;
- remote AMD MI50/GPU monitoring;
- centralized cloud-model management through a unified API.

Do not keep the only copy of important data in an alpha application profile.

## Reporting issues

When opening an issue, include the app version, OS, reproduction steps, and expected/actual results. Before sharing logs, remove cookies, tokens, passwords, private URLs, personal data, and conversation contents.

## Development and checks

Node.js 24.22.x is required.

```bash
npm install
npm test
npm run typecheck
npm run build
npm run smoke
```

The **Build Windows MSI** GitHub Actions workflow builds the Windows x64 installer.

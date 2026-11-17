# WebView2 chat capture prototype

Isolated proof of concept for the `feature/webview2-local-chat-archive` branch. It does not modify or replace the existing PySide6 application.

## Requirements

- Windows 10/11 x64
- .NET 8 SDK
- Microsoft Edge WebView2 Runtime (Evergreen)

## Run

From this directory:

```powershell
dotnet restore
dotnet run
```

The first launch creates a separate WebView2 profile and SQLite database under:

`%LOCALAPPDATA%\AIHubStudio\WebView2CapturePrototype\`

Sign in to a supported LLM site in the prototype window and open a conversation. The detector identifies known providers from the JSON registry; the capture script then tries provider-specific or conservative semantic DOM recognition. SQLite upserts updates so a streaming answer is revised in place instead of creating a row for every token. Use **Импорт адаптера JSON** to add or update an adapter without recompiling the application.

## Adapter catalog and detection

Adapter definitions are JSON documents stored in SQLite. The initial catalog is shipped as `adapters/catalog.json` and imported into the database on first launch. The JSON Schema is `adapter-definition.schema.json`.

Initial provider identities include:

- Western: ChatGPT, Claude, Gemini, Copilot, Perplexity, Grok.
- Chinese: Qwen, DeepSeek, Kimi, GLM / 智谱清言, Doubao / 豆包, Yuanbao / 腾讯元宝, ERNIE / 文心一言, iFlytek Spark, MiniMax.

The toolbar's **Импорт адаптера JSON** action validates and imports a JSON file into `adapter_definitions`. An imported definition replaces the active definition only when its version is higher. Previous versions are retained in `adapter_versions`. The app does not execute JavaScript or arbitrary code from adapter JSON; only allow-listed strategies (`provider_dom`, `semantic_dom`, `clipboard`) are accepted.

The current detector resolves known providers by hostname/domain. The page script uses provider selectors where available and then a conservative semantic fallback: it only accepts elements whose own attributes identify a user or assistant/model role. Unknown sites that pass this semantic test are recorded as `generic-chat`; arbitrary page-wide text scraping is intentionally disabled.

Current provider-specific DOM selectors are implemented for ChatGPT, Claude, and Gemini. Other catalog entries currently provide identity and strategy metadata, not verified provider-specific selectors or guaranteed extraction. Their semantic fallback is best-effort and must be validated against real conversations.

## Database

SQLite file: `conversations.db`. Tables:

- `messages`: captured message text and source metadata.
- `adapter_definitions`: active JSON adapter definitions.
- `adapter_versions`: imported definition history.
- `adapter_detection_logs`: detected host, adapter ID, confidence and timestamp.
- `adapter_extraction_stats`: per-adapter detection and extraction counters.

## Security and limitations

- The WebView2 browser profile is separate from Qt WebEngine; existing Qt cookies/sessions are not migrated.
- Content is stored locally as plain text in this prototype. Do not use it on shared Windows accounts or untrusted machines.
- This prototype does not capture attachments, images, audio, tool calls, or hidden/virtualized messages.
- DOM capture can miss or duplicate messages when providers change their page structure. Validate each provider before relying on it as an archive.
- No API keys or provider APIs are used.


## Live diagnostics

The prototype window now shows a live diagnostics panel above the browser. It reports WebView2 initialization/navigation, whether `CaptureScript.js` was found and injected, JavaScript startup, MutationObserver status, DOM selector match count, scan count, messages sent to the host, and SQLite insert/update or error status. The database counter is the actual number of rows; the event counter counts capture/update events and may be higher because streaming responses are updated.

When troubleshooting, open a supported chat, sign in, and open a conversation with visible messages. Read the latest line in the diagnostics panel:
- `script-start` / `observer-start`: the capture script is running.
- `scan` with `found=0`: current page selectors did not match visible messages.
- `message-sent`: JavaScript sent a message to the desktop host.
- `SQLite OK`: the host saved or updated a row.
- `post-error`, `bridge-missing`, or `ОШИБКА`: inspect the accompanying error text.


### PyreCrawl-inspired extraction strategy

The capture script uses a small fallback ladder while staying inside the existing WebView2 profile:
1. Provider-specific DOM selectors (preferred).
2. Conservative semantic fallbacks based on message-related test IDs and accessible labels, with role inference only when the label identifies user/assistant/model/response.
3. If neither strategy finds messages, diagnostics report `strategy=none`; no speculative page-wide text scraping is performed.

This borrows PyreCrawl's fast-first/fallback approach and its emphasis on waiting for live JavaScript-rendered DOM, without launching a second browser or attempting to transfer authentication cookies. Fallback selectors are best-effort and may need updates when provider markup changes.

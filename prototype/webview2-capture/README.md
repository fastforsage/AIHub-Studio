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

Sign in to ChatGPT, Claude, or Gemini in the prototype window and open a conversation. The capture script watches supported message containers and sends text updates to the host; SQLite upserts updates so a streaming answer is revised in place instead of creating a row for every token.

## Current capture support

- ChatGPT: elements carrying `data-message-author-role`
- Claude: user message test id and assistant message class selectors
- Gemini: `user-query` and `model-response` elements

This is a selector-level prototype, not a guarantee of complete transcript capture. Sites change their DOM, virtualize older messages, and may render some content outside these selectors. Unknown sites are intentionally ignored instead of scraping arbitrary page text.

## Database

SQLite file: `conversations.db`; table: `messages`. Fields include provider, conversation key (host + URL path), message key, role, text, source URL, and timestamps.

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

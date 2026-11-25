# Local AI Manager

## Connection profile

The default profile created through Add → Local AI is:

- Name: Local LLM
- API type: openai (OpenAI-compatible)
- Host: localhost
- Port: 11434
- Category: Local AI
- Model list: automatic discovery

Host and port are separate editable fields. The client constructs the base endpoint as http://host:port/v1. IPv6 hosts are bracketed when the URL is assembled.

## Model discovery

The app calls GET /v1/models only when the user opens a Local AI connection with an empty model list or presses Refresh models.

The response must contain a data array with model objects that have non-empty id fields. Model identifiers are trimmed and deduplicated. If the current selected model is still available, it remains selected; otherwise the first discovered model is selected. An empty list clears the current selection.

The API profile remains OpenAI-compatible even when the default port is 11434. The port does not imply a specific server implementation.

## Chat requests

The client sends non-streaming requests to POST /v1/chat/completions with:
- selected model identifier;
- messages with system, user or assistant roles;
- stream=false.

Only a valid assistant message content string is displayed. HTTP errors, invalid JSON, malformed response data, timeouts and connection failures are mapped to safe user-facing messages. Response body details and network exceptions are not copied into application logs.

## Message lifetime

The current local chat is kept only in React application memory. It is not saved to disk, SQLite, or a chat archive. Closing the application clears the temporary conversation state.

## Security and testing

The API client runs in Electron Main Process, not in the remote website renderer. Renderer operations use a narrow preload API. Tests mock fetch and do not contact the configured user endpoint.

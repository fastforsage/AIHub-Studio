# Browser Manager

## Embedded Chromium

Cloud Site content is rendered using Electron `WebContentsView` instances attached to the application `BrowserWindow` content view. Each browser tab is managed in the Electron Main process; the renderer receives only tab metadata and invokes narrow IPC operations.

## Profiles and persistence

Each website provider has a stable `profileId`. The profile identifier is hashed into a persistent Electron session partition named `persist:aihub-...`. This prevents two different website providers from sharing cookies or local storage by default while retaining sign-in state after application restart.

Tabs for the same provider reuse its existing tab. Session profile data is stored beneath the application's XDG data directory.

## Navigation and permissions

- Only HTTP and HTTPS destinations are accepted.
- `javascript:`, `file:`, `data:` and custom external schemes are rejected.
- New-window requests are denied; safe HTTP(S) popup destinations are redirected into the same tab.
- Browser permissions are denied by default.
- Renderer does not receive Node.js or raw Electron IPC access.
- Browser views are hidden when the catalog/settings workspace is active.

## Proxy

The global proxy is stored in `browser-settings.json` beneath XDG config.

Supported proxy schemes:
- HTTP
- HTTPS
- SOCKS4
- SOCKS5

A bare `host:port` is treated as HTTP. Leave the field empty to use system proxy settings. Credentials and paths are intentionally not accepted in the endpoint field; support for authenticated proxies needs a dedicated credential flow.

When proxy settings change, all existing browser sessions are reconfigured and pooled connections are closed so new requests use the selected route.

## Known runtime validation

CI verifies unit tests, TypeScript and Electron production build. Actual rendering, sign-in/OAuth popup behavior, Wayland/X11 geometry, persistence and proxy reachability still require a runtime pass on CachyOS.

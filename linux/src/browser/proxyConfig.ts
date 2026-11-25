const PROXY_SCHEMES = new Set(["http:", "https:", "socks4:", "socks5:"]);

export function normalizeProxyServer(input: string | null | undefined): string | null {
  const value = input?.trim() ?? "";
  if (!value) return null;

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : "http://" + value;

  try {
    const parsed = new URL(candidate);
    if (!PROXY_SCHEMES.has(parsed.protocol) || !parsed.hostname ||
        parsed.username || parsed.password ||
        (parsed.pathname !== "/" && parsed.pathname !== "") ||
        parsed.search || parsed.hash) {
      return null;
    }

    const hostname = parsed.hostname;
    const port = parsed.port ? ":" + parsed.port : "";
    return parsed.protocol + "//" + hostname + port;
  } catch {
    return null;
  }
}

export function toElectronProxyConfig(proxyServer: string | null): Electron.ProxyConfig {
  return proxyServer
    ? { mode: "fixed_servers", proxyRules: proxyServer }
    : { mode: "system" };
}

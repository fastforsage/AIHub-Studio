import { describe, expect, it } from "vitest";
import { normalizeProxyServer, toElectronProxyConfig } from "../src/browser/proxyConfig";

describe("normalizeProxyServer", () => {
  it("accepts HTTP, HTTPS and SOCKS proxy addresses", () => {
    expect(normalizeProxyServer("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(normalizeProxyServer("https://proxy.example.com:8443")).toBe("https://proxy.example.com:8443");
    expect(normalizeProxyServer("socks5://localhost:1080")).toBe("socks5://localhost:1080");
    expect(normalizeProxyServer("socks4://localhost:9050")).toBe("socks4://localhost:9050");
  });

  it("defaults a host:port value to HTTP", () => {
    expect(normalizeProxyServer("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  it("supports IPv6 proxy hosts", () => {
    expect(normalizeProxyServer("http://[::1]:8080")).toBe("http://[::1]:8080");
  });

  it.each(["", " ", "ftp://proxy:21", "javascript:alert(1)", "http://user:pass@proxy:8080", "http://proxy/path", "http://proxy?q=secret", "http://[broken"])(
    "rejects invalid proxy input %s",
    (input) => expect(normalizeProxyServer(input)).toBeNull()
  );

  it("maps an empty value to system proxy mode", () => {
    expect(toElectronProxyConfig(null)).toEqual({ mode: "system" });
  });

  it("maps a configured endpoint to fixed proxy rules", () => {
    expect(toElectronProxyConfig("socks5://localhost:1080")).toEqual({
      mode: "fixed_servers",
      proxyRules: "socks5://localhost:1080"
    });
  });
});

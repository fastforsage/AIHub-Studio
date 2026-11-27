import { describe, expect, it, vi } from "vitest";
import { ServiceAvailabilityManager } from "../src/main/serviceAvailabilityManager";
import type { WebsiteProvider } from "../src/catalog/catalogModel";

function provider(id: string, url: string): WebsiteProvider {
  return {
    id,
    name: id,
    type: "website",
    url,
    profileId: id,
    categoryIds: ["chatbot"],
    favorite: false,
    enabled: true
  };
}

function response(status: number, url: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    body: { cancel: vi.fn(async () => undefined) }
  } as unknown as Response;
}

describe("ServiceAvailabilityManager", () => {
  it("checks each provider and reports the public IP country and latency", async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://ipwho.is/") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, country_code: "RU", country: "Russia" })
        } as Response;
      }
      return response(200, url);
    });
    const manager = new ServiceAvailabilityManager(
      () => [provider("alice-ai", "https://alice.yandex.ru/"), provider("gigachat", "https://giga.chat/")],
      fetcher
    );

    const report = await manager.checkCatalog();

    expect(report.detectedCountryCode).toBe("RU");
    expect(report.regionDetection).toBe("ip-geolocation");
    expect(report.results.map((item) => item.status)).toEqual(["available", "available"]);
    expect(report.results.find((item) => item.providerId === "gigachat")?.regionStatus).toBe("allowed");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("marks GigaChat as region-limited outside Russia without hiding the site response", async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input) === "https://ipwho.is/") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, country_code: "CZ", country: "Czechia" })
        } as Response;
      }
      return response(200, String(input));
    });
    const manager = new ServiceAvailabilityManager(
      () => [provider("gigachat", "https://giga.chat/"), provider("alice-ai", "https://alice.yandex.ru/")],
      fetcher
    );

    const report = await manager.checkCatalog();
    const gigachat = report.results.find((item) => item.providerId === "gigachat")!;
    const alice = report.results.find((item) => item.providerId === "alice-ai")!;

    expect(gigachat.status).toBe("regional-restriction");
    expect(gigachat.regionStatus).toBe("restricted");
    expect(gigachat.message).toContain("российский IP");
    expect(alice.status).toBe("available");
    expect(alice.regionStatus).toBe("allowed");
    expect(alice.regionNote).toContain("Базовый чат доступен");
  });

  it("treats HTTP 403 as protected, not as a dead website", async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input) === "https://ipwho.is/") throw new Error("Geo service offline");
      return response(403, String(input));
    });
    const manager = new ServiceAvailabilityManager(
      () => [provider("blocked", "https://example.com/")],
      fetcher
    );

    const report = await manager.checkCatalog();
    expect(report.results[0].status).toBe("protected");
    expect(report.results[0].message).toContain("не доказывает");
    expect(report.regionDetection).toBe("unavailable");
  });

  it("marks server errors and network failures as unavailable", async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input) === "https://ipwho.is/") throw new Error("Geo service offline");
      if (String(input).includes("server.example")) return response(503, String(input));
      throw new Error("ECONNREFUSED");
    });
    const manager = new ServiceAvailabilityManager(
      () => [
        provider("server", "https://server.example/"),
        provider("network", "https://offline.example/")
      ],
      fetcher
    );
    const report = await manager.checkCatalog();
    expect(report.results.map((item) => item.status)).toEqual(["unavailable", "unavailable"]);
  });

  it("flags a cross-domain redirect as protected instead of available", async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input) === "https://ipwho.is/") throw new Error("Geo service offline");
      return {
        ok: true,
        status: 200,
        url: "https://login.other-domain.example/",
        body: { cancel: vi.fn(async () => undefined) }
      } as unknown as Response;
    });
    const manager = new ServiceAvailabilityManager(
      () => [provider("site", "https://example.com/")],
      fetcher
    );
    const report = await manager.checkCatalog();
    expect(report.results[0].status).toBe("protected");
    expect(report.results[0].message).toContain("другой домен");
  });
});

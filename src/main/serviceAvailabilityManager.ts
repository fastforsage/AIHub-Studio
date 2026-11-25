import type { Provider } from "../catalog/catalogModel";
import type { AvailabilityStatus, RegionStatus, ServiceAvailabilityReport, ServiceAvailabilityResult } from "../shared/availabilityApi";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Region = { countryCode: string; countryName: string };

const RULES: Record<string, { allowed?: string[]; note?: (cc: string | null) => string; restricted?: string }> = {
  "alice-ai": {
    note: (cc) => cc === "RU" || cc === "BY"
      ? "Базовый чат доступен; расширенные возможности Алиса Плюс доступны в РФ и Беларуси."
      : "Базовый чат доступен за пределами РФ; расширенные возможности Алиса Плюс ограничены РФ и Беларуси."
  },
  gigachat: {
    allowed: ["RU"],
    restricted: "Для доступа из-за пределов России нужен российский IP и авторизация через Сбер ID."
  }
};

function regionResult(provider: Provider, country: string | null): { status: RegionStatus; note: string | null } {
  if (provider.type !== "website" || !RULES[provider.id]) return { status: "not-applicable", note: null };
  const rule = RULES[provider.id];
  if (!country) {
    return { status: "unknown", note: "Не удалось определить страну по публичному IP; региональные условия сервиса не проверены." };
  }
  if (rule.allowed && !rule.allowed.includes(country)) {
    return { status: "restricted", note: rule.restricted ?? "Региональное ограничение." };
  }
  return { status: "allowed", note: rule.note?.(country) ?? null };
}

function localApiUrl(provider: Extract<Provider, { type: "local-api" }>): string {
  const host = provider.host.includes(":") && !provider.host.startsWith("[") ? "[" + provider.host + "]" : provider.host;
  return "http://" + host + ":" + provider.port + "/v1/models";
}

function classify(status: number, latency: number): { status: AvailabilityStatus; message: string } {
  if (status >= 200 && status < 400) return latency > 2500
    ? { status: "slow", message: "Сайт отвечает медленно." }
    : { status: "available", message: "Сайт отвечает." };
  if ([401, 403, 429].includes(status)) return {
    status: "protected",
    message: "HTTP " + status + " может означать защиту от автоматических запросов, требование авторизации или ограничение частоты; это не доказывает, что сайт недоступен."
  };
  return { status: "unavailable", message: "Сервер ответил HTTP " + status + "." };
}

export class ServiceAvailabilityManager {
  constructor(private readonly getProviders: () => readonly Provider[], private readonly fetcher: FetchLike = fetch) {}

  async checkCatalog(): Promise<ServiceAvailabilityReport> {
    // The public IP is sent to the GeoIP endpoint only after an explicit user action.
    const region = await this.detectRegion();
    const providers = this.getProviders();
    const results: ServiceAvailabilityResult[] = new Array(providers.length);
    let next = 0;
    const worker = async () => {
      while (true) {
        const index = next++;
        if (index >= providers.length) return;
        results[index] = await this.checkProvider(providers[index], region?.countryCode ?? null);
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, providers.length) }, () => worker()));
    return {
      checkedAt: new Date().toISOString(),
      detectedCountryCode: region?.countryCode ?? null,
      detectedCountryName: region?.countryName ?? null,
      regionDetection: region ? "ip-geolocation" : "unavailable",
      results
    };
  }

  private async detectRegion(): Promise<Region | null> {
    try {
      const response = await this.fetcher("https://ipwho.is/", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4500)
      });
      if (!response.ok) return null;
      const value = await response.json() as { success?: boolean; country_code?: string; country?: string };
      if (value.success === false || typeof value.country_code !== "string" || typeof value.country !== "string") return null;
      return { countryCode: value.country_code.toUpperCase(), countryName: value.country };
    } catch {
      return null;
    }
  }

  private async checkProvider(provider: Provider, country: string | null): Promise<ServiceAvailabilityResult> {
    const region = regionResult(provider, country);
    const url = provider.type === "website" ? provider.url : localApiUrl(provider);
    const started = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      const response = await this.fetcher(url, {
        method: "GET",
        headers: {
          Accept: "text/html,application/json,*/*",
          Range: "bytes=0-0",
          "User-Agent": "AIHub-Studio-Service-Check/1.0"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(7000)
      });
      const latencyMs = Date.now() - started;
      const finalUrl = response.url || url;
      await response.body?.cancel().catch(() => undefined);
      const result = classify(response.status, latencyMs);
      return {
        providerId: provider.id,
        status: region.status === "restricted" ? "regional-restriction" : result.status,
        regionStatus: region.status,
        checkedAt,
        latencyMs,
        httpStatus: response.status,
        finalUrl,
        message: region.status === "restricted" ? region.note ?? result.message : result.message,
        regionNote: region.note
      };
    } catch (error) {
      const latencyMs = Date.now() - started;
      const message = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
        ? "Превышено время ожидания ответа."
        : error instanceof Error ? error.message : "Не удалось выполнить сетевой запрос.";
      return {
        providerId: provider.id,
        status: region.status === "restricted" ? "regional-restriction" : "unavailable",
        regionStatus: region.status,
        checkedAt,
        latencyMs,
        httpStatus: null,
        finalUrl: null,
        message: region.status === "restricted" ? region.note ?? message : message,
        regionNote: region.note
      };
    }
  }
}

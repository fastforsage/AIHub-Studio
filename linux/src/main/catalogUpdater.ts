import { dirname } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { CatalogModelInfo, CatalogState, WebsiteProvider } from "../catalog/catalogModel";
import { CatalogStore } from "../catalog/catalogStore";

export const CATALOG_SOURCES = {
  noCostAi: {
    id: "github-no-cost-ai",
    label: "zebbern/no-cost-ai",
    url: "https://raw.githubusercontent.com/zebbern/no-cost-ai/main/README.md"
  },
  freeApis: {
    id: "github-free-apis",
    label: "mnfst/awesome-free-llm-apis",
    url: "https://raw.githubusercontent.com/mnfst/awesome-free-llm-apis/main/data.json"
  }
} as const;

export interface CatalogSyncReport {
  startedAt: string;
  completedAt: string;
  added: number;
  updated: number;
  unchanged: number;
  skipped: number;
  sourceErrors: string[];
  sources: Array<{ id: string; label: string; entries: number; ok: boolean }>;
  totalProviders: number;
}

interface RemoteProvider {
  id: string;
  name: string;
  url: string;
  categoryIds: string[];
  description?: string;
  limits?: string;
  apiBaseUrl?: string;
  regionTag?: string;
  modelDetails?: CatalogModelInfo[];
  catalogSource: "github-no-cost-ai" | "github-free-apis";
  sourceUrl: string;
  lastVerified: string;
}

type CatalogFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function slug(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "provider";
}

function hostnameKey(value: string): string {
  try {
    return new URL(value).hostname.toLocaleLowerCase().replace(/^www\./, "");
  } catch {
    return value.toLocaleLowerCase();
  }
}

function categoryForHeading(heading: string): string[] {
  const value = heading.toLocaleLowerCase();
  if (/media|image|video|multimodal/.test(value)) return ["image-generator", "video-generator"];
  if (/voice|music|audio/.test(value)) return ["voice-generator", "music-generator"];
  if (/api|developer|inference|platform/.test(value)) return ["api-providers"];
  if (/\bide/.test(value)) return ["many-in-one"];
  return ["chatbot"];
}

function markdownCell(value: string): string {
  return value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\x60/g, "").replace(/\s+/g, " ").trim();
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of trimmed) {
    if (char === "|" && !escaped) {
      cells.push(markdownCell(current));
      current = "";
    } else {
      current += char;
    }
    escaped = char === "\\" && !escaped;
    if (char !== "\\") escaped = false;
  }
  cells.push(markdownCell(current));
  return cells;
}

function extractWebsite(firstCell: string): { name: string; url: string } | null {
  const markdownLink = firstCell.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/i);
  if (markdownLink) {
    const url = safeHttpUrl(markdownLink[2]);
    if (url) return { name: markdownLink[1].trim(), url };
  }

  // The upstream README primarily uses plain domains (e.g. lmarena.ai), not Markdown links.
  const plain = firstCell.replace(/\`/g, "").replace(/\[[^\]]*\]/g, " ");
  const match = plain.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[a-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*)?/i);
  if (!match) return null;
  const candidate = match[0].startsWith("http") ? match[0] : "https://" + match[0];
  const url = safeHttpUrl(candidate);
  if (!url) return null;
  const label = firstCell.replace(/\`/g, "").trim();
  return { name: label || new URL(url).hostname, url };
}

export function parseNoCostAiMarkdown(markdown: string, verifiedAt = new Date().toISOString()): RemoteProvider[] {
  const entries = new Map<string, RemoteProvider>();
  let heading = "";
  let inRelevantTable = false;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const title = rawLine.match(/^#{2,4}\s+(.+)$/);
    if (title) {
      heading = title[1].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
      inRelevantTable = /chat interfaces|media generation|image|video|multimodal|voice(?:\s*&\s*music)?|music|developer apis|ai ides|ides/i.test(heading);
      continue;
    }
    if (!inRelevantTable || !rawLine.includes("|")) continue;
    const cells = splitMarkdownRow(rawLine);
    if (cells.length < 2 || /^[-: ]+$/.test(cells[0]) || /^(link|website|service)$/i.test(cells[0])) continue;
    if (/removed:\s*(?:unreachable|deleted|removed)/i.test(rawLine)) continue;
    const website = extractWebsite(cells[0]);
    if (!website) continue;

    const categoryIds = categoryForHeading(heading);
    const models = cells[1] && !/^unknown$/i.test(cells[1]) ? cells[1] : "";
    const limits = cells[2] || "Не опубликованы в источнике";
    const description = [models ? "Модели/возможности: " + models : "", "Раздел: " + heading].filter(Boolean).join(". ");
    const host = hostnameKey(website.url);
    const existing = entries.get(host);
    if (existing) {
      existing.categoryIds = [...new Set([...existing.categoryIds, ...categoryIds])];
      existing.description = [existing.description, description].filter(Boolean).join("; ");
      existing.limits = [existing.limits, limits].filter((value, index, all) => Boolean(value) && all.indexOf(value) === index).join("; ");
      continue;
    }

    entries.set(host, {
      id: "remote-" + slug(host),
      name: website.name.replace(/\.(com|ai|dev|io|app|cn|ru)$/i, "").trim() || new URL(website.url).hostname,
      url: website.url,
      categoryIds,
      description,
      limits,
      catalogSource: "github-no-cost-ai",
      sourceUrl: CATALOG_SOURCES.noCostAi.url,
      lastVerified: verifiedAt
    });
  }

  return [...entries.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseFreeApiJson(raw: string, verifiedAt = new Date().toISOString()): RemoteProvider[] {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !Array.isArray(parsed.providers)) {
    throw new Error("awesome-free-llm-apis data.json has an unsupported schema");
  }

  const entries: RemoteProvider[] = [];
  for (const candidate of parsed.providers) {
    if (!isRecord(candidate)) continue;
    const name = textField(candidate.name);
    const url = safeHttpUrl(candidate.url);
    const apiBaseUrl = safeHttpUrl(candidate.baseUrl);
    if (!name || !url || !apiBaseUrl) continue;

    const modelDetails: CatalogModelInfo[] = Array.isArray(candidate.models)
      ? candidate.models.filter(isRecord).flatMap((model) => {
          const id = textField(model.id);
          const modelName = textField(model.name) ?? id;
          if (!id || !modelName || modelName.startsWith("+ ")) return [];
          return [{
            id,
            name: modelName,
            description: textField(model.description),
            context: textField(model.context),
            maxOutput: textField(model.maxOutput),
            modality: textField(model.modality),
            limits: textField(model.rateLimit)
          }];
        })
      : [];

    entries.push({
      id: "remote-api-" + slug(name),
      name,
      url,
      apiBaseUrl,
      categoryIds: ["api-providers"],
      description: textField(candidate.description) ?? "Описание не опубликовано.",
      limits: modelDetails.map((model) => model.limits).filter((value): value is string => Boolean(value)).join("; ") || "Не опубликованы",
      regionTag: textField(candidate.country),
      modelDetails,
      catalogSource: "github-free-apis",
      sourceUrl: CATALOG_SOURCES.freeApis.url,
      lastVerified: verifiedAt
    });
  }
  if (entries.length === 0) throw new Error("awesome-free-llm-apis data.json contains no usable API providers");
  return entries;
}

async function fetchText(fetcher: CatalogFetch, url: string): Promise<string> {
  const response = await fetcher(url, {
    headers: { "user-agent": "AIHub-Studio-Catalog-Updater/1.1", accept: "text/plain, application/json" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " while fetching " + url);
  const body = await response.text();
  if (!body.trim()) throw new Error("Empty catalog source: " + url);
  if (body.length > 8 * 1024 * 1024) throw new Error("Catalog source exceeds the 8 MiB safety limit");
  return body;
}

function mergeRemoteEntries(current: CatalogState, remote: RemoteProvider[]): { state: CatalogState; added: number; updated: number; unchanged: number; skipped: number } {
  const state = structuredClone(current);
  const categories = new Set(state.categories.map((item) => item.id));
  const byId = new Map(state.providers.map((provider) => [provider.id, provider]));
  const byHost = new Map(state.providers.filter((provider): provider is WebsiteProvider => provider.type === "website")
    .map((provider) => [hostnameKey(provider.url), provider]));
  let added = 0, updated = 0, unchanged = 0, skipped = 0;

  for (const entry of remote) {
    const categoryIds = entry.categoryIds.filter((id) => categories.has(id));
    if (categoryIds.length === 0) { skipped++; continue; }
    const existing = byId.get(entry.id) ?? byHost.get(hostnameKey(entry.url));
    if (existing) {
      if (existing.type !== "website") { skipped++; continue; }
      const merged: WebsiteProvider = {
        ...existing,
        categoryIds: [...new Set([...existing.categoryIds, ...categoryIds])],
        description: entry.description ?? existing.description,
        limits: entry.limits ?? existing.limits,
        apiBaseUrl: entry.apiBaseUrl ?? existing.apiBaseUrl,
        regionTag: entry.regionTag ?? existing.regionTag,
        modelDetails: entry.modelDetails?.length ? entry.modelDetails : existing.modelDetails,
        catalogSource: existing.catalogSource === "builtin-ru-cn" ? existing.catalogSource : entry.catalogSource,
        sourceUrl: entry.sourceUrl,
        lastVerified: entry.lastVerified
      };
      const changed = JSON.stringify(merged) !== JSON.stringify(existing);
      if (changed) {
        state.providers = state.providers.map((provider) => provider.id === existing.id ? merged : provider);
        byId.set(existing.id, merged);
        byHost.set(hostnameKey(existing.url), merged);
        updated++;
      } else unchanged++;
      continue;
    }

    const uniqueId = state.providers.some((provider) => provider.id === entry.id)
      ? entry.id + "-" + slug(hostnameKey(entry.url))
      : entry.id;
    const duplicateName = state.providers.some((provider) => provider.name.trim().toLocaleLowerCase() === entry.name.trim().toLocaleLowerCase());
    let uniqueName = duplicateName ? entry.name + " (" + new URL(entry.url).hostname + ")" : entry.name;
    let nameSuffix = 2;
    while (state.providers.some((provider) => provider.name.trim().toLocaleLowerCase() === uniqueName.trim().toLocaleLowerCase())) {
      uniqueName = entry.name + " (" + new URL(entry.url).hostname + " " + nameSuffix++ + ")";
    }
    const provider: WebsiteProvider = {
      id: uniqueId,
      name: uniqueName,
      type: "website",
      url: entry.url,
      profileId: uniqueId,
      categoryIds,
      favorite: false,
      enabled: false,
      description: entry.description,
      limits: entry.limits,
      apiBaseUrl: entry.apiBaseUrl,
      regionTag: entry.regionTag,
      modelDetails: entry.modelDetails,
      catalogSource: entry.catalogSource,
      sourceUrl: entry.sourceUrl,
      lastVerified: entry.lastVerified
    };
    state.providers.push(provider);
    byId.set(uniqueId, provider);
    byHost.set(hostnameKey(entry.url), provider);
    added++;
  }
  return { state, added, updated, unchanged, skipped };
}

export class CatalogUpdater {
  constructor(
    private readonly store: CatalogStore,
    private readonly statePath?: string,
    private readonly fetcher: CatalogFetch = globalThis.fetch.bind(globalThis)
  ) {}

  async syncIfDue(intervalMs = 24 * 60 * 60 * 1000): Promise<CatalogSyncReport | null> {
    if (this.statePath) {
      try {
        const state = JSON.parse(await readFile(this.statePath, "utf8")) as { lastSuccessfulSync?: string };
        const last = Date.parse(state.lastSuccessfulSync ?? "");
        if (Number.isFinite(last) && Date.now() - last < intervalMs) return null;
      } catch {
        // Missing or malformed sync metadata only causes a fresh sync; catalog data is untouched.
      }
    }
    return this.sync();
  }

  async sync(): Promise<CatalogSyncReport> {
    const startedAt = new Date().toISOString();
    const sourceErrors: string[] = [];
    const sources: CatalogSyncReport["sources"] = [];
    const incoming: RemoteProvider[] = [];

    const tasks = [
      { id: CATALOG_SOURCES.noCostAi.id, label: CATALOG_SOURCES.noCostAi.label, run: async () => parseNoCostAiMarkdown(await fetchText(this.fetcher, CATALOG_SOURCES.noCostAi.url)) },
      { id: CATALOG_SOURCES.freeApis.id, label: CATALOG_SOURCES.freeApis.label, run: async () => parseFreeApiJson(await fetchText(this.fetcher, CATALOG_SOURCES.freeApis.url)) }
    ];

    for (const task of tasks) {
      try {
        const entries = await task.run();
        if (entries.length === 0) throw new Error("Source parse returned no usable providers");
        incoming.push(...entries);
        sources.push({ id: task.id, label: task.label, entries: entries.length, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sourceErrors.push(task.label + ": " + message);
        sources.push({ id: task.id, label: task.label, entries: 0, ok: false });
      }
    }

    if (incoming.length === 0) {
      throw new Error("Catalog update failed; no valid source data was received. Existing catalog was not changed. " + sourceErrors.join(" | "));
    }

    let result = { added: 0, updated: 0, unchanged: 0, skipped: 0 };
    await this.store.transact((current) => {
      const merged = mergeRemoteEntries(current, incoming);
      result = { added: merged.added, updated: merged.updated, unchanged: merged.unchanged, skipped: merged.skipped };
      return merged.state;
    });

    const completedAt = new Date().toISOString();
    if (this.statePath) {
      try {
        await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });
        await writeFile(this.statePath, JSON.stringify({ lastSuccessfulSync: completedAt }, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
      } catch {
        // Catalog persistence succeeded; a sync timestamp failure must not report the update as failed.
      }
    }

    return {
      startedAt,
      completedAt,
      ...result,
      sourceErrors,
      sources,
      totalProviders: this.store.get().providers.length
    };
  }
}

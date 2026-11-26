import { session } from "electron";
import { dirname } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { CatalogModelInfo, CatalogState, Provider, WebsiteProvider } from "../catalog/catalogModel";
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

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function slug(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "provider";
}

function hostnameKey(value: string): string {
  try { return new URL(value).hostname.toLocaleLowerCase().replace(/^www\./, ""); }
  catch { return value.toLocaleLowerCase(); }
}

function categoryForHeading(heading: string): string[] {
  const value = heading.toLocaleLowerCase();
  if (value.includes("media") || value.includes("image") || value.includes("video")) return ["image-generator", "video-generator"];
  if (value.includes("voice") || value.includes("music")) return ["voice-generator", "music-generator"];
  if (value.includes("api") || value.includes("developer") || value.includes("inference")) return ["api-providers"];
  if (value.includes("ide")) return ["many-in-one"];
  return ["chatbot"];
}

function markdownCell(value: string): string {
  return value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function parseNoCostAiMarkdown(markdown: string, verifiedAt = new Date().toISOString()): RemoteProvider[] {
  const entries: RemoteProvider[] = [];
  let heading = "";
  let inRelevantList = false;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const title = rawLine.match(/^#{2,4}\s+(.+)$/);
    if (title) {
      heading = title[1].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
      inRelevantList = /chat interfaces|media generation|voice|music|developer apis|ai ides/i.test(heading);
      continue;
    }
    if (!inRelevantList || !rawLine.includes("|")) continue;
    const cells = rawLine.split("|").slice(1, -1).map(markdownCell);
    if (cells.length < 2 || /^[-: ]+$/.test(cells[0]) || /^link$/i.test(cells[0])) continue;
    const link = cells[0].match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/i);
    if (!link || /removed:/i.test(rawLine)) continue;
    const url = safeHttpUrl(link[2]);
    if (!url) continue;

    const name = link[1].replace(/\.(com|ai|dev|io|app|cn|ru)$/i, "").replace(/\s+/g, " ").trim() || new URL(url).hostname;
    const models = cells[1] && !/^unknown$/i.test(cells[1]) ? cells[1] : "";
    const limits = cells[2] || "Не опубликованы в источнике";
    const description = [models ? "Модели/возможности: " + models : "", "Раздел: " + heading].filter(Boolean).join(". ");
    entries.push({
      id: "remote-" + slug(new URL(url).hostname + "-" + name),
      name,
      url,
      categoryIds: categoryForHeading(heading),
      description,
      limits,
      catalogSource: "github-no-cost-ai",
      sourceUrl: CATALOG_SOURCES.noCostAi.url,
      lastVerified: verifiedAt
    });
  }

  const unique = new Map<string, RemoteProvider>();
  for (const entry of entries) {
    const key = hostnameKey(entry.url);
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFreeApiJson(raw: string, verifiedAt = new Date().toISOString()): RemoteProvider[] {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !Array.isArray(parsed.providers)) {
    throw new Error("awesome-free-llm-apis data.json has an unsupported schema");
  }

  const entries: RemoteProvider[] = [];
  for (const candidate of parsed.providers) {
    if (!isRecord(candidate)) continue;
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const url = safeHttpUrl(candidate.url);
    const apiBaseUrl = safeHttpUrl(candidate.baseUrl);
    if (!name || !url || !apiBaseUrl) continue;

    const modelDetails: CatalogModelInfo[] = Array.isArray(candidate.models)
      ? candidate.models.filter(isRecord).flatMap((model) => {
          const id = typeof model.id === "string" ? model.id : "";
          const modelName = typeof model.name === "string" ? model.name : id;
          if (!id || !modelName) return [];
          return [{
            id,
            name: modelName,
            context: typeof model.context === "string" ? model.context : undefined,
            maxOutput: typeof model.maxOutput === "string" ? model.maxOutput : undefined,
            modality: typeof model.modality === "string" ? model.modality : undefined,
            limits: typeof model.rateLimit === "string" ? model.rateLimit : undefined
          }];
        })
      : [];

    entries.push({
      id: "remote-api-" + slug(name),
      name,
      url,
      apiBaseUrl,
      categoryIds: ["api-providers"],
      description: typeof candidate.description === "string" ? candidate.description : "Описание не опубликовано.",
      limits: modelDetails.map((model) => model.limits).filter(Boolean).join("; ") || "Не опубликованы",
      regionTag: typeof candidate.country === "string" ? candidate.country : undefined,
      modelDetails,
      catalogSource: "github-free-apis",
      sourceUrl: CATALOG_SOURCES.freeApis.url,
      lastVerified: verifiedAt
    });
  }
  return entries;
}

async function fetchText(url: string): Promise<string> {
  const response = await session.defaultSession.fetch(url, {
    headers: { "user-agent": "AIHub-Studio-Catalog-Updater/1.0", accept: "text/plain, application/json" }
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " while fetching " + url);
  const body = await response.text();
  if (!body.trim()) throw new Error("Empty catalog source: " + url);
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
        updated++;
      } else unchanged++;
      continue;
    }

    const uniqueId = state.providers.some((provider) => provider.id === entry.id)
      ? entry.id + "-" + slug(hostnameKey(entry.url))
      : entry.id;
    const provider: WebsiteProvider = {
      id: uniqueId,
      name: entry.name,
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
  constructor(private readonly store: CatalogStore, private readonly statePath?: string) {}

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
      { id: CATALOG_SOURCES.noCostAi.id, label: CATALOG_SOURCES.noCostAi.label, run: async () => parseNoCostAiMarkdown(await fetchText(CATALOG_SOURCES.noCostAi.url)) },
      { id: CATALOG_SOURCES.freeApis.id, label: CATALOG_SOURCES.freeApis.label, run: async () => parseFreeApiJson(await fetchText(CATALOG_SOURCES.freeApis.url)) }
    ];

    for (const task of tasks) {
      try {
        const entries = await task.run();
        if (entries.length === 0) throw new Error("Source parsed successfully but contained no usable providers");
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
      await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });
      await writeFile(this.statePath, JSON.stringify({ lastSuccessfulSync: completedAt }, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
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

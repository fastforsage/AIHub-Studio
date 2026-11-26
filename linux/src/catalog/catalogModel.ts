import { randomUUID } from "node:crypto";
import { normalizeWebsiteUrl } from "../shared/webUrl";

export type ProviderKind = "website" | "local-api";

export interface CatalogModelInfo {
  id: string;
  name: string;
  description?: string;
  context?: string;
  maxOutput?: string;
  modality?: string;
  limits?: string;
}

export interface Category {
  id: string;
  name: string;
}

interface ProviderBase {
  id: string;
  name: string;
  categoryIds: string[];
  favorite: boolean;
  enabled: boolean;
  description?: string;
  limits?: string;
  regionTag?: string;
  apiBaseUrl?: string;
  modelDetails?: CatalogModelInfo[];
  catalogSource?: "builtin-ru-cn" | "github-no-cost-ai" | "github-free-apis";
  sourceUrl?: string;
  lastVerified?: string;
}

export interface WebsiteProvider extends ProviderBase {
  type: "website";
  url: string;
  profileId: string;
}

export interface LocalApiProvider extends ProviderBase {
  type: "local-api";
  apiType: "openai";
  host: string;
  port: number;
  models: string[];
  selectedModel?: string;
}

export type Provider = WebsiteProvider | LocalApiProvider;

export interface CatalogState {
  version: 1;
  catalogSeedVersion?: number;
  categories: Category[];
  providers: Provider[];
}

export type IdFactory = () => string;

export class CatalogError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

export const DEFAULT_CATEGORIES: ReadonlyArray<Category> = [
  { id: "chatbot", name: "chatbot" },
  { id: "music-generator", name: "music generator" },
  { id: "voice-generator", name: "voice generator" },
  { id: "video-generator", name: "video generator" },
  { id: "writing-helper", name: "writing helper" },
  { id: "research-assistant", name: "research assistant" },
  { id: "translator", name: "translator" },
  { id: "presentation-maker", name: "presentation maker" },
  { id: "image-generator", name: "image generator" },
  { id: "many-in-one", name: "many in one" },
  { id: "api-providers", name: "API providers and aggregators" },
  { id: "ru-cn-direct", name: "RU & CN Direct (Без VPN)" },
  { id: "local-ai", name: "Local AI" }
];

import { POPULAR_PROVIDER_IDS } from "./catalogDefaults";

const DEFAULT_WEBSITES: ReadonlyArray<{ id: string; name: string; url: string; categoryIds: string[]; apiBaseUrl?: string; description?: string; limits?: string; regionTag?: string }> = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", categoryIds: ["chatbot"] },
  { id: "alice-ai", name: "Алиса AI — Яндекс", url: "https://alice.yandex.ru/", categoryIds: ["chatbot", "ru-cn-direct"], description: "Русскоязычный чат-ассистент Яндекса.", limits: "Условия бесплатного доступа могут меняться; см. актуальные условия сервиса.", regionTag: "RU" },
  { id: "gigachat", name: "GigaChat — Сбер", url: "https://giga.chat/", categoryIds: ["chatbot", "ru-cn-direct"], description: "Русскоязычный AI-ассистент Сбера.", limits: "Лимиты зависят от тарифа и аккаунта; см. актуальные условия сервиса.", regionTag: "RU" },
  { id: "claude", name: "Claude", url: "https://claude.ai/", categoryIds: ["chatbot"] },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/", categoryIds: ["chatbot"] },
  { id: "grok", name: "Grok", url: "https://grok.com/", categoryIds: ["chatbot"] },
  { id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com/", categoryIds: ["chatbot", "ru-cn-direct"], description: "Китайский AI-чат для диалогов, поиска и рассуждений. Также доступен API для разработчиков.", limits: "Лимиты веб-чата динамические; API trial и квоты зависят от условий аккаунта.", apiBaseUrl: "https://api.deepseek.com", regionTag: "CN" },
  { id: "perplexity", name: "Perplexity", url: "https://www.perplexity.ai/", categoryIds: ["chatbot"] },
  { id: "copilot", name: "Copilot", url: "https://copilot.microsoft.com/", categoryIds: ["chatbot"] },
  { id: "mistral", name: "Mistral", url: "https://chat.mistral.ai/", categoryIds: ["chatbot", "api-providers"] },
  { id: "openrouter", name: "OpenRouter Chat", url: "https://openrouter.ai/chat", categoryIds: ["chatbot"] },
  { id: "kimi", name: "Kimi", url: "https://www.kimi.com/", categoryIds: ["chatbot", "ru-cn-direct"], description: "Китайский AI-ассистент Moonshot AI.", limits: "Лимиты веб-чата могут меняться; см. условия аккаунта.", regionTag: "CN" },
  { id: "qwen", name: "Qwen", url: "https://chat.qwen.ai/", categoryIds: ["chatbot", "ru-cn-direct"], description: "Веб-чат семейства моделей Qwen от Alibaba.", limits: "Лимиты зависят от выбранной модели и текущих условий сервиса.", regionTag: "CN" },
  { id: "google-ai-studio", name: "Google AI Studio", url: "https://aistudio.google.com/", categoryIds: ["chatbot", "api-providers"] },
  { id: "poe", name: "Poe", url: "https://poe.com/", categoryIds: ["chatbot"] },
  { id: "suno", name: "Suno", url: "https://suno.com/", categoryIds: ["music-generator"] },
  { id: "elevenlabs", name: "ElevenLabs", url: "https://elevenlabs.io/", categoryIds: ["voice-generator"] },
  { id: "notebooklm", name: "NotebookLM", url: "https://notebooklm.google.com/", categoryIds: ["research-assistant"] },
  { id: "deepwiki", name: "DeepWiki", url: "https://deepwiki.com/", categoryIds: ["research-assistant"] },
  { id: "deepl", name: "DeepL", url: "https://www.deepl.com/translator", categoryIds: ["translator"] },
  { id: "gamma", name: "Gamma", url: "https://gamma.app/", categoryIds: ["presentation-maker"] },
  { id: "google-labs", name: "Google Labs", url: "https://labs.google/", categoryIds: ["many-in-one"] },
  { id: "nvidia-nim", name: "NVIDIA NIM", url: "https://build.nvidia.com/", categoryIds: ["api-providers"] },
  { id: "groqcloud", name: "GroqCloud", url: "https://console.groq.com/", categoryIds: ["api-providers"] },
  { id: "cloudflare-workers-ai", name: "Cloudflare Workers AI", url: "https://developers.cloudflare.com/workers-ai/", categoryIds: ["api-providers"] },
  { id: "cohere", name: "Cohere", url: "https://dashboard.cohere.com/", categoryIds: ["api-providers"] },
  { id: "cerebras-inference", name: "Cerebras Inference", url: "https://www.cerebras.ai/inference", categoryIds: ["api-providers"] },
  { id: "sambanova-cloud", name: "SambaNova Cloud", url: "https://cloud.sambanova.ai/", categoryIds: ["api-providers"] },
  { id: "modelscope", name: "ModelScope API-Inference", url: "https://modelscope.cn/", categoryIds: ["api-providers", "ru-cn-direct"], apiBaseUrl: "https://api-inference.modelscope.cn/v1", description: "API-Inference для моделей из каталога ModelScope.", limits: "Требуется регистрация и подтверждение аккаунта; квоты динамические.", regionTag: "CN" },
  { id: "huggingface-inference", name: "Hugging Face Inference Providers", url: "https://huggingface.co/docs/inference-providers", categoryIds: ["api-providers"] },
  { id: "opencode-zen", name: "OpenCode Zen", url: "https://opencode.ai/en/zen", categoryIds: ["api-providers"] },
  { id: "kilo-ai-gateway", name: "Kilo AI Gateway", url: "https://kilo.ai/gateway", categoryIds: ["api-providers"] }
  ,{ id: "bothub", name: "BotHub", url: "https://bothub.chat/", categoryIds: ["chatbot", "ru-cn-direct"], description: "Агрегатор AI-чатов и моделей.", limits: "Лимиты зависят от модели и тарифа.", regionTag: "RU" }
  ,{ id: "gptunnel", name: "GPTunnel", url: "https://gptunnel.ru/", categoryIds: ["chatbot", "ru-cn-direct"], description: "Российская площадка доступа к AI-моделям.", limits: "Условия и доступность зависят от выбранной модели.", regionTag: "RU" }
  ,{ id: "shedevrum", name: "Шедеврум", url: "https://shedevrum.ai/", categoryIds: ["image-generator", "ru-cn-direct"] }
  ,{ id: "rudalle", name: "Kandinsky / ruDALL-E", url: "https://rudalle.ru/", categoryIds: ["image-generator", "ru-cn-direct"] }
  ,{ id: "sourcecraft", name: "SourceCraft", url: "https://sourcecraft.dev/", categoryIds: ["many-in-one", "ru-cn-direct"] }
  ,{ id: "zai-chat", name: "Z.ai / GLM", url: "https://chat.z.ai/", categoryIds: ["chatbot", "ru-cn-direct"] }
  ,{ id: "doubao", name: "Doubao", url: "https://www.doubao.com/", categoryIds: ["chatbot", "ru-cn-direct"] }
  ,{ id: "tencent-yuanbao", name: "Tencent Yuanbao", url: "https://yuanbao.tencent.com/", categoryIds: ["chatbot", "ru-cn-direct"] }
  ,{ id: "kling", name: "Kling AI", url: "https://klingai.com/", categoryIds: ["video-generator", "ru-cn-direct"] }
  ,{ id: "hailuo", name: "Hailuo AI", url: "https://hailuoai.video/", categoryIds: ["video-generator", "ru-cn-direct"] }
  ,{ id: "pixverse", name: "PixVerse", url: "https://pixverse.ai/", categoryIds: ["video-generator", "ru-cn-direct"] }
  ,{ id: "vidu", name: "Vidu", url: "https://www.vidu.com/", categoryIds: ["video-generator", "ru-cn-direct"] }
  ,{ id: "capcut", name: "CapCut", url: "https://www.capcut.com/", categoryIds: ["video-generator", "ru-cn-direct"] }
  ,{ id: "zhipu-api", name: "Zhipu GLM API", url: "https://open.bigmodel.cn/", categoryIds: ["api-providers", "ru-cn-direct"], apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4", description: "OpenAI-совместимый API платформы Zhipu AI.", limits: "Бесплатные Flash-модели; квоты и доступность проверяйте в консоли.", regionTag: "CN" }
  ,{ id: "siliconflow-api", name: "SiliconFlow API", url: "https://siliconflow.cn/", categoryIds: ["api-providers", "ru-cn-direct"], apiBaseUrl: "https://api.siliconflow.cn/v1", description: "API-платформа с каталогом моделей разных разработчиков.", limits: "Бесплатный пул доступен не для всех моделей; квоты динамические.", regionTag: "CN" }
];

export function createDefaultCatalog(): CatalogState {
  return {
    version: 1,
    catalogSeedVersion: 3,
    categories: DEFAULT_CATEGORIES.map((item) => ({ ...item })),
    providers: DEFAULT_WEBSITES.map((item) => ({
      ...item,
      type: "website" as const,
      categoryIds: [...item.categoryIds],
      favorite: false,
      enabled: POPULAR_PROVIDER_IDS.includes(item.id),
      profileId: item.id,
      ...(item.categoryIds.includes("ru-cn-direct") ? { catalogSource: "builtin-ru-cn" as const, regionTag: item.regionTag ?? (["zai-chat", "doubao", "tencent-yuanbao", "kling", "hailuo", "pixverse", "vidu", "capcut", "rudalle"].includes(item.id) ? "CN" : "RU"), apiBaseUrl: item.apiBaseUrl, description: item.description ?? ("Веб-интерфейс сервиса " + item.name + "."), limits: item.limits ?? "Точные лимиты зависят от тарифа, региона и аккаунта; проверьте условия на сайте." } : {})
    }))
  };
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new CatalogError("INVALID_INPUT", field + " must not be empty");
  }
  return normalized;
}

function ensureUniqueName(
  name: string,
  values: Array<{ id: string; name: string }>,
  exceptId?: string
): void {
  const normalized = name.toLocaleLowerCase();
  if (values.some((value) => value.id !== exceptId && value.name.toLocaleLowerCase() === normalized)) {
    throw new CatalogError("DUPLICATE_NAME", "An item with this name already exists");
  }
}

function requireCategoryIds(state: CatalogState, categoryIds: string[]): string[] {
  const unique = [...new Set(categoryIds)];
  if (unique.length !== categoryIds.length) {
    throw new CatalogError("DUPLICATE_CATEGORY", "Category assignment contains duplicates");
  }
  for (const id of unique) {
    if (!state.categories.some((category) => category.id === id)) {
      throw new CatalogError("UNKNOWN_CATEGORY", "Unknown category: " + id);
    }
  }
  return unique;
}

function validateHost(hostInput: string): string {
  const host = requireText(hostInput, "Host");
  if (/[/\\\s?#@]/.test(host) || /^[a-z][a-z\d+.-]*:/i.test(host)) {
    throw new CatalogError("INVALID_HOST", "Host must contain only a hostname or IP address");
  }

  const urlHost = host.includes(":") && !host.startsWith("[") ? "[" + host + "]" : host;
  try {
    const parsed = new URL("http://" + urlHost + ":11434");
    if (!parsed.hostname) throw new Error("missing hostname");
  } catch {
    throw new CatalogError("INVALID_HOST", "Host is not a valid hostname or IP address");
  }
  return host;
}

function validatePort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CatalogError("INVALID_PORT", "Port must be an integer from 1 to 65535");
  }
  return port;
}

export function addCategory(
  state: CatalogState,
  nameInput: string,
  idFactory: IdFactory = randomUUID
): CatalogState {
  const name = requireText(nameInput, "Category name");
  ensureUniqueName(name, state.categories);
  const id = idFactory();
  if (state.categories.some((category) => category.id === id) || state.providers.some((provider) => provider.id === id)) {
    throw new CatalogError("DUPLICATE_ID", "Generated identifier already exists");
  }
  return { ...state, categories: [...state.categories, { id, name }] };
}

export function renameCategory(state: CatalogState, id: string, nameInput: string): CatalogState {
  const current = state.categories.find((category) => category.id === id);
  if (!current) throw new CatalogError("NOT_FOUND", "Category was not found");
  const name = requireText(nameInput, "Category name");
  ensureUniqueName(name, state.categories, id);
  return {
    ...state,
    categories: state.categories.map((category) => category.id === id ? { ...category, name } : category)
  };
}

export function deleteCategory(state: CatalogState, id: string): CatalogState {
  if (!state.categories.some((category) => category.id === id)) {
    throw new CatalogError("NOT_FOUND", "Category was not found");
  }
  return {
    ...state,
    categories: state.categories.filter((category) => category.id !== id),
    providers: state.providers.map((provider) => ({
      ...provider,
      categoryIds: provider.categoryIds.filter((categoryId) => categoryId !== id)
    }))
  };
}

export interface AddWebsiteInput {
  name: string;
  url: string;
  categoryIds?: string[];
}

export function addWebsiteProvider(
  state: CatalogState,
  input: AddWebsiteInput,
  idFactory: IdFactory = randomUUID
): CatalogState {
  const name = requireText(input.name, "Website name");
  ensureUniqueName(name, state.providers);
  const url = normalizeWebsiteUrl(input.url);
  if (!url) throw new CatalogError("INVALID_URL", "Only valid HTTP or HTTPS website URLs are supported");

  const categoryIds = requireCategoryIds(state, input.categoryIds ?? ["chatbot"]);
  const id = idFactory();
  if (state.providers.some((provider) => provider.id === id) || state.categories.some((category) => category.id === id)) {
    throw new CatalogError("DUPLICATE_ID", "Generated identifier already exists");
  }

  const provider: WebsiteProvider = {
    id, name, type: "website", url, categoryIds, favorite: false, enabled: true, profileId: id
  };
  return { ...state, providers: [...state.providers, provider] };
}

export interface AddLocalApiInput {
  name: string;
  apiType?: "openai";
  host: string;
  port: number;
  categoryIds?: string[];
}

export function addLocalApiProvider(
  state: CatalogState,
  input: AddLocalApiInput,
  idFactory: IdFactory = randomUUID
): CatalogState {
  const name = requireText(input.name, "Connection name");
  ensureUniqueName(name, state.providers);
  if (input.apiType !== undefined && input.apiType !== "openai") {
    throw new CatalogError("UNSUPPORTED_API", "Only OpenAI-compatible API is currently supported");
  }

  const host = validateHost(input.host);
  const port = validatePort(input.port);
  const categoryIds = requireCategoryIds(state, input.categoryIds ?? ["local-ai"]);
  const id = idFactory();
  if (state.providers.some((provider) => provider.id === id) || state.categories.some((category) => category.id === id)) {
    throw new CatalogError("DUPLICATE_ID", "Generated identifier already exists");
  }

  const provider: LocalApiProvider = {
    id, name, type: "local-api", apiType: "openai", host, port,
    categoryIds, favorite: false, enabled: true, models: []
  };
  return { ...state, providers: [...state.providers, provider] };
}

export type ProviderUpdate =
  | { type: "website"; name: string; url: string; categoryIds: string[] }
  | { type: "local-api"; name: string; host: string; port: number; categoryIds: string[] };

export function updateProvider(
  state: CatalogState,
  id: string,
  update: ProviderUpdate
): CatalogState {
  const current = state.providers.find((provider) => provider.id === id);
  if (!current) throw new CatalogError("NOT_FOUND", "Connection was not found");

  const name = requireText(update.name, "Connection name");
  ensureUniqueName(name, state.providers, id);
  const categoryIds = requireCategoryIds(state, update.categoryIds);

  let updated: Provider;
  if (current.type === "website" && update.type === "website") {
    const url = normalizeWebsiteUrl(update.url);
    if (!url) throw new CatalogError("INVALID_URL", "Only valid HTTP or HTTPS website URLs are supported");
    updated = { ...current, name, url, categoryIds };
  } else if (current.type === "local-api" && update.type === "local-api") {
    const host = validateHost(update.host);
    const port = validatePort(update.port);
    updated = { ...current, name, host, port, categoryIds };
  } else {
    throw new CatalogError("TYPE_MISMATCH", "Connection type cannot be changed");
  }

  return { ...state, providers: state.providers.map((provider) => provider.id === id ? updated : provider) };
}


export function updateLocalModels(
  state: CatalogState,
  id: string,
  modelIds: string[]
): CatalogState {
  const provider = state.providers.find((item) => item.id === id);
  if (!provider) throw new CatalogError("NOT_FOUND", "Connection was not found");
  if (provider.type !== "local-api") {
    throw new CatalogError("TYPE_MISMATCH", "Model discovery is only available for Local AI connections");
  }
  if (!Array.isArray(modelIds) || modelIds.some((model) => typeof model !== "string" || !model.trim())) {
    throw new CatalogError("INVALID_MODELS", "Discovered model identifiers must be non-empty strings");
  }

  const models = [...new Set(modelIds.map((model) => model.trim()))];
  const selectedModel = provider.selectedModel && models.includes(provider.selectedModel)
    ? provider.selectedModel
    : models[0];

  return {
    ...state,
    providers: state.providers.map((item) => item.id === id && item.type === "local-api"
      ? { ...item, models, selectedModel }
      : item)
  };
}

export function selectLocalModel(
  state: CatalogState,
  id: string,
  modelId: string
): CatalogState {
  const provider = state.providers.find((item) => item.id === id);
  if (!provider) throw new CatalogError("NOT_FOUND", "Connection was not found");
  if (provider.type !== "local-api") {
    throw new CatalogError("TYPE_MISMATCH", "Model selection is only available for Local AI connections");
  }
  if (!provider.models.includes(modelId)) {
    throw new CatalogError("UNKNOWN_MODEL", "Selected model is not present in the discovered model list");
  }

  return {
    ...state,
    providers: state.providers.map((item) => item.id === id && item.type === "local-api"
      ? { ...item, selectedModel: modelId }
      : item)
  };
}

export function deleteProvider(state: CatalogState, id: string): CatalogState {
  if (!state.providers.some((provider) => provider.id === id)) {
    throw new CatalogError("NOT_FOUND", "Connection was not found");
  }
  return { ...state, providers: state.providers.filter((provider) => provider.id !== id) };
}

export function setProviderFavorite(state: CatalogState, id: string, favorite: boolean): CatalogState {
  if (!state.providers.some((provider) => provider.id === id)) {
    throw new CatalogError("NOT_FOUND", "Connection was not found");
  }
  return {
    ...state,
    providers: state.providers.map((provider) => provider.id === id ? { ...provider, favorite } : provider)
  };
}

export function setEnabledProviders(state: CatalogState, enabledProviderIds: string[]): CatalogState {
  const selected = new Set(enabledProviderIds);
  if (selected.size !== enabledProviderIds.length) {
    throw new CatalogError("DUPLICATE_PROVIDER", "Provider selection contains duplicates");
  }
  const knownIds = new Set(state.providers.map((provider) => provider.id));
  for (const id of selected) {
    if (!knownIds.has(id)) throw new CatalogError("NOT_FOUND", "Connection was not found: " + id);
  }
  return {
    ...state,
    providers: state.providers.map((provider) => ({ ...provider, enabled: selected.has(provider.id) }))
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertCatalogState(value: unknown): asserts value is CatalogState {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.categories) || !Array.isArray(value.providers)) {
    throw new CatalogError("INVALID_CATALOG", "Catalog document has an unsupported structure or version");
  }

  if (value.catalogSeedVersion !== undefined &&
      (typeof value.catalogSeedVersion !== "number" || !Number.isInteger(value.catalogSeedVersion) || value.catalogSeedVersion < 1)) {
    throw new CatalogError("INVALID_CATALOG", "Catalog seed version is invalid");
  }

  const categoryIds = new Set<string>();
  const categoryNames = new Set<string>();
  for (const item of value.categories) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim()) {
      throw new CatalogError("INVALID_CATALOG", "Catalog contains an invalid category");
    }
    if (categoryIds.has(item.id) || categoryNames.has(item.name.toLocaleLowerCase())) {
      throw new CatalogError("INVALID_CATALOG", "Catalog contains duplicate category identifiers or names");
    }
    categoryIds.add(item.id);
    categoryNames.add(item.name.toLocaleLowerCase());
  }

  const providerIds = new Set<string>();
  const providerNames = new Set<string>();
  for (const item of value.providers) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id || typeof item.name !== "string" ||
        !item.name.trim() || !Array.isArray(item.categoryIds) || typeof item.favorite !== "boolean" ||
        typeof item.enabled !== "boolean") {
      throw new CatalogError("INVALID_CATALOG", "Catalog contains an invalid connection");
    }
    if (providerIds.has(item.id) || providerNames.has(item.name.toLocaleLowerCase()) || categoryIds.has(item.id)) {
      throw new CatalogError("INVALID_CATALOG", "Catalog contains duplicate connection identifiers or names");
    }
    providerIds.add(item.id);
    providerNames.add(item.name.toLocaleLowerCase());

    for (const categoryId of item.categoryIds) {
      if (typeof categoryId !== "string" || !categoryIds.has(categoryId)) {
        throw new CatalogError("INVALID_CATALOG", "Connection references a missing category");
      }
    }

    for (const field of ["description", "limits", "regionTag", "apiBaseUrl", "sourceUrl", "lastVerified"] as const) {
      if (item[field] !== undefined && typeof item[field] !== "string") {
        throw new CatalogError("INVALID_CATALOG", "Catalog provider metadata contains an invalid " + field);
      }
    }
    if (item.apiBaseUrl !== undefined && !normalizeWebsiteUrl(item.apiBaseUrl)) {
      throw new CatalogError("INVALID_CATALOG", "Catalog provider API base URL is invalid");
    }
    if (item.sourceUrl !== undefined && !normalizeWebsiteUrl(item.sourceUrl)) {
      throw new CatalogError("INVALID_CATALOG", "Catalog provider source URL is invalid");
    }
    if (item.catalogSource !== undefined &&
        !["builtin-ru-cn", "github-no-cost-ai", "github-free-apis"].includes(String(item.catalogSource))) {
      throw new CatalogError("INVALID_CATALOG", "Catalog provider source identifier is invalid");
    }
    if (item.modelDetails !== undefined) {
      if (!Array.isArray(item.modelDetails) || item.modelDetails.some((model) =>
        !isRecord(model) || typeof model.id !== "string" || !model.id.trim() ||
        typeof model.name !== "string" || !model.name.trim() ||
        ["description", "context", "maxOutput", "modality", "limits"].some((field) =>
          model[field] !== undefined && typeof model[field] !== "string"
        )
      )) {
        throw new CatalogError("INVALID_CATALOG", "Catalog provider contains invalid model details");
      }
    }

    if (item.type === "website") {
      if (typeof item.url !== "string" || !normalizeWebsiteUrl(item.url) ||
          typeof item.profileId !== "string" || !item.profileId) {
        throw new CatalogError("INVALID_CATALOG", "Catalog contains an invalid website connection");
      }
    } else if (item.type === "local-api") {
      if (item.apiType !== "openai" || typeof item.host !== "string" ||
          typeof item.port !== "number" || !Array.isArray(item.models) ||
          item.models.some((model) => typeof model !== "string" || !model.trim()) ||
          new Set(item.models).size !== item.models.length) {
        throw new CatalogError("INVALID_CATALOG", "Catalog contains an invalid local API connection");
      }
      validateHost(item.host);
      validatePort(item.port);
      if (item.selectedModel !== undefined &&
          (typeof item.selectedModel !== "string" || !item.models.includes(item.selectedModel))) {
        throw new CatalogError("INVALID_CATALOG", "Selected model must exist in the discovered model list");
      }
    } else {
      throw new CatalogError("INVALID_CATALOG", "Catalog contains an unknown connection type");
    }
  }
}

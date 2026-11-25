interface ProviderBrandIconProps {
  providerId: string;
  name: string;
  size?: "small" | "medium" | "large";
}

interface BrandDefinition {
  glyph: string;
  brand: string;
}

const BRANDS: Record<string, BrandDefinition> = {
  "alice-ai": { glyph: "Я", brand: "yandex" },
  gigachat: { glyph: "✓", brand: "sber" },
  chatgpt: { glyph: "✳", brand: "openai" },
  claude: { glyph: "✣", brand: "anthropic" },
  gemini: { glyph: "✦", brand: "google" },
  grok: { glyph: "𝕏", brand: "x" },
  deepseek: { glyph: "≈", brand: "deepseek" },
  perplexity: { glyph: "P", brand: "perplexity" },
  copilot: { glyph: "∞", brand: "microsoft" },
  mistral: { glyph: "✺", brand: "mistral" },
  openrouter: { glyph: "O", brand: "openrouter" },
  kimi: { glyph: "K", brand: "kimi" },
  qwen: { glyph: "Q", brand: "qwen" },
  "google-ai-studio": { glyph: "G", brand: "google" },
  poe: { glyph: "P", brand: "poe" },
  suno: { glyph: "♪", brand: "suno" },
  elevenlabs: { glyph: "11", brand: "elevenlabs" },
  notebooklm: { glyph: "N", brand: "google" },
  deepwiki: { glyph: "W", brand: "deepwiki" },
  deepl: { glyph: "D", brand: "deepl" },
  gamma: { glyph: "G", brand: "gamma" },
  "google-labs": { glyph: "✦", brand: "google" },
  "nvidia-nim": { glyph: "N", brand: "nvidia" },
  groqcloud: { glyph: "G", brand: "groq" },
  "cloudflare-workers-ai": { glyph: "C", brand: "cloudflare" },
  cohere: { glyph: "C", brand: "cohere" },
  "cerebras-inference": { glyph: "C", brand: "cerebras" },
  "sambanova-cloud": { glyph: "S", brand: "sambanova" },
  modelscope: { glyph: "M", brand: "modelscope" },
  "huggingface-inference": { glyph: "🤗", brand: "huggingface" },
  "opencode-zen": { glyph: "⌘", brand: "opencode" },
  "kilo-ai-gateway": { glyph: "K", brand: "kilo" }
};

export function ProviderBrandIcon({ providerId, name, size = "medium" }: ProviderBrandIconProps) {
  const definition = BRANDS[providerId];
  const glyph = definition?.glyph ?? (name.trim().slice(0, 1).toUpperCase() || "?");
  const brand = definition?.brand ?? "generic";

  return (
    <span
      className={"provider-brand-icon provider-brand-icon-" + size + " provider-brand-" + brand}
      role="img"
      aria-label={name}
      title={name}
    >
      {glyph}
    </span>
  );
}

import { createHash } from "node:crypto";
import { normalizeWebsiteUrl } from "../shared/webUrl";
import type { BrowserBounds } from "./browserTypes";

export function normalizeBrowserUrl(input: string): string | null {
  return normalizeWebsiteUrl(input);
}

export function profilePartition(profileId: string): string {
  const value = profileId.trim();
  if (!value) throw new Error("Browser profile identifier is required");
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return "persist:aihub-" + digest;
}

export function clampBrowserBounds(
  requested: BrowserBounds,
  contentWidth: number,
  contentHeight: number
): BrowserBounds {
  const maxWidth = Number.isFinite(contentWidth) ? Math.max(0, Math.floor(contentWidth)) : 0;
  const maxHeight = Number.isFinite(contentHeight) ? Math.max(0, Math.floor(contentHeight)) : 0;
  const x = clampInteger(requested.x, 0, maxWidth);
  const y = clampInteger(requested.y, 0, maxHeight);
  const width = clampInteger(requested.width, 0, Math.max(0, maxWidth - x));
  const height = clampInteger(requested.height, 0, Math.max(0, maxHeight - y));
  return { x, y, width, height };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

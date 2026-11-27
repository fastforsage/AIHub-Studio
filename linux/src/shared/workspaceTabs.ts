import type { BrowserTabInfo } from "../browser/browserTypes";
import type { Provider } from "../catalog/catalogModel";

export type WorkspaceTab =
  | { kind: "website"; key: string; browserTabId: string; title: string; url: string; loading: boolean }
  | { kind: "local-ai"; key: string; providerId: string; title: string };

export function buildWorkspaceTabs(
  browserTabs: readonly BrowserTabInfo[],
  providers: readonly Provider[],
  openLocalProviderIds: readonly string[]
): WorkspaceTab[] {
  const localProviders = new Map(
    providers.filter((provider) => provider.type === "local-api").map((provider) => [provider.id, provider])
  );
  const seenLocalIds = new Set<string>();
  const localTabs: WorkspaceTab[] = [];

  for (const providerId of openLocalProviderIds) {
    if (seenLocalIds.has(providerId)) continue;
    seenLocalIds.add(providerId);
    const provider = localProviders.get(providerId);
    if (!provider) continue;
    localTabs.push({ kind: "local-ai", key: "local:" + provider.id, providerId: provider.id, title: provider.name });
  }

  return [
    ...browserTabs.map((tab): WorkspaceTab => ({
      kind: "website", key: "website:" + tab.id, browserTabId: tab.id,
      title: tab.title || new URL(tab.url).hostname, url: tab.url, loading: tab.loading
    })),
    ...localTabs
  ];
}

/** Plan a bulk close without assuming website and local tabs share storage. */
export function planWorkspaceTabClose(tabs: readonly WorkspaceTab[], keepKey: string | null) {
  return {
    websiteIds: tabs.flatMap((tab) => tab.kind === "website" && tab.key !== keepKey ? [tab.browserTabId] : []),
    keptTab: tabs.find((tab) => tab.key === keepKey) ?? null
  };
}

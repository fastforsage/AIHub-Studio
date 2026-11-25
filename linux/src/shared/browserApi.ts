import type { BrowserBounds, BrowserManagerState } from "../browser/browserTypes";

export interface BrowserApi {
  get(): Promise<BrowserManagerState>;
  openWebsite(providerId: string): Promise<BrowserManagerState>;
  activate(tabId: string): Promise<BrowserManagerState>;
  close(tabId: string): Promise<BrowserManagerState>;
  navigate(tabId: string, url: string): Promise<BrowserManagerState>;
  back(tabId: string): Promise<BrowserManagerState>;
  forward(tabId: string): Promise<BrowserManagerState>;
  reload(tabId: string): Promise<BrowserManagerState>;
  setViewportBounds(bounds: BrowserBounds): Promise<BrowserManagerState>;
  getProxyServer(): Promise<string | null>;
  setProxyServer(value: string): Promise<string | null>;
  onChanged(listener: (state: BrowserManagerState) => void): () => void;
}

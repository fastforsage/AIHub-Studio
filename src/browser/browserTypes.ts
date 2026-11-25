export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserTabInfo {
  id: string;
  providerId: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
}

export interface BrowserManagerState {
  tabs: BrowserTabInfo[];
  activeTabId: string | null;
}

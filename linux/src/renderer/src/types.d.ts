export {};

declare global {
  interface Window {
    aihub?: {
      platform: string;
      version: string;
    };
  }
}

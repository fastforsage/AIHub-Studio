import { ipcMain, IpcMainInvokeEvent } from "electron";
import { BrowserManager } from "../browser/browserManager";
import { TranslationManager } from "./translationManager";

type TrustedSender = (event: IpcMainInvokeEvent) => boolean;

function assertTrusted(event: IpcMainInvokeEvent, isTrusted: TrustedSender): void {
  if (!isTrusted(event)) throw new Error("Untrusted renderer attempted to access translation IPC");
}

function getSourceLanguage(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const value = (payload as Record<string, unknown>).sourceLanguage;
  if (value === undefined || value === null || value === "" || value === "auto") return undefined;
  if (typeof value !== "string" || !/^(en|zh|ja|ko|de|fr|es|ru)$/.test(value)) {
    throw new Error("Unsupported source language");
  }
  return value;
}

function getTabId(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Invalid translation request");
  }
  const id = (payload as Record<string, unknown>).tabId;
  if (typeof id !== "string" || !id.trim()) throw new Error("Invalid browser tab identifier");
  return id;
}

export function registerTranslationIpc(
  browser: BrowserManager,
  translation: TranslationManager,
  isTrusted: TrustedSender
): void {
  ipcMain.handle("translation:translate-page", async (event, payload: unknown) => {
    assertTrusted(event, isTrusted);
    return browser.translatePage(getTabId(payload), (texts, language) => translation.translate(texts, language), getSourceLanguage(payload));
  });

  ipcMain.handle("translation:restore-page", async (event, payload: unknown) => {
    assertTrusted(event, isTrusted);
    return browser.restoreOriginalPage(getTabId(payload));
  });
}

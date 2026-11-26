import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const translate = vi.fn();
const createProvider = vi.fn(() => ({ translate }));

vi.mock("@molecule/api-ai-translation-bergamot", () => ({
  createProvider: (...args: unknown[]) => createProvider(...args)
}));

import { TranslationManager } from "../src/main/translationManager";

describe("TranslationManager", () => {
  let directory: string;
  let events: Array<{ level: string; message: string; metadata?: unknown }>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "aihub-bergamot-"));
    events = [];
    createProvider.mockClear();
    translate.mockReset();
  });

  async function cleanup(): Promise<void> {
    await rm(directory, { recursive: true, force: true });
  }

  it("initializes the provider once and translates in batches of at most 50", async () => {
    translate.mockImplementation(async ({ text }: { text: string[] }) => ({
      translations: text.map((value) => ({ text: "ru:" + value }))
    }));
    const manager = new TranslationManager(directory, (level, message, metadata) => {
      events.push({ level, message, metadata });
    });

    try {
      const input = Array.from({ length: 51 }, (_, index) => "text-" + index);
      const output = await manager.translate(input, "zh");

      expect(output).toHaveLength(51);
      expect(translate).toHaveBeenCalledTimes(2);
      expect(translate.mock.calls[0][0].text).toHaveLength(50);
      expect(translate.mock.calls[1][0].text).toHaveLength(1);
      expect(translate.mock.calls[0][0]).toMatchObject({ sourceLang: "zh", targetLang: "ru" });
      expect(createProvider).toHaveBeenCalledTimes(1);
      expect(events.some((event) => event.message === "Bergamot provider initialized")).toBe(true);
      expect(events.some((event) => event.message === "Translation request completed")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("logs provider initialization errors and allows a later retry", async () => {
    createProvider.mockImplementationOnce(() => { throw new Error("module load failed"); });
    translate.mockImplementation(async ({ text }: { text: string[] }) => ({
      translations: text.map((value) => ({ text: "ru:" + value }))
    }));
    const manager = new TranslationManager(directory, (level, message, metadata) => {
      events.push({ level, message, metadata });
    });

    try {
      await expect(manager.translate(["hello"], "en")).rejects.toThrow("module load failed");
      await expect(manager.translate(["hello"], "en")).resolves.toEqual(["ru:hello"]);
      expect(createProvider).toHaveBeenCalledTimes(2);
      expect(events.some((event) => event.message === "Bergamot provider initialization failed")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("logs model or inference failures and rethrows them", async () => {
    translate.mockRejectedValue(new Error("model download failed"));
    const manager = new TranslationManager(directory, (level, message, metadata) => {
      events.push({ level, message, metadata });
    });

    try {
      await expect(manager.translate(["hello"], "en")).rejects.toThrow("model download failed");
      expect(events.some((event) => event.level === "error" && event.message === "Bergamot batch failed")).toBe(true);
      expect(events.some((event) => event.level === "error" && event.message === "Translation request failed")).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

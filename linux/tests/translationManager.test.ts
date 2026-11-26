import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  translate: vi.fn(),
  createProvider: vi.fn()
}));

vi.mock("@molecule/api-ai-translation-bergamot", () => ({
  createProvider: (...args: unknown[]) => mocks.createProvider(...args)
}));

import { TranslationManager } from "../src/main/translationManager";

describe("TranslationManager", () => {
  let directory: string;
  let events: Array<{ level: string; message: string; metadata?: unknown }>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "aihub-bergamot-"));
    events = [];
    mocks.createProvider.mockClear();
    mocks.translate.mockReset();
  });

  async function cleanup(): Promise<void> {
    await rm(directory, { recursive: true, force: true });
  }

  it("initializes the provider once and translates in batches of at most 50", async () => {
    mocks.translate.mockImplementation(async ({ text }: { text: string[] }) => ({
      translations: text.map((value) => ({ text: "ru:" + value }))
    }));
    const manager = new TranslationManager(directory, (level, message, metadata) => {
      events.push({ level, message, metadata });
    });

    try {
      const input = Array.from({ length: 51 }, (_, index) => "text-" + index);
      const output = await manager.translate(input, "zh");

      expect(output).toHaveLength(51);
      expect(mocks.translate).toHaveBeenCalledTimes(2);
      expect(mocks.translate.mock.calls[0][0].text).toHaveLength(50);
      expect(mocks.translate.mock.calls[1][0].text).toHaveLength(1);
      expect(mocks.translate.mock.calls[0][0]).toMatchObject({ sourceLang: "zh", targetLang: "ru" });
      expect(mocks.createProvider).toHaveBeenCalledTimes(1);
      expect(events.some((event) => event.message === "Bergamot provider initialized")).toBe(true);
      expect(events.some((event) => event.message === "Translation request completed")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("logs provider initialization errors and allows a later retry", async () => {
    mocks.createProvider.mockImplementationOnce(() => { throw new Error("module load failed"); });
    mocks.translate.mockImplementation(async ({ text }: { text: string[] }) => ({
      translations: text.map((value) => ({ text: "ru:" + value }))
    }));
    const manager = new TranslationManager(directory, (level, message, metadata) => {
      events.push({ level, message, metadata });
    });

    try {
      await expect(manager.translate(["hello"], "en")).rejects.toThrow("module load failed");
      await expect(manager.translate(["hello"], "en")).resolves.toEqual(["ru:hello"]);
      expect(mocks.createProvider).toHaveBeenCalledTimes(2);
      expect(events.some((event) => event.message === "Bergamot provider initialization failed")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("logs model or inference failures and rethrows them", async () => {
    mocks.translate.mockRejectedValue(new Error("model download failed"));
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

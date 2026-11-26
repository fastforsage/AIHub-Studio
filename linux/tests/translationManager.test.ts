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
  const proxyFetch = vi.fn(async () => new Response("ok"));

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "aihub-bergamot-"));
    events = [];
    mocks.createProvider.mockReset();
    mocks.translate.mockReset();
    mocks.createProvider.mockImplementation(() => ({ translate: mocks.translate }));
    proxyFetch.mockClear();
  });

  async function cleanup(): Promise<void> {
    await rm(directory, { recursive: true, force: true });
  }

  it("uses the application proxy fetch for Bergamot runtime and model downloads", async () => {
    mocks.translate.mockImplementation(async ({ text }: { text: string[] }) => ({
      translations: text.map((value) => ({ text: "ru:" + value }))
    }));
    const manager = new TranslationManager(directory, proxyFetch as typeof fetch, (level, message, metadata) => {
      events.push({ level, message, metadata });
    });

    try {
      await expect(manager.translate(["你好"], "zh")).resolves.toEqual(["ru:你好"]);
      expect(mocks.createProvider).toHaveBeenCalledWith(expect.objectContaining({
        fetch: proxyFetch,
        workers: 1,
        maxLoadedPairs: 2
      }));
      expect(mocks.translate).toHaveBeenCalledWith(expect.objectContaining({ sourceLang: "zh", targetLang: "ru" }));
      expect(events.some((event) => event.message === "Bergamot provider initialized")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("initializes once and translates large requests in batches of at most 50", async () => {
    mocks.translate.mockImplementation(async ({ text }: { text: string[] }) => ({
      translations: text.map((value) => ({ text: "ru:" + value }))
    }));
    const manager = new TranslationManager(directory, proxyFetch as typeof fetch);

    try {
      const input = Array.from({ length: 51 }, (_, index) => "text-" + index);
      const output = await manager.translate(input, "en");
      expect(output).toHaveLength(51);
      expect(mocks.translate).toHaveBeenCalledTimes(2);
      expect(mocks.translate.mock.calls[0][0].text).toHaveLength(50);
      expect(mocks.translate.mock.calls[1][0].text).toHaveLength(1);
      expect(mocks.createProvider).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it("clears a rejected initialization promise so a later attempt can retry", async () => {
    mocks.createProvider.mockImplementationOnce(() => { throw new Error("runtime unavailable"); });
    mocks.translate.mockImplementation(async ({ text }: { text: string[] }) => ({
      translations: text.map((value) => ({ text: "ru:" + value }))
    }));
    const manager = new TranslationManager(directory, proxyFetch as typeof fetch, (level, message, metadata) => {
      events.push({ level, message, metadata });
    });

    try {
      await expect(manager.translate(["hello"], "en")).rejects.toThrow("runtime unavailable");
      await expect(manager.translate(["hello"], "en")).resolves.toEqual(["ru:hello"]);
      expect(mocks.createProvider).toHaveBeenCalledTimes(2);
      expect(events.some((event) => event.message === "Bergamot provider initialization failed")).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

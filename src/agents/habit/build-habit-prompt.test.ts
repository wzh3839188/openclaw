import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildHabitPrompt, formatHabitPromptBlock } from "./build-habit-prompt.js";
import { recognizeIntentAndMatch } from "./recognize.js";
import { loadHabits, writeHabits } from "./storage.js";

vi.mock("./storage.js", () => ({
  loadHabits: vi.fn(),
  writeHabits: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./recognize.js", () => ({
  recognizeIntentAndMatch: vi.fn(),
}));

const workspaceDir = "/tmp/test-workspace";

describe("formatHabitPromptBlock", () => {
  it("returns empty string for empty array", () => {
    expect(formatHabitPromptBlock([])).toBe("");
  });

  it("formats single entry", () => {
    expect(formatHabitPromptBlock([{ intent: "send-file", result: "use send-file skill" }])).toBe(
      "用户习惯：\n当意图为「send-file」时，请优先按以下方式执行：use send-file skill",
    );
  });

  it("formats multiple entries", () => {
    expect(
      formatHabitPromptBlock([
        { intent: "send-file", result: "use send-file" },
        { intent: "reminder", result: "add to calendar" },
      ]),
    ).toBe(
      "用户习惯：\n当意图为「send-file」时，请优先按以下方式执行：use send-file\n当意图为「reminder」时，请优先按以下方式执行：add to calendar",
    );
  });
});

describe("buildHabitPrompt", () => {
  beforeEach(() => {
    vi.mocked(loadHabits).mockResolvedValue([]);
    vi.mocked(recognizeIntentAndMatch).mockResolvedValue([]);
    vi.mocked(writeHabits).mockClear();
  });

  it("returns empty string when no model and no habits", async () => {
    const out = await buildHabitPrompt({
      prompt: "hello",
      workspaceDir,
      config: {},
    });
    expect(out).toBe("");
    expect(recognizeIntentAndMatch).not.toHaveBeenCalled();
  });

  it("uses default USER_HABITS.yaml path when habit.filePath not set", async () => {
    await buildHabitPrompt({
      prompt: "hi",
      workspaceDir,
      config: { agents: { defaults: { habit: { enabled: true } } } },
    });
    expect(loadHabits).toHaveBeenCalledWith(path.join(workspaceDir, "USER_HABITS.yaml"));
  });

  it("uses habit.filePath when set", async () => {
    await buildHabitPrompt({
      prompt: "hi",
      workspaceDir,
      config: {
        agents: {
          defaults: {
            habit: { enabled: true, filePath: "custom/habits.yaml" },
          },
        },
      },
    });
    expect(loadHabits).toHaveBeenCalledWith(path.resolve(workspaceDir, "custom/habits.yaml"));
  });

  it("calls recognizeIntentAndMatch when model provided and returns formatted prompt", async () => {
    const model = {
      id: "gpt-4o-mini",
      name: "GPT-4o mini",
      provider: "openai",
      api: "openai-completions" as const,
      baseUrl: "https://api.openai.com",
      reasoning: false,
      input: ["text"] as ("image" | "text")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8192,
    };
    vi.mocked(recognizeIntentAndMatch).mockResolvedValue([
      { intent: "send-file", result: "use send-file skill" },
    ]);
    const out = await buildHabitPrompt({
      prompt: "把文件发给我",
      workspaceDir,
      config: {},
      model,
      agentDir: "/tmp/agent",
    });
    expect(recognizeIntentAndMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "把文件发给我",
        habits: [],
        model,
        agentDir: "/tmp/agent",
      }),
    );
    expect(out).toBe(
      "用户习惯：\n当意图为「send-file」时，请优先按以下方式执行：use send-file skill",
    );
  });

  it("writes recognized habits to file with source realtime when recognition returns non-empty", async () => {
    const model = {
      id: "gpt-4o-mini",
      name: "GPT-4o mini",
      provider: "openai",
      api: "openai-completions" as const,
      baseUrl: "https://api.openai.com",
      reasoning: false,
      input: ["text"] as ("image" | "text")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8192,
    };
    vi.mocked(recognizeIntentAndMatch).mockResolvedValue([
      { intent: "send-file", result: "use send-file skill" },
    ]);
    await buildHabitPrompt({
      prompt: "以后发文件要用 send-file",
      workspaceDir,
      config: {},
      model,
      agentDir: "/tmp/agent",
    });
    expect(writeHabits).toHaveBeenCalledTimes(1);
    const [filePath, entries] = vi.mocked(writeHabits).mock.calls[0];
    expect(filePath).toBe(path.join(workspaceDir, "USER_HABITS.yaml"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      intent: "send-file",
      result: "use send-file skill",
      source: "realtime",
    });
    expect(entries[0].updatedAt).toBeGreaterThan(0);
  });

  it("does not write when recognized intent matches file entry by alias with same result", async () => {
    const model = {
      id: "gpt-4o-mini",
      name: "GPT-4o mini",
      provider: "openai",
      api: "openai-completions" as const,
      baseUrl: "https://api.openai.com",
      reasoning: false,
      input: ["text"] as ("image" | "text")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8192,
    };
    const existing: Array<{ intent: string; result: string; updatedAt: number; alias?: string[] }> =
      [{ intent: "send-file", result: "use send-file skill", updatedAt: 1000, alias: ["发文件"] }];
    vi.mocked(loadHabits).mockResolvedValue(existing);
    vi.mocked(recognizeIntentAndMatch).mockResolvedValue([
      { intent: "发文件", result: "use send-file skill" },
    ]);
    await buildHabitPrompt({
      prompt: "把文件发给我",
      workspaceDir,
      config: {},
      model,
    });
    expect(writeHabits).not.toHaveBeenCalled();
  });

  it("does not write when all recognized intents already exist in file with same result", async () => {
    const model = {
      id: "gpt-4o-mini",
      name: "GPT-4o mini",
      provider: "openai",
      api: "openai-completions" as const,
      baseUrl: "https://api.openai.com",
      reasoning: false,
      input: ["text"] as ("image" | "text")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8192,
    };
    const existing: Array<{ intent: string; result: string; updatedAt: number }> = [
      { intent: "send-file", result: "use send-file skill", updatedAt: 1000 },
    ];
    vi.mocked(loadHabits).mockResolvedValue(existing);
    vi.mocked(recognizeIntentAndMatch).mockResolvedValue([
      { intent: "send-file", result: "use send-file skill" },
    ]);
    await buildHabitPrompt({
      prompt: "把文件发给我",
      workspaceDir,
      config: {},
      model,
    });
    expect(writeHabits).not.toHaveBeenCalled();
  });

  it("updates file entry by canonical intent when recognized matches by alias with different result", async () => {
    const model = {
      id: "gpt-4o-mini",
      name: "GPT-4o mini",
      provider: "openai",
      api: "openai-completions" as const,
      baseUrl: "https://api.openai.com",
      reasoning: false,
      input: ["text"] as ("image" | "text")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8192,
    };
    const existing: Array<{ intent: string; result: string; updatedAt: number; alias?: string[] }> =
      [{ intent: "send-file", result: "old result", updatedAt: 1000, alias: ["发文件"] }];
    vi.mocked(loadHabits).mockResolvedValue(existing);
    vi.mocked(recognizeIntentAndMatch).mockResolvedValue([
      { intent: "发文件", result: "use send-file skill" },
    ]);
    await buildHabitPrompt({
      prompt: "以后发文件用 send-file",
      workspaceDir,
      config: {},
      model,
    });
    expect(writeHabits).toHaveBeenCalledTimes(1);
    const [, entries] = vi.mocked(writeHabits).mock.calls[0];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      intent: "send-file",
      result: "use send-file skill",
      source: "realtime",
      alias: ["发文件"],
    });
  });

  it("merges new recognized habits with existing and overwrites same intent", async () => {
    const model = {
      id: "gpt-4o-mini",
      name: "GPT-4o mini",
      provider: "openai",
      api: "openai-completions" as const,
      baseUrl: "https://api.openai.com",
      reasoning: false,
      input: ["text"] as ("image" | "text")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8192,
    };
    const existing: Array<{ intent: string; result: string; updatedAt: number }> = [
      { intent: "reminder", result: "add to calendar", updatedAt: 1000 },
    ];
    vi.mocked(loadHabits).mockResolvedValue(existing);
    vi.mocked(recognizeIntentAndMatch).mockResolvedValue([
      { intent: "send-file", result: "use send-file" },
    ]);
    await buildHabitPrompt({
      prompt: "发文件用 send-file",
      workspaceDir,
      config: {},
      model,
    });
    const lastCall =
      vi.mocked(writeHabits).mock.calls[vi.mocked(writeHabits).mock.calls.length - 1];
    const [, entries] = lastCall;
    expect(entries.length).toBe(2);
    const byIntent = new Map(entries.map((e) => [e.intent, e]));
    expect(byIntent.get("reminder")).toMatchObject({ result: "add to calendar" });
    expect(byIntent.get("send-file")).toMatchObject({
      result: "use send-file",
      source: "realtime",
    });
  });
});

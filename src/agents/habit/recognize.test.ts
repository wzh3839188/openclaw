import type { Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { recognizeIntentAndMatch } from "./recognize.js";
import type { HabitEntry } from "./types.js";

vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: vi.fn(),
}));

vi.mock("../model-auth.js", () => ({
  getApiKeyForModel: vi.fn(async () => ({
    apiKey: "test-key",
    source: "test",
    mode: "api-key" as const,
  })),
  requireApiKey: vi.fn((_auth: { apiKey?: string }, _provider: string) => "test-key"),
}));

const mockModel: Model<"openai-completions"> = {
  id: "gpt-4o-mini",
  name: "GPT-4o mini",
  provider: "openai",
  api: "openai-completions",
  baseUrl: "https://api.openai.com",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8192,
};

const emptyConfig = {} as Parameters<typeof recognizeIntentAndMatch>[0]["config"];
const emptyHabits: HabitEntry[] = [];

function mockCompleteReturns(content: string) {
  vi.mocked(completeSimple).mockResolvedValue({
    content: [{ type: "text" as const, text: content }],
  } as Awaited<ReturnType<typeof completeSimple>>);
}

describe("recognizeIntentAndMatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses single (intent, result) from LLM JSON object", async () => {
    mockCompleteReturns('{"intent": "send-file", "result": "use send-file skill"}');
    const out = await recognizeIntentAndMatch({
      query: "把文件发给我",
      habits: emptyHabits,
      config: emptyConfig,
      model: mockModel,
    });
    expect(out).toEqual([{ intent: "send-file", result: "use send-file skill" }]);
  });

  it("parses multiple (intent, result) from LLM JSON array", async () => {
    mockCompleteReturns(
      '[{"intent": "send-file", "result": "use send-file"}, {"intent": "reminder", "result": "add to calendar"}]',
    );
    const out = await recognizeIntentAndMatch({
      query: "发我文档，顺便提醒明天开会",
      habits: emptyHabits,
      config: emptyConfig,
      model: mockModel,
    });
    expect(out).toEqual([
      { intent: "send-file", result: "use send-file" },
      { intent: "reminder", result: "add to calendar" },
    ]);
  });

  it("returns empty array when LLM returns no valid JSON", async () => {
    mockCompleteReturns("No matching habit.");
    const out = await recognizeIntentAndMatch({
      query: "hello",
      habits: emptyHabits,
      config: emptyConfig,
      model: mockModel,
    });
    expect(out).toEqual([]);
  });

  it("returns empty array when LLM returns empty object or empty array", async () => {
    mockCompleteReturns("{}");
    expect(
      await recognizeIntentAndMatch({
        query: "hello",
        habits: emptyHabits,
        config: emptyConfig,
        model: mockModel,
      }),
    ).toEqual([]);
    mockCompleteReturns("[]");
    expect(
      await recognizeIntentAndMatch({
        query: "hello",
        habits: emptyHabits,
        config: emptyConfig,
        model: mockModel,
      }),
    ).toEqual([]);
  });

  it("extracts JSON from response with surrounding text", async () => {
    mockCompleteReturns(
      'Here is the result:\n{"intent": "reminder", "result": "add to calendar"}\nDone.',
    );
    const out = await recognizeIntentAndMatch({
      query: "提醒我明天开会",
      habits: emptyHabits,
      config: emptyConfig,
      model: mockModel,
    });
    expect(out).toEqual([{ intent: "reminder", result: "add to calendar" }]);
  });

  it("deduplicates by intent when array has duplicate intents", async () => {
    mockCompleteReturns(
      '[{"intent": "send-file", "result": "first"}, {"intent": "send-file", "result": "second"}]',
    );
    const out = await recognizeIntentAndMatch({
      query: "发文件",
      habits: emptyHabits,
      config: emptyConfig,
      model: mockModel,
    });
    expect(out).toEqual([{ intent: "send-file", result: "first" }]);
  });

  it("extracts intent/result from reasoning text when no JSON (thinking-only model)", async () => {
    const reasoningText =
      '4. **映射到输出格式：**\n*   **意图**：用户想要影响的核心动作是 "发文件"。\n*   **结果**：用户指定了如何实现这一点："use send-file skill"。';
    vi.mocked(completeSimple).mockResolvedValue({
      content: [{ type: "thinking" as const, thinking: reasoningText }],
    } as Awaited<ReturnType<typeof completeSimple>>);
    const out = await recognizeIntentAndMatch({
      query: "以后发文件要用 send-file 这个技能",
      habits: emptyHabits,
      config: emptyConfig,
      model: mockModel,
    });
    expect(out).toEqual([{ intent: "发文件", result: "use send-file skill" }]);
  });

  it("passes habits list into the prompt", async () => {
    mockCompleteReturns('{"intent": "send-file", "result": "use send-file"}');
    const habits: HabitEntry[] = [
      { intent: "send-file", result: "use send-file", updatedAt: Date.now() },
    ];
    await recognizeIntentAndMatch({
      query: "发一下那个文档",
      habits,
      config: emptyConfig,
      model: mockModel,
    });
    const callArg = vi.mocked(completeSimple).mock.calls[0];
    expect(callArg).toBeDefined();
    const userContent =
      (callArg?.[1] as { messages: Array<{ content: string }> })?.messages?.[0]?.content ?? "";
    expect(userContent).toContain("send-file");
    expect(userContent).toContain("use send-file");
  });
});

/**
 * Stage 1 + 2: one LLM call to get (intent, result) from current query and existing habits.
 * Plan: 方案 A — LLM 一次完成. See user_habit_plan.md §3.
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { getApiKeyForModel, requireApiKey } from "../model-auth.js";
import type { HabitEntry } from "./types.js";

const log = createSubsystemLogger("habit");

export type RecognizeIntentResult = {
  intent: string;
  result: string;
};

const HABIT_RECOGNITION_TIMEOUT_MS = 12_000;
const HABIT_RECOGNITION_MAX_TOKENS = 10240;

/** 智谱 GLM（zai/glm-*）默认开启 thinking，习惯识别只需简短 JSON，关闭可避免只返回 reasoning 块。 */
function isZhipuGlm(model: Model<Api>): boolean {
  const p = (model as { provider?: string }).provider ?? "";
  const id = (model as { id?: string }).id ?? "";
  return p === "zai" || id.includes("glm");
}

function parseOneEntry(obj: unknown): RecognizeIntentResult | null {
  if (!obj || typeof obj !== "object") {
    return null;
  }
  const o = obj as Record<string, unknown>;
  const intent = typeof o.intent === "string" ? o.intent.trim() : undefined;
  const result = typeof o.result === "string" ? o.result.trim() : undefined;
  if (intent && result) {
    return { intent, result };
  }
  return null;
}

/** Parse LLM response: single object or array of { intent, result }. Returns deduplicated list by intent. */
function extractIntentResultsFromResponse(text: string): RecognizeIntentResult[] {
  const trimmed = text.trim();
  // Try array first: [...]
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const arr = JSON.parse(arrayMatch[0]) as unknown[];
      if (!Array.isArray(arr)) {
        return [];
      }
      const seen = new Set<string>();
      const out: RecognizeIntentResult[] = [];
      for (const item of arr) {
        const entry = parseOneEntry(item);
        if (entry && !seen.has(entry.intent)) {
          seen.add(entry.intent);
          out.push(entry);
        }
      }
      return out;
    } catch {
      // fall through to single-object parse
    }
  }
  // Single object: {...}
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]) as Record<string, unknown>;
      const entry = parseOneEntry(parsed);
      return entry ? [entry] : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Fallback: some models (e.g. reasoning/thinking) only return a thinking block with conclusions in natural language.
 * Try to extract intent/result from patterns like 意图... "发文件" and 结果... "use send-file skill".
 */
function extractFromReasoningText(text: string): RecognizeIntentResult[] {
  // Chinese: 意图... "x" / 结果... "y" (e.g. 意图：... "发文件" / 结果：... "use send-file skill")
  const intentCn = text.match(/意图[^"']*["']([^"']+)["']/);
  const resultCn = text.match(/结果[^"']*["']([^"']+)["']/);
  if (intentCn && resultCn) {
    const intent = intentCn[1].trim();
    const result = resultCn[1].trim();
    if (intent && result) {
      return [{ intent, result }];
    }
  }
  // English: intent... "x" / result... "y"
  const intentEn = text.match(/intent[^"']*["']([^"']+)["']/i);
  const resultEn = text.match(/result[^"']*["']([^"']+)["']/i);
  if (intentEn && resultEn) {
    const intent = intentEn[1].trim();
    const result = resultEn[1].trim();
    if (intent && result) {
      return [{ intent, result }];
    }
  }
  return [];
}

/**
 * One LLM call: from user query + existing habits, return zero or more (intent, result) pairs.
 * A single query may express multiple intents (e.g. "发我文档，顺便提醒开会"); we return an array.
 * If the user stated an explicit result for an intent, that is preferred; else use matched habit result.
 */
export async function recognizeIntentAndMatch(params: {
  query: string;
  habits: HabitEntry[];
  config: OpenClawConfig;
  model: Model<Api>;
  agentDir?: string;
  signal?: AbortSignal;
}): Promise<RecognizeIntentResult[]> {
  const { query, habits, config, model, agentDir, signal } = params;
  const apiKeyInfo = await getApiKeyForModel({
    model,
    cfg: config,
    agentDir,
  });
  const apiKey = requireApiKey(apiKeyInfo, model.provider);

  const habitsText =
    habits.length === 0
      ? "No existing habits."
      : habits.map((h) => `- intent: "${h.intent}" → result: "${h.result}"`).join("\n");

  const userContent =
    `You are a habit recognizer. Output a JSON array of objects with "intent" and "result". ` +
    `"intent" = the user's goal in natural language (e.g. 发文件, 提醒, 查日历). Use the user's wording or a short phrase for what they want, NOT skill names or English IDs. ` +
    `"result" = how to fulfill it (e.g. use send-file skill, add to calendar). ` +
    `Example: for "以后发文件要用 send-file 这个技能" output [{"intent": "发文件", "result": "use send-file skill"}]. ` +
    `If the query matches an existing habit's intent, use that habit's result unless the user said otherwise. Only if there is no habit-like instruction, reply with [].\n\n` +
    `Existing habits:\n${habitsText}\n\n` +
    `User query: ${query}\n\n` +
    `Reply with ONLY a JSON array: [{"intent": "...", "result": "..."}, ...] or []. No other text.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HABIT_RECOGNITION_TIMEOUT_MS);
  const effectiveSignal = signal ?? controller.signal;

  const completionOptions: Record<string, unknown> = {
    apiKey,
    maxTokens: HABIT_RECOGNITION_MAX_TOKENS,
    temperature: 0,
    signal: effectiveSignal,
  };
  // 智谱 GLM 默认开启 thinking，习惯识别只需直接 JSON，在此关闭。See docs.bigmodel.cn thinking-mode
  if (isZhipuGlm(model)) {
    completionOptions.thinking = { type: "disabled" };
  }

  try {
    const res = await completeSimple(
      model,
      {
        messages: [
          {
            role: "user",
            content: userContent,
            timestamp: Date.now(),
          },
        ],
      },
      completionOptions as Parameters<typeof completeSimple>[2],
    );

    const content = res.content ?? [];
    // Some models return only "thinking" blocks; take both "text" and "thinking". Thinking blocks may use .text, .content, or .thinking.
    const getBlockText = (b: unknown): string | null => {
      const o = b as Record<string, unknown>;
      const t = o.type;
      if (t !== "text" && t !== "thinking") {
        return null;
      }
      const s =
        typeof o.text === "string"
          ? o.text
          : typeof o.content === "string"
            ? o.content
            : typeof o.thinking === "string"
              ? o.thinking
              : null;
      return s ?? null;
    };
    const text = content
      .map(getBlockText)
      .filter((s): s is string => s != null && s.length > 0)
      .join("\n")
      .trim();

    let parsed = extractIntentResultsFromResponse(text);
    if (parsed.length === 0 && text.length > 0) {
      parsed = extractFromReasoningText(text);
      if (parsed.length > 0) {
        log.debug(
          `habit recognition: extracted from reasoning text (intent=${parsed[0].intent} result=${parsed[0].result})`,
        );
      } else {
        log.debug(
          `habit recognition: no valid intent/result parsed from above text (length=${text.length})`,
        );
      }
    } else if (parsed.length === 0 && text.length === 0) {
      const blockSummary =
        content.length === 0
          ? "0 blocks"
          : content.map((b) => (b as { type?: string }).type ?? "?").join(",");
      log.debug(`habit recognition: LLM returned empty text (content: ${blockSummary})`);
    }
    return parsed;
  } catch (err) {
    log.debug(`habit recognition: LLM call failed error=${String(err)}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

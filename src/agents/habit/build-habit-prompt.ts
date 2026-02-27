/**
 * Build Habit Prompt for injection into system prompt (order: System → Habit Prompt → messages).
 * Step 5: load habits → stage 1+2 (recognizeIntentAndMatch) → format (intent, result)[] into prompt string.
 * Step 6: when recognized non-empty, merge new entries into USER_HABITS.yaml (source: realtime).
 */

import path from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { RecognizeIntentResult } from "./recognize.js";
import { recognizeIntentAndMatch } from "./recognize.js";
import { loadHabits, writeHabits } from "./storage.js";
import type { HabitEntry } from "./types.js";

const DEFAULT_HABITS_FILENAME = "USER_HABITS.yaml";
const log = createSubsystemLogger("habit");

export type BuildHabitPromptParams = {
  prompt: string;
  workspaceDir: string;
  config: OpenClawConfig;
  /** When provided with agentDir, runs stage 1+2 (LLM) to get (intent, result) from query + habits. */
  model?: Model<Api>;
  agentDir?: string;
};

/** Match recognized intent to file entry by intent or alias (LLM may use different names across turns). */
function findExistingHabit(habits: HabitEntry[], recognizedIntent: string): HabitEntry | undefined {
  return habits.find((h) => h.intent === recognizedIntent || h.alias?.includes(recognizedIntent));
}

/**
 * Format recognized (intent, result) pairs into a short natural-language Habit Prompt block.
 */
export function formatHabitPromptBlock(entries: RecognizeIntentResult[]): string {
  if (entries.length === 0) {
    return "";
  }
  const lines = entries.map((e) => `当意图为「${e.intent}」时，请优先按以下方式执行：${e.result}`);
  return "用户习惯：\n" + lines.join("\n");
}

/**
 * Returns the Habit Prompt string to append to system prompt when habit.enabled is true.
 * Loads habits from file, optionally runs LLM recognition when model (and agentDir) are provided, then formats.
 */
export async function buildHabitPrompt(params: BuildHabitPromptParams): Promise<string> {
  const { prompt, workspaceDir, config, model, agentDir } = params;
  const habitCfg = config?.agents?.defaults?.habit;
  const filePath = habitCfg?.filePath
    ? path.resolve(workspaceDir, habitCfg.filePath)
    : path.join(workspaceDir, DEFAULT_HABITS_FILENAME);

  const habits = await loadHabits(filePath);
  log.debug(
    `habit file path=${filePath} loaded=${habits.length} entries model=${model != null ? "yes" : "no"}`,
  );

  let recognized: RecognizeIntentResult[];
  if (model != null) {
    recognized = await recognizeIntentAndMatch({
      query: prompt,
      habits,
      config,
      model,
      agentDir,
    });
    if (recognized.length === 0) {
      log.debug("habit recognition returned no intents (LLM empty or parse failed)");
    } else {
      log.debug(
        `habit recognized ${recognized.length} intent(s): ${recognized.map((r) => r.intent).join(", ")}`,
      );
    }
  } else {
    recognized = [];
  }

  // Step 6: persist only when something is new or changed. Match by intent or alias (LLM may use different names).
  if (recognized.length > 0) {
    const hasNewOrChanged = recognized.some((r) => {
      const existing = findExistingHabit(habits, r.intent);
      return !existing || existing.result !== r.result;
    });
    if (hasNewOrChanged) {
      const now = Date.now();
      const byIntent = new Map<string, HabitEntry>(habits.map((h) => [h.intent, h]));
      for (const r of recognized) {
        const existing = findExistingHabit(habits, r.intent);
        const canonicalIntent = existing?.intent ?? r.intent;
        byIntent.set(canonicalIntent, {
          intent: canonicalIntent,
          result: r.result,
          updatedAt: now,
          source: "realtime",
          alias: existing?.alias,
        });
      }
      const toWrite = [...byIntent.values()];
      log.debug(`habit writing ${toWrite.length} entries to ${filePath}`);
      await writeHabits(filePath, toWrite).catch((err) => {
        log.warn(`habit write failed path=${filePath} error=${String(err)}`);
      });
    } else {
      log.debug("habit skipping write (all recognized intents already in file with same result)");
    }
  }

  return formatHabitPromptBlock(recognized);
}

/**
 * Read/write USER_HABITS.yaml. Same intent multiple times: keep entry with max updatedAt.
 * See user_habit_plan.md §7.1.
 */

import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { HabitEntry, HabitEntryRaw } from "./types.js";

const HABITS_KEY = "habits";

function toUpdatedAtMs(value: number | string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function normalizeEntry(raw: HabitEntryRaw): HabitEntry {
  const source = raw.source;
  const sourceNorm = source === "realtime" || source === "nightly" ? source : undefined;
  return {
    intent: String(raw.intent ?? "").trim(),
    result: String(raw.result ?? "").trim(),
    updatedAt: toUpdatedAtMs(raw.updatedAt),
    source: sourceNorm,
    alias: Array.isArray(raw.alias)
      ? raw.alias.map((a) => String(a).trim()).filter(Boolean)
      : undefined,
  };
}

/**
 * Dedupe by intent: keep the entry with the largest updatedAt.
 */
function dedupeByIntent(entries: HabitEntry[]): HabitEntry[] {
  const byIntent = new Map<string, HabitEntry>();
  for (const e of entries) {
    if (!e.intent) {
      continue;
    }
    const existing = byIntent.get(e.intent);
    if (!existing || e.updatedAt > existing.updatedAt) {
      byIntent.set(e.intent, e);
    }
  }
  return [...byIntent.values()];
}

/**
 * Load habits from a YAML file. Returns [] if file is missing or invalid.
 * Same intent appearing multiple times: only the one with max updatedAt is kept.
 */
export async function loadHabits(filePath: string): Promise<HabitEntry[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return [];
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const rawList = (parsed as Record<string, unknown>)[HABITS_KEY];
  if (!Array.isArray(rawList)) {
    return [];
  }
  const entries: HabitEntry[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const raw = item as HabitEntryRaw;
    if (!raw.intent) {
      continue;
    }
    entries.push(normalizeEntry(raw));
  }
  return dedupeByIntent(entries);
}

/**
 * Write habits to a YAML file. Ensures directory exists. Dedupes by intent before write.
 */
export async function writeHabits(filePath: string, habits: HabitEntry[]): Promise<void> {
  const deduped = dedupeByIntent(habits);
  const obj = { [HABITS_KEY]: deduped };
  const yaml = YAML.stringify(obj, { lineWidth: 0 });
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, yaml, "utf-8");
}

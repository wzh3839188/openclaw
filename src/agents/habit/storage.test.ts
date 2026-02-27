import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadHabits, writeHabits } from "./storage.js";
import type { HabitEntry } from "./types.js";

describe("habit storage", () => {
  it("returns empty array when file is missing", async () => {
    const p = path.join(os.tmpdir(), "openclaw-habit-missing-" + Date.now(), "USER_HABITS.yaml");
    const habits = await loadHabits(p);
    expect(habits).toEqual([]);
  });

  it("returns empty array when file has no habits key", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-habit-"));
    const p = path.join(dir, "USER_HABITS.yaml");
    await fs.writeFile(p, "other: []\n", "utf-8");
    const habits = await loadHabits(p);
    expect(habits).toEqual([]);
  });

  it("parses valid YAML and returns habits", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-habit-"));
    const p = path.join(dir, "USER_HABITS.yaml");
    await fs.writeFile(
      p,
      `
habits:
  - intent: 发文件
    result: 使用 send-file 技能
    updatedAt: 1730000000000
    source: realtime
  - intent: 查日历
    result: 先查日历再回复
    updatedAt: 1729900000000
    source: nightly
`,
      "utf-8",
    );
    const habits = await loadHabits(p);
    expect(habits).toHaveLength(2);
    expect(habits.find((h) => h.intent === "发文件")).toMatchObject({
      intent: "发文件",
      result: "使用 send-file 技能",
      updatedAt: 1730000000000,
      source: "realtime",
    });
    expect(habits.find((h) => h.intent === "查日历")).toMatchObject({
      intent: "查日历",
      result: "先查日历再回复",
      updatedAt: 1729900000000,
      source: "nightly",
    });
  });

  it("keeps only the entry with max updatedAt when same intent appears multiple times", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-habit-"));
    const p = path.join(dir, "USER_HABITS.yaml");
    await fs.writeFile(
      p,
      `
habits:
  - intent: 发文件
    result: 旧结果
    updatedAt: 1729900000000
  - intent: 发文件
    result: 新结果
    updatedAt: 1730000000000
  - intent: 发文件
    result: 中间结果
    updatedAt: 1729950000000
`,
      "utf-8",
    );
    const habits = await loadHabits(p);
    expect(habits).toHaveLength(1);
    expect(habits[0]).toMatchObject({
      intent: "发文件",
      result: "新结果",
      updatedAt: 1730000000000,
    });
  });

  it("normalizes updatedAt from ISO8601 string", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-habit-"));
    const p = path.join(dir, "USER_HABITS.yaml");
    await fs.writeFile(
      p,
      'habits:\n  - intent: x\n    result: y\n    updatedAt: "2024-10-28T12:00:00.000Z"\n',
      "utf-8",
    );
    const habits = await loadHabits(p);
    expect(habits).toHaveLength(1);
    expect(habits[0].updatedAt).toBe(new Date("2024-10-28T12:00:00.000Z").getTime());
  });

  it("write then read roundtrips habits", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-habit-"));
    const p = path.join(dir, "USER_HABITS.yaml");
    const input: HabitEntry[] = [
      {
        intent: "发文件",
        result: "使用 send-file",
        updatedAt: 1730000000000,
        source: "realtime",
      },
      {
        intent: "查日历",
        result: "先查日历",
        updatedAt: 1729900000000,
        alias: ["old-calendar"],
      },
    ];
    await writeHabits(p, input);
    const read = await loadHabits(p);
    expect(read).toHaveLength(2);
    expect(read.find((h) => h.intent === "发文件")).toMatchObject(input[0]);
    expect(read.find((h) => h.intent === "查日历")).toMatchObject(input[1]);
  });

  it("writeHabits dedupes by intent before writing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-habit-"));
    const p = path.join(dir, "USER_HABITS.yaml");
    const input: HabitEntry[] = [
      { intent: "a", result: "old", updatedAt: 100 },
      { intent: "a", result: "new", updatedAt: 200 },
    ];
    await writeHabits(p, input);
    const read = await loadHabits(p);
    expect(read).toHaveLength(1);
    expect(read[0].result).toBe("new");
    expect(read[0].updatedAt).toBe(200);
  });
});

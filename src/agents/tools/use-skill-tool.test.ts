import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createUseSkillTool } from "./use-skill-tool.js";

/** use_skill: API-level tool to load a skill by name (e.g. send-file). */
describe("createUseSkillTool", () => {
  it("returns null when skills array is empty", () => {
    expect(createUseSkillTool({ skills: [] })).toBeNull();
  });

  it("returns a tool when skills are provided", () => {
    const tool = createUseSkillTool({
      skills: [
        {
          name: "send-file",
          description: "Send files to user",
          filePath: "/skills/send-file/SKILL.md",
        },
      ],
    });
    expect(tool).not.toBeNull();
    expect(tool).toMatchObject({ name: "use_skill", label: "Use Skill" });
    expect(tool!.description).toContain("send-file");
    expect(tool!.description).toContain("发给我看看");
  });

  it("execute returns skill content when skill_name matches", async () => {
    const dir = path.join(os.tmpdir(), `use-skill-test-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    const skillPath = path.join(dir, "SKILL.md");
    await fs.writeFile(skillPath, "# Send File\n\nUse when user says 发给我.", "utf-8");
    try {
      const tool = createUseSkillTool({
        skills: [{ name: "send-file", description: "Send files", filePath: skillPath }],
      });
      expect(tool).not.toBeNull();
      const result = await tool!.execute("call_1", { skill_name: "send-file" });
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toMatchObject({ type: "text" });
      expect((result.content[0] as { text: string }).text).toContain("# Send File");
      expect((result.content[0] as { text: string }).text).toContain("发给我");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("execute returns error for unknown skill_name", async () => {
    const tool = createUseSkillTool({
      skills: [{ name: "send-file", description: "Send files", filePath: "/x/SKILL.md" }],
    });
    expect(tool).not.toBeNull();
    const result = await tool!.execute("call_1", { skill_name: "unknown-skill" });
    expect(result.content).toHaveLength(1);
    expect((result.content[0] as { text: string }).text).toContain("Unknown skill");
    expect((result.content[0] as { text: string }).text).toContain("unknown-skill");
    expect((result.content[0] as { text: string }).text).toContain("send-file");
  });

  it("execute is case-insensitive for skill_name", async () => {
    const dir = path.join(os.tmpdir(), `use-skill-test-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    const skillPath = path.join(dir, "SKILL.md");
    await fs.writeFile(skillPath, "# Skill", "utf-8");
    try {
      const tool = createUseSkillTool({
        skills: [{ name: "Send-File", description: "Send", filePath: skillPath }],
      });
      const result = await tool!.execute("call_1", { skill_name: "send-file" });
      expect((result.content[0] as { text: string }).text).toContain("# Skill");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * Pattern for testing with a different skill: create a temp dir with SKILL.md,
   * pass UseSkillEntry[] with your skill name/description/filePath, then
   * execute with skill_name and assert on the returned content.
   */
  it("execute returns content for any skill (e.g. echo-skill)", async () => {
    const dir = path.join(os.tmpdir(), `use-skill-echo-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    const skillPath = path.join(dir, "SKILL.md");
    const skillBody = [
      "---",
      "name: echo-skill",
      "description: Echo back user message. Use when user says 'echo test' or '重复我说的话'.",
      "---",
      "",
      "# Echo Skill",
      "When invoked: repeat the user's last message and confirm.",
    ].join("\n");
    await fs.writeFile(skillPath, skillBody, "utf-8");
    try {
      const tool = createUseSkillTool({
        skills: [
          {
            name: "echo-skill",
            description: "Echo back user message",
            filePath: skillPath,
          },
        ],
      });
      expect(tool).not.toBeNull();
      expect(tool!.description).toContain("echo-skill");
      const result = await tool!.execute("call_1", { skill_name: "echo-skill" });
      expect(result.content).toHaveLength(1);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain("# Echo Skill");
      expect(text).toContain("repeat the user's last message");
      expect(text).toContain("echo-skill");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

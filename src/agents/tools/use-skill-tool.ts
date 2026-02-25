import fs from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";

/** Tool input: skill name as passed by the model (e.g. "send-file"). */
const UseSkillSchema = Type.Object({
  skill_name: Type.String({ description: "Name of the skill to load (e.g. send-file)" }),
});

/** One skill entry for the use_skill tool: name, short description, path to SKILL.md. */
export type UseSkillEntry = {
  name: string;
  description: string;
  filePath: string;
};

/**
 * Builds the use_skill tool when there are available skills. Exposed as an API-level
 * tool so the model can invoke a skill by name (e.g. use_skill("send-file")) instead
 * of scanning the system prompt and calling read(SKILL.md path). When the model calls
 * use_skill, we read the SKILL.md and return its content as the tool result; the model
 * then follows those instructions (e.g. use message tool to send a file).
 */
export function createUseSkillTool(options: { skills: UseSkillEntry[] }): AnyAgentTool | null {
  const { skills } = options;
  if (skills.length === 0) {
    return null;
  }

  // Normalize name -> filePath for lookup (case-insensitive).
  const nameToPath = new Map<string, string>();
  const descriptionParts: string[] = [];
  for (const s of skills) {
    nameToPath.set(s.name.toLowerCase().trim(), s.filePath);
    const desc = (s.description ?? s.name).trim().slice(0, 120);
    descriptionParts.push(`${s.name}: ${desc}`);
  }
  const availableList = descriptionParts.join("; ");

  return {
    label: "Use Skill",
    name: "use_skill",
    description: `Load a skill by name and get its instructions. Use when the user's request matches one of these skills. Available: ${availableList}. Call with skill_name (e.g. send-file for "发给我看看" / "send me the file").`,
    parameters: UseSkillSchema,
    execute: async (_toolCallId, params) => {
      const rawName = readStringParam(params, "skill_name", { required: true });
      const key = rawName.trim().toLowerCase();
      const filePath = nameToPath.get(key);
      if (!filePath) {
        const names = [...nameToPath.keys()].join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown skill: "${rawName}". Available: ${names}.`,
            },
          ],
          details: { error: "unknown_skill", available: [...nameToPath.keys()] },
        };
      }
      try {
        const content = await fs.readFile(filePath, "utf-8");
        return {
          content: [{ type: "text" as const, text: content }],
          details: { skill_name: rawName.trim() },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to read skill "${rawName}": ${message}`,
            },
          ],
          details: { error: "read_failed", skill_name: rawName.trim() },
        };
      }
    },
  };
}

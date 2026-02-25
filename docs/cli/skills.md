---
summary: "CLI reference for `openclaw skills` (list/info/check) and skill eligibility"
read_when:
  - You want to see which skills are available and ready to run
  - You want to debug missing binaries/env/config for skills
title: "skills"
---

# `openclaw skills`

Inspect skills (bundled + workspace + managed overrides) and see what’s eligible vs missing requirements.

Related:

- Skills system: [Skills](/tools/skills)
- Skills config: [Skills config](/tools/skills-config)
- ClawHub installs: [ClawHub](/tools/clawhub)

## Commands

```bash
openclaw skills list
openclaw skills list --eligible
openclaw skills info <name>
openclaw skills check
```

## Testing the use_skill flow (API-level skill tool)

To verify that the model correctly invokes a skill via `use_skill(skill_name)`:

### 1. Put a skill where the agent loads it

Skills are loaded from (in precedence order):

- Workspace: `<workspaceDir>/skills/<skill-name>/SKILL.md` or `<workspaceDir>/.agents/skills/<skill-name>/SKILL.md`
- Personal: `~/.agents/skills/<skill-name>/SKILL.md`

Create a minimal skill for testing, e.g. `~/.agents/skills/my-test-skill/SKILL.md`:

```markdown
---
name: my-test-skill
description: Use when the user says "run my test skill" or "测试技能".
---

# My Test Skill

When invoked: reply "Test skill ran." and list the current date.
```

### 2. Confirm the skill is visible

```bash
openclaw skills list --eligible
openclaw skills info my-test-skill
```

### 3. Run the agent and trigger the skill

Start the gateway (or use `pnpm openclaw agent` with the same workspace the gateway uses). Send a message that matches the skill description, e.g. "run my test skill" or "测试技能". In gateway logs you should see a tool call `use_skill` with `skill_name: "my-test-skill"` and the model following the skill instructions.

### 4. Unit tests with another skill

To test the tool logic with a different skill in code, follow the pattern in `src/agents/tools/use-skill-tool.test.ts`: create a temp dir, write a `SKILL.md`, pass `UseSkillEntry[]` with `name`, `description`, `filePath`, then call `tool.execute(..., { skill_name: "your-skill-name" })` and assert on the returned content. See the test "execute returns content for any skill (e.g. echo-skill)" for a full example.

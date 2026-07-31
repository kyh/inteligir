// ---------------------------------------------------------------------------
// Skill prompt budget. `~/.inteligir/skills` is user-writable and every skill
// in it costs prompt on EVERY turn, so the loader bounds the set. Three
// contracts pinned here:
//   1. The budget sheds DESCRIPTIONS, not skills — a skill the model knows by
//      name alone is still invocable, so every name survives right up to the
//      count backstop, and no skill ever leaves the listing silently.
//   2. Deterministic selection (never readdir order) and a notice per change.
//   3. Settings↔agent parity — the Settings listing and the agent's resource
//      loader are two independent call paths into pi, and they must apply the
//      SAME budget or Settings advertises more than the model ever saw.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC } from "@repo/bridge/ipc-registry";
import {
  applySkillBudget,
  MAX_SKILL_DESCRIPTION_CHARS,
  MAX_SKILLS,
  MAX_TOTAL_SKILL_DESCRIPTION_CHARS,
  MIN_GRANTED_DESCRIPTION_CHARS,
  skillBudgetNotices,
  type BudgetableSkill,
  type BudgetedSkill,
} from "../pi/skill-budget";
import { budgetSkills, budgetSkillsOverride, listSkills } from "../pi/skills";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-budget-"));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function skill(name: string, descriptionChars: number): BudgetableSkill {
  return {
    name,
    description: "d".repeat(descriptionChars),
    filePath: `/skills/${name}/SKILL.md`,
  };
}

/** `skill-01` … so lexicographic order is also numeric order. */
function numbered(count: number, descriptionChars: number): BudgetableSkill[] {
  return Array.from({ length: count }, (_, i) =>
    skill(`skill-${String(i + 1).padStart(3, "0")}`, descriptionChars),
  );
}

function seedSkillsDir(root: string, skills: readonly BudgetableSkill[]): void {
  for (const s of skills) {
    const dir = path.join(root, "skills", s.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: ${s.name}\ndescription: ${s.description}\n---\n\nbody\n`,
    );
  }
}

function promptChars<T extends BudgetableSkill>(entries: readonly BudgetedSkill<T>[]): number {
  return entries
    .filter((entry) => entry.budget.kind !== "not-loaded")
    .reduce((sum, entry) => sum + entry.skill.description.length, 0);
}

describe("applySkillBudget", () => {
  it("passes an under-budget set through untouched", () => {
    const skills = numbered(3, 100);
    const { skills: kept, entries } = applySkillBudget(skills);
    expect(kept).toEqual(skills);
    expect(entries.map((entry) => entry.budget)).toEqual([
      { kind: "loaded" },
      { kind: "loaded" },
      { kind: "loaded" },
    ]);
  });

  it("selects by name, not by the order the caller enumerated", () => {
    const skills = numbered(MAX_SKILLS + 5, 10);
    const shuffled = skills.toReversed();
    expect(applySkillBudget(shuffled).skills.map((s) => s.name)).toEqual(
      applySkillBudget(skills).skills.map((s) => s.name),
    );
  });

  it("returns every input skill, however far over budget the set is", () => {
    const skills = numbered(MAX_SKILLS + 12, MAX_SKILL_DESCRIPTION_CHARS);
    const { entries } = applySkillBudget(skills);
    expect(entries.map((entry) => entry.skill.name)).toEqual(skills.map((s) => s.name));
  });

  it("sheds description characters rather than skills when the total is blown", () => {
    // Every skill alone is under the per-skill cap; together they are 3x the
    // total budget. The old model dropped the tail; this one keeps all of them.
    const each = 1000;
    const count = Math.min(MAX_SKILLS, Math.floor((MAX_TOTAL_SKILL_DESCRIPTION_CHARS * 3) / each));
    const { skills: kept, entries } = applySkillBudget(numbered(count, each));

    expect(kept).toHaveLength(count);
    expect(entries.every((entry) => entry.budget.kind === "description-trimmed")).toBe(true);
    expect(promptChars(entries)).toBeLessThanOrEqual(MAX_TOTAL_SKILL_DESCRIPTION_CHARS);
  });

  it("never shrinks a description below the guaranteed fair share", () => {
    const { entries } = applySkillBudget(numbered(MAX_SKILLS, MAX_SKILL_DESCRIPTION_CHARS));
    for (const entry of entries) {
      expect(entry.skill.description.length).toBeGreaterThanOrEqual(MIN_GRANTED_DESCRIPTION_CHARS);
    }
  });

  it("leaves a short description whole and clips only its verbose neighbours", () => {
    const small = skill("zz-small", 40);
    const { entries } = applySkillBudget([
      ...numbered(MAX_SKILLS - 1, MAX_SKILL_DESCRIPTION_CHARS),
      small,
    ]);
    const smallEntry = entries.find((entry) => entry.skill.name === "zz-small");

    expect(smallEntry?.skill.description).toBe(small.description);
    expect(smallEntry?.budget).toEqual({ kind: "loaded" });
    expect(entries.filter((entry) => entry.budget.kind === "description-trimmed")).toHaveLength(
      MAX_SKILLS - 1,
    );
  });

  it("caps the skill count as a backstop and still reports the overflow", () => {
    const over = 7;
    const { skills: kept, entries } = applySkillBudget(numbered(MAX_SKILLS + over, 10));
    const notLoaded = entries.filter((entry) => entry.budget.kind === "not-loaded");

    expect(kept).toHaveLength(MAX_SKILLS);
    expect(kept.map((s) => s.name)).toEqual(numbered(MAX_SKILLS, 10).map((s) => s.name));
    expect(notLoaded).toHaveLength(over);
    expect(notLoaded.map((entry) => entry.budget)).toEqual(
      Array.from({ length: over }, () => ({ kind: "not-loaded", reason: "skill-count" })),
    );
  });

  it("truncates an over-long description instead of dropping the skill", () => {
    const original = skill("verbose", MAX_SKILL_DESCRIPTION_CHARS * 2);
    const { skills: kept, entries } = applySkillBudget([original]);

    expect(kept[0]?.name).toBe("verbose");
    expect(kept[0]?.description).toHaveLength(MAX_SKILL_DESCRIPTION_CHARS);
    expect(kept[0]?.description.endsWith("…")).toBe(true);
    expect(entries[0]?.budget).toEqual({
      kind: "description-trimmed",
      promptChars: MAX_SKILL_DESCRIPTION_CHARS,
      originalChars: MAX_SKILL_DESCRIPTION_CHARS * 2,
    });
    expect(original.description).toHaveLength(MAX_SKILL_DESCRIPTION_CHARS * 2);
  });

  it("clamps the description of a skill the count ceiling excluded too", () => {
    const entries = applySkillBudget([
      ...numbered(MAX_SKILLS, 10),
      skill("zz-overflow", MAX_SKILL_DESCRIPTION_CHARS * 2),
    ]).entries;
    const overflow = entries.at(-1);

    expect(overflow?.budget).toEqual({ kind: "not-loaded", reason: "skill-count" });
    expect(overflow?.skill.description).toHaveLength(MAX_SKILL_DESCRIPTION_CHARS);
  });

  it("reports every shortening and exclusion as a notice carrying the skill's path", () => {
    const { entries } = applySkillBudget([
      ...numbered(MAX_SKILLS + 1, 10),
      skill("zz", MAX_SKILL_DESCRIPTION_CHARS * 2),
    ]);
    const notices = skillBudgetNotices(entries);

    expect(notices.length).toBe(entries.filter((e) => e.budget.kind !== "loaded").length);
    for (const notice of notices) expect(notice.path).toMatch(/SKILL\.md$/);
  });

  it("emits no notices when everything fits", () => {
    expect(skillBudgetNotices(applySkillBudget(numbered(2, 50)).entries)).toEqual([]);
  });
});

describe("Settings ↔ agent parity", () => {
  it("the Settings listing returns exactly the budgeted set", () => {
    const agentDir = makeTmpDir();
    const cwd = makeTmpDir();
    const onDisk = numbered(MAX_SKILLS + 6, 20);
    seedSkillsDir(agentDir, onDisk);

    const listed = listSkills({ cwd, agentDir, bundledSkillsDir: path.join(cwd, "resources") });
    const budgeted = applySkillBudget(onDisk);

    expect(listed.map((s) => s.name)).toEqual(budgeted.entries.map((e) => e.skill.name));
    expect(listed.map((s) => s.budget)).toEqual(budgeted.entries.map((e) => e.budget));
  });

  it("the agent's resource-loader override applies the same budget", () => {
    const onDisk = numbered(MAX_SKILLS + 6, 20);
    const loaded = onDisk.map((s) => ({
      ...s,
      baseDir: path.dirname(s.filePath),
      sourceInfo: {
        path: s.filePath,
        source: "local",
        scope: "user" as const,
        origin: "top-level" as const,
      },
      disableModelInvocation: false,
    }));
    const base = { skills: loaded, diagnostics: [{ type: "warning" as const, message: "pre" }] };

    const result = budgetSkillsOverride(base);
    expect(result.skills.map((s) => s.name)).toEqual(
      applySkillBudget(onDisk).skills.map((s) => s.name),
    );
    expect(result.diagnostics[0]).toEqual({ type: "warning", message: "pre" });
    expect(result.diagnostics.length).toBeGreaterThan(1);
  });

  it("logs every exclusion so a missing skill leaves a trace in agent.log", () => {
    const warn = vi.mocked(console.warn);
    budgetSkills(numbered(MAX_SKILLS + 2, 10));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toContain("not available to the agent");
  });

  it("keeps the agent's session loader wired to the shared budget seam", () => {
    // Behavioural tests cover both budget functions; only the WIRING can
    // regress silently — an edit dropping `skillsOverride` would leave the
    // Settings list bounded and the agent's prompt unbounded.
    const source = fs.readFileSync(path.join(REPO_ROOT, "packages/agent/src/pi/agent.ts"), "utf8");
    expect(source).toContain("skillsOverride: budgetSkillsOverride");
  });
});

describe("listSkills projection", () => {
  it("labels a seeded copy of a shipped skill as bundled and everything else as added", () => {
    const agentDir = makeTmpDir();
    const cwd = makeTmpDir();
    const resources = makeTmpDir();

    seedSkillsDir(agentDir, [skill("shipped", 30), skill("mine", 30)]);
    // The app's shipped set — folder names only; seeding COPIES them, so the
    // seeded file's own path can never say where it came from.
    fs.mkdirSync(path.join(resources, "skills", "shipped"), { recursive: true });

    const bySource = new Map(
      listSkills({ cwd, agentDir, bundledSkillsDir: path.join(resources, "skills") }).map((s) => [
        s.name,
        s.source,
      ]),
    );
    expect(bySource.get("shipped")).toBe("bundled");
    expect(bySource.get("mine")).toBe("added");
  });

  it("carries the SKILL.md mtime as epoch milliseconds", () => {
    const agentDir = makeTmpDir();
    const cwd = makeTmpDir();
    seedSkillsDir(agentDir, [skill("dated", 30)]);
    const filePath = path.join(agentDir, "skills", "dated", "SKILL.md");
    const mtime = new Date("2026-07-24T10:00:00.000Z");
    fs.utimesSync(filePath, mtime, mtime);

    const listed = listSkills({ cwd, agentDir, bundledSkillsDir: path.join(cwd, "resources") });
    expect(listed[0]?.updatedAt).toBe(mtime.getTime());
  });
});

describe("createSkill wire schema", () => {
  it("caps a submitted description at the same limit the budget clamps to", () => {
    // @repo/bridge cannot import @repo/agent, so the wire schema restates the
    // cap as a literal. Accepting a longer one would write a description the
    // very next listing clips back out.
    expect(IPC.createSkill.payload.properties.description.maxLength).toBe(
      MAX_SKILL_DESCRIPTION_CHARS,
    );
  });
});

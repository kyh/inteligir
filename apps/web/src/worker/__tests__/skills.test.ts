// ---------------------------------------------------------------------------
// Skills over the vault: the slug that never reaches a path, the listing's
// prompt budget, and the fact that a skill is REACHABLE — its listing lands in
// the instructions the agent's session is built with.
// ---------------------------------------------------------------------------

import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { composeInstructions } from "../agent/agent-instructions";
import { userHostName } from "../host/host-address";
import { listVaultSkills, renderSkillFile, skillPath, toSkillSlug } from "../skills/vault-skills";
import { authenticated, invoke, signUp } from "./host-helpers";

describe("the skill slug", () => {
  it("folds a display name into a folder name", () => {
    expect(toSkillSlug("Weekly Review")).toBe("weekly-review");
    expect(toSkillSlug("  Trip   planning!  ")).toBe("trip-planning");
  });

  it("cannot express a separator or a traversal, whatever is typed", () => {
    // The name never reaches a path — a slug derived through a character class
    // that has no separator in it does.
    expect(toSkillSlug("../../etc/passwd")).toBe("etc-passwd");
    expect(toSkillSlug("a/b\\c")).toBe("a-b-c");
    expect(toSkillSlug("..")).toBeNull();
    expect(toSkillSlug("   ")).toBeNull();
    expect(toSkillSlug("///")).toBeNull();
  });
});

describe("the SKILL.md renderer", () => {
  it("quotes frontmatter so a description cannot rewrite it", () => {
    const rendered = renderSkillFile("x", 'has: a colon\nand: a newline\nand "quotes"', "body");
    expect(rendered).toContain('description: "has: a colon\\nand: a newline\\nand \\"quotes\\""');
    // The frontmatter is still exactly two fields between two fences.
    expect(rendered.split("---")).toHaveLength(3);
  });

  it("scaffolds a placeholder body when none is given", () => {
    expect(renderSkillFile("weekly-review", "d", "")).toContain("# weekly-review");
  });
});

describe("createSkill", () => {
  it("writes one skill and lists it back", async () => {
    const account = await signUp("skills-create@example.com");
    const { ws, frames } = await authenticated(account);

    const created = await invoke(ws, frames, 1, "createSkill", {
      name: "Weekly Review",
      description: "Summarize the week from the journal notes.",
      instructions: "Read journal/ for the last seven days and write a summary.",
    });
    expect(created.ok).toBe(true);
    expect(created.ok && created.result).toMatchObject({
      skill: {
        name: "weekly-review",
        filePath: "skills/weekly-review/SKILL.md",
        scope: "user",
        source: "added",
        budget: { kind: "loaded" },
      },
    });

    // It is a vault file like any other, which is the whole point of the store
    // choice: the user can open and edit it in the editor they already have.
    const read = await invoke(ws, frames, 2, "readVaultFile", {
      path: "skills/weekly-review/SKILL.md",
    });
    expect(read.ok && String(read.result)).toContain("Read journal/ for the last seven days");
    ws.close();
  });

  it("never overwrites an existing skill", async () => {
    const account = await signUp("skills-clash@example.com");
    const { ws, frames } = await authenticated(account);
    const payload = { name: "Notes", description: "d", instructions: "i" };
    expect((await invoke(ws, frames, 1, "createSkill", payload)).ok).toBe(true);
    const second = await invoke(ws, frames, 2, "createSkill", payload);
    expect(second.ok).toBe(false);
    expect(second.ok ? "" : second.error).toMatch(/already exists/);
    ws.close();
  });

  it("refuses a name with nothing to make a folder from", async () => {
    const account = await signUp("skills-badname@example.com");
    const { ws, frames } = await authenticated(account);
    const result = await invoke(ws, frames, 1, "createSkill", {
      name: "...",
      description: "d",
      instructions: "i",
    });
    expect(result.ok).toBe(false);
    ws.close();
  });
});

describe("the listing", () => {
  it("clamps a description to its share of the prompt budget", async () => {
    const stub = env.UserHost.getByName(userHostName("skills-budget"));
    await runInDurableObject(stub, async (host) => {
      const verbose = "x".repeat(4_000);
      await host.vault.writeText(skillPath("verbose"), renderSkillFile("verbose", verbose, "body"));
      await host.vault.writeText(skillPath("terse"), renderSkillFile("terse", "short", "body"));

      const skills = await listVaultSkills(host.vault);
      expect(skills.map((skill) => skill.name)).toEqual(["terse", "verbose"]);
      // Short descriptions survive intact; only the longest is cut.
      expect(skills[0]?.budget).toEqual({ kind: "loaded" });
      expect(skills[1]?.budget).toMatchObject({
        kind: "description-trimmed",
        originalChars: 4_000,
      });
      expect(skills[1]?.description.length).toBeLessThan(4_000);
      expect(skills[1]?.description.endsWith("…")).toBe(true);
    });
  });

  it("ignores anything under skills/ that is not a SKILL.md", async () => {
    const stub = env.UserHost.getByName(userHostName("skills-strays"));
    await runInDurableObject(stub, async (host) => {
      await host.vault.writeText("skills/README.md", "not a skill");
      await host.vault.writeText("skills/real/SKILL.md", renderSkillFile("real", "d", "b"));
      await host.vault.writeText("skills/real/notes.md", "an attachment");
      await host.vault.writeText("skills/Bad Slug/SKILL.md", renderSkillFile("x", "d", "b"));

      const skills = await listVaultSkills(host.vault);
      expect(skills.map((skill) => skill.name)).toEqual(["real"]);
    });
  });
});

describe("the agent's instructions", () => {
  it("carry the skill listing, with the path the agent reads it from", async () => {
    const stub = env.UserHost.getByName(userHostName("skills-prompt"));
    await runInDurableObject(stub, async (host) => {
      await host.vault.writeText(
        skillPath("weekly-review"),
        renderSkillFile("weekly-review", "Summarize the week.", "steps"),
      );
      const instructions = await composeInstructions(host.vault);
      expect(instructions).toContain("## Skills");
      // The PATH is the capability: nothing materializes these into pi's own
      // skills directory, so the agent opens the file with its `read` tool.
      expect(instructions).toContain("`./vault/skills/weekly-review/SKILL.md`");
      expect(instructions).toContain("Summarize the week.");
    });
  });

  it("says nothing about skills when there are none", async () => {
    const stub = env.UserHost.getByName(userHostName("skills-empty"));
    await runInDurableObject(stub, async (host) => {
      expect(await composeInstructions(host.vault)).not.toContain("## Skills");
    });
  });
});

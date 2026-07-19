// ---------------------------------------------------------------------------
// KnowledgePort.rename — the capability behind the agent's rename_note tool.
// Drives buildAgentKnowledgePort over a REAL VaultManager (same scaffolding
// as rename-rewrite.test.ts) and pins that the agent's rename takes the SAME
// pipeline as the user-facing renameVaultEntry handler: destination-basename
// note-name gate, snapshot-verified vault-wide link rewrite, old-title alias
// recording — plus the port's own live-disk privacy re-probe on the source
// (the tool gate's unknown-tool arg screen is index-lagged; this closes it).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { notePrivacy } from "@repo/domain/markdown/frontmatter";

import { buildAgentKnowledgePort } from "../boot/agent-knowledge-port";
import { VaultManager } from "../vault/vault";
import type { KnowledgePort, PrivacyProbe } from "@repo/agent/extension";

let tmp: string;
let root: string;
let vault: VaultManager;
let port: KnowledgePort;
let afterRenameCalls: Array<[string, string]>;

/** Mirror of agent-wiring's probeVaultPrivacy over the test vault: live
 * disk read, any failure short of a real verdict reads "absent" (none of
 * these tests hinge on the absent/indeterminate error split). */
const probe = (rel: string): PrivacyProbe => {
  try {
    return notePrivacy(vault.readText(rel));
  } catch {
    return "absent";
  }
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-rename-port-test-"));
  root = path.join(tmp, "vault");
  vault = new VaultManager({
    settingsPath: path.join(tmp, "settings.json"),
    defaultRoot: root,
    manageAgentLink: false,
  });
  vault.ensureReady();
  afterRenameCalls = [];
  port = buildAgentKnowledgePort({
    // rename never touches the queries; give it an inert set.
    queries: () => ({ search: () => [], backlinks: () => [], notesWithTag: () => [] }),
    probe,
    vault: () => vault,
    afterRename: (from, to) => afterRenameCalls.push([from, to]),
  });
});

afterEach(() => {
  vault.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("KnowledgePort.rename — link rewrite + alias, user-rename parity", () => {
  it("rewrites inbound links, records the old-title alias, and reports the count", () => {
    vault.writeText("a.md", "See [[B]].\n");
    vault.writeText("B.md", "# B\n");

    expect(port.rename("B.md", "C.md")).toEqual({
      ok: true,
      from: "B.md",
      to: "C.md",
      linksRewritten: 1,
    });
    expect(fs.existsSync(path.join(root, "B.md"))).toBe(false);
    expect(vault.readText("a.md")).toBe("See [[C]].\n");
    expect(vault.readText("C.md")).toBe("---\naliases:\n  - B\n---\n# B\n");
  });

  it("moves across directories — the name gate is basename-only, like the handler", () => {
    vault.writeText("a.md", "See [[B]].\n");
    vault.writeText("B.md", "# B\n");

    // Wiki links are location-independent, so a dir-only move rewrites
    // nothing and records no alias (the stem didn't change).
    expect(port.rename("B.md", "sub/B.md")).toEqual({
      ok: true,
      from: "B.md",
      to: "sub/B.md",
      linksRewritten: 0,
    });
    expect(vault.readText("sub/B.md")).toBe("# B\n");
    expect(vault.readText("a.md")).toBe("See [[B]].\n");
  });

  it.each([["con.md"], ["bad:name.md"], ["sub/nul.md"]])(
    "refuses an invalid destination name (%s) and changes nothing",
    (to) => {
      vault.writeText("B.md", "# B\n");
      const result = port.rename("B.md", to);
      expect(result.ok).toBe(false);
      expect(vault.readText("B.md")).toBe("# B\n");
    },
  );

  it("refuses an occupied destination (renameWithLinkRewrite's own refusal)", () => {
    vault.writeText("B.md", "# B\n");
    vault.writeText("taken.md", "occupied\n");

    expect(port.rename("B.md", "taken.md")).toEqual({
      ok: false,
      reason: "taken.md already exists",
    });
    expect(vault.readText("B.md")).toBe("# B\n");
    expect(vault.readText("taken.md")).toBe("occupied\n");
  });

  it("refuses a missing source with the honest not-found reason", () => {
    expect(port.rename("ghost.md", "new.md")).toEqual({
      ok: false,
      reason: "Not found: ghost.md",
    });
  });

  it("runs the metadata remap on success, and NOT on any refusal", () => {
    vault.writeText("B.md", "# B\n");
    // Success → the delegation/checkpoint remap fires with the exact paths.
    expect(port.rename("B.md", "C.md").ok).toBe(true);
    expect(afterRenameCalls).toEqual([["B.md", "C.md"]]);

    // Every refusal path leaves the remap untouched (no stale repoint).
    afterRenameCalls = [];
    port.rename("ghost.md", "new.md"); // missing source
    port.rename("C.md", "con.md"); // invalid name
    // The live probe reads this file's frontmatter → private → refused.
    vault.writeText("secret.md", "---\nprivate: true\n---\n");
    port.rename("secret.md", "x.md"); // private
    expect(afterRenameCalls).toEqual([]);
  });
});

describe("KnowledgePort.rename — live privacy re-probe (index-lag closer)", () => {
  it("refuses to rename a private note; the reason names the path, never content", () => {
    const secret = "---\nprivate: true\n---\n# Umbrella\n\nTOP-SECRET body\n";
    vault.writeText("secret.md", secret);

    const result = port.rename("secret.md", "renamed.md");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("secret.md");
      expect(result.reason).toContain("private");
      expect(result.reason).not.toContain("TOP-SECRET");
      expect(result.reason).not.toContain("Umbrella");
    }
    expect(vault.readText("secret.md")).toBe(secret);
    expect(fs.existsSync(path.join(root, "renamed.md"))).toBe(false);
  });

  it("refuses an unreadable-frontmatter source — fail-closed, like the file tools", () => {
    // The same proven-indeterminate frontmatter knowledge-privacy.test.ts pins.
    const invalid = "---\n[not: valid: yaml\n---\nbody\n";
    vault.writeText("weird.md", invalid);

    const result = port.rename("weird.md", "renamed.md");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("fail-closed");
    expect(vault.readText("weird.md")).toBe(invalid);
  });
});

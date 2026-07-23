// ---------------------------------------------------------------------------
// User-authored agent instructions — host side of the vault/AGENTS.md loop.
//
// Two responsibilities:
//   - loadUserAgentInstructions(): read vault/AGENTS.md at session start and
//     hand it to the Agent as an extra context file (chat + delegation only —
//     app-machine.ts / background-agent.ts inject it; the editor-AI and
//     ghost-text sessions never get it). Absent file = null = no-op.
//   - seedUserAgentInstructions(): write the friendly skeleton into a vault
//     that has never had one, exactly once per vault root. A durable
//     seeded-roots mark (versioned JsonStore, ~/.inteligir) makes deletion
//     stick — a user who removes the file is never re-seeded.
//
// vault/AGENTS.md is a REGULAR vault file, not a private note — no privacy
// special-casing. The one privacy touch here goes the other way: a user who
// marks it `private: true` has opted it out of every AI surface, so the
// loader honors the same fail-closed contract as the rest of the app
// (docs/privacy.md) and skips it.
// ---------------------------------------------------------------------------

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  AGENT_INSTRUCTIONS_AGENT_PATH,
  AGENT_INSTRUCTIONS_PATH,
  AGENT_INSTRUCTIONS_SKELETON,
} from "@repo/bridge/agent-instructions";
import type { AgentsFileEntry } from "@repo/agent/agent";
import { notePrivacy } from "@repo/notes/markdown/frontmatter";
import { isEnoent } from "@repo/storage/fs-errors";
import { JsonStore, inteligirPath } from "@repo/storage/json-store";
import { getVaultManager } from "@repo/vault/vault";

// ---- Loader ----------------------------------------------------------------

/** Minimal vault surface the pure functions need (tests inject a fake). */
export type InstructionsVault = {
  root: () => string;
  /** Read a vault-relative text file. Throws (ENOENT included) on failure. */
  readText: (rel: string) => string;
  /** Write a vault-relative text file. Throws when the vault is unwritable. */
  writeText: (rel: string, content: string) => void;
};

function liveVault(): InstructionsVault {
  const vault = getVaultManager();
  return {
    root: () => vault.getRoot(),
    readText: (rel) => vault.readText(rel),
    writeText: (rel, content) => vault.writeText(rel, content),
  };
}

/**
 * Read the user's vault/AGENTS.md as a pi context file. `null` — the no-op —
 * when the file is absent, unreadable, or the user marked it `private: true`
 * (unparseable frontmatter counts as private, fail-closed — the same
 * contract every other AI surface honors). The `path` label is the
 * `./vault/AGENTS.md` form the agent's own file tools use, so the write-back
 * nudge in the bundled prompt points at exactly what the model sees loaded.
 */
export function loadInstructionsFrom(vault: InstructionsVault): AgentsFileEntry | null {
  let content: string;
  try {
    content = vault.readText(AGENT_INSTRUCTIONS_PATH);
  } catch {
    return null;
  }
  if (notePrivacy(content) !== "public") return null;
  return { path: AGENT_INSTRUCTIONS_AGENT_PATH, content };
}

/** Live-singleton binding used by app-machine.ts and background-agent.ts. */
export function loadUserAgentInstructions(): AgentsFileEntry | null {
  try {
    return loadInstructionsFrom(liveVault());
  } catch {
    // No vault manager yet (early boot) — same no-op as an absent file.
    return null;
  }
}

// ---- Seed marks store ------------------------------------------------------

const SEED_MARKS_VERSION = 1;

const SeedMarksFileSchema = Type.Object(
  {
    version: Type.Literal(SEED_MARKS_VERSION),
    /** Absolute vault roots that have been seeded once. */
    seededRoots: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
type SeedMarksFile = Static<typeof SeedMarksFileSchema>;

/** Once-per-vault seed marks. Kept OUT of the vault (it would sync) and out
 * of ui-state (that store is cosmetic/re-creatable by contract); losing it in
 * an app-data wipe merely allows one more seed-if-absent pass — harmless. */
export type SeedMarks = {
  has: (root: string) => boolean;
  add: (root: string) => void;
};

function jsonStoreMarks(storePath: string): { marks: SeedMarks; close: () => void } {
  const store = new JsonStore<string[]>(storePath, SeedMarksFileSchema, [], {
    versioning: { current: SEED_MARKS_VERSION },
    decode: (raw) => {
      if (!Value.Check(SeedMarksFileSchema, raw)) throw new Error("seed-marks shape rejected");
      return raw.seededRoots;
    },
    encode: (seededRoots): SeedMarksFile => ({ version: SEED_MARKS_VERSION, seededRoots }),
  });
  return {
    marks: {
      has: (root) => store.read().includes(root),
      add: (root) =>
        void store.update((roots) => (roots.includes(root) ? roots : [...roots, root])),
    },
    close: () => store.close(),
  };
}

let liveMarks: { marks: SeedMarks; close: () => void } | null = null;

function getSeedMarks(): SeedMarks {
  if (!liveMarks) liveMarks = jsonStoreMarks(inteligirPath("agent-instructions.json"));
  return liveMarks.marks;
}

/** Logout teardown: close the store (one-way kill switch on writes, the
 * ui-state precedent) and drop the singleton so a warm JsonStore cache can't
 * resurrect agent-instructions.json after the AGENT_DIR rm (see
 * teardown-completeness.test.ts). */
export function resetAgentInstructionsSeedMarks(): void {
  if (liveMarks) liveMarks.close();
  liveMarks = null;
}

// ---- Seed ------------------------------------------------------------------

/**
 * Seed the skeleton into a vault that has never had an AGENTS.md — once per
 * vault root, never clobbering. An existing file (user-authored before we
 * ever looked) is marked seeded and left byte-untouched; a file the user
 * deleted after seeding stays deleted. Failures are non-fatal: seeding is a
 * convenience, never worth blocking agent start over.
 */
export function seedInstructionsInto(vault: InstructionsVault, marks: SeedMarks): void {
  const root = vault.root();
  if (marks.has(root)) return;
  try {
    vault.readText(AGENT_INSTRUCTIONS_PATH);
    // Exists already — the user beat us to it. Mark so we never write here.
    marks.add(root);
    return;
  } catch (err) {
    if (!isEnoent(err)) return; // unreadable ≠ absent — do not write blind
  }
  vault.writeText(AGENT_INSTRUCTIONS_PATH, AGENT_INSTRUCTIONS_SKELETON);
  marks.add(root);
}

/** Live binding — called at chat-agent start and after a vault-root switch.
 * Swallows everything: a failed seed (vault suspended, disk trouble) must
 * never block the agent or the vault switch. */
export function seedUserAgentInstructions(): void {
  try {
    seedInstructionsInto(liveVault(), getSeedMarks());
  } catch (err) {
    console.warn("[agent-instructions] seed skipped:", err);
  }
}

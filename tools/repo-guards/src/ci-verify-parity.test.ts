// ---------------------------------------------------------------------------
// `pnpm verify` against what CI actually runs.
//
// The stated reason this repo has a `verify` script at all is that no caller
// can drift from CI. That claim is only true while somebody checks it, and
// nobody did: CI grew three e2e steps on top of the six, so a green `verify`
// stopped being a green CI and the script's own docstring stopped being true.
// A local green that is a CI red is the exact failure `verify` exists to
// prevent, and it is invisible from either side — the package.json does not
// know the workflow exists, and the workflow does not call the script.
//
// So both spellings are accepted, because both are honest answers:
//
//   CI CALLS `pnpm verify` — one source, nothing to compare.
//
//   CI RUNS THE CHAIN ITSELF, in verify's own order. That is what it does
//   today, and deliberately: six separate steps with `if: !cancelled()` report
//   every failure in one run, where verify's `&&` chain stops at the first.
//
// Either way, every REMAINING run step needs a row below saying what it is and
// why `verify` cannot carry it. The table is the documented extra set the
// docstring promises, and it drains — a row matching no step fails.
//
// The sweep is DERIVED, not a filename: a gate workflow is one triggered by
// `pull_request` or `push`, so a second gate joins this guard by existing.
// Workflows on other triggers (the deploy's `workflow_run`, the bot's
// `issue_comment`) are not gates and are not swept — stated here rather than
// implied, because that is a real edge of what this can see.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { REPO_ROOT, sourceOf, workspaces } from "./repo";

const WORKFLOW_DIR = ".github/workflows";
const ROOT_MANIFEST = "package.json";
const VERIFY_SCRIPT = "verify";
/** The triggers that make a workflow a GATE — the thing a green `verify` is
 *  claiming to predict. */
const GATE_TRIGGERS = ["pull_request", "push"];

/**
 * Every run step a gate workflow has that `verify` does not, and why it cannot
 * be in `verify`. Keyed `<workflow>:<step name>`, which is why a run step in a
 * gate workflow has to carry a name.
 */
const DECLARED_CI_EXTRAS = new Map<string, string>([
  [
    "ci.yml:Install",
    "provisioning, not a gate — `verify` runs against an installed tree and cannot install one for itself",
  ],
  [
    "ci.yml:E2E browser",
    "installs agent-browser and its system deps globally on the runner; a developer installs it once, so making `verify` do it on every run would be a minutes-long tax on the static gate",
  ],
  [
    "ci.yml:E2E (dev)",
    "boots real instances and drives them over the wire — `pnpm e2e` is deliberately outside `verify`'s test task (tools/e2e/package.json), because every unit passes while the composition fails",
  ],
  [
    "ci.yml:E2E (prod)",
    "the same suite against the BUILT shell under the real CSP; dev serves Vite's middleware and no policy, so a policy regression is invisible to the run above",
  ],
]);

/** The script name a workspace's smoke is spelled as. */
const SMOKE_SCRIPT = "smoke";
/** Root scripts that drive one — how a developer is meant to reach it. */
const ROOT_SMOKE_PREFIX = "smoke";

/**
 * Every root smoke `verify` and CI both leave alone, and why. A smoke is not a
 * unit test: it packs, installs, binds a port and boots a real artifact, so
 * being outside the static gate is the normal answer. Being outside CI is not,
 * and each row here has to say what stops it.
 *
 * The table drains: a row naming a script that no longer exists fails, and so
 * does one naming a script a gate workflow has since started running.
 */
const MANUAL_SMOKES = new Map<string, string>([
  [
    "smoke:package",
    "it packs the publishable tarball, installs it into a scratch prefix and binds a port — minutes of work per run to prove a thing that only changes when the artifact's shape does, and nothing about it is a PR-sized risk",
  ],
  [
    "smoke:desktop",
    "it drives a packaged macOS arm64 .app through that app's own Electron binary; the gate runs on ubuntu, where neither packaging it nor executing it is possible — running it means adding a macOS job, which is worth doing the day the shell is something users install",
  ],
]);

const scriptTableSchema = z.looseObject({ scripts: z.record(z.string(), z.unknown()) });

/** The root manifest's scripts. The `verify` chain and every step command are
 *  read against this, so neither side is retyped here. */
function rootScripts() {
  const parsed = scriptTableSchema.safeParse(JSON.parse(sourceOf(ROOT_MANIFEST)));
  if (!parsed.success) {
    throw new Error(`${ROOT_MANIFEST}: expected an object at "scripts"`);
  }
  const scripts: Record<string, string> = {};
  for (const [name, body] of Object.entries(parsed.data.scripts)) {
    const script = z.string().safeParse(body);
    if (!script.success) throw new Error(`${ROOT_MANIFEST}: scripts.${name} is not a string`);
    scripts[name] = script.data;
  }
  return scripts;
}

/** `verify`'s own `&&` chain, as the ordered script names it runs. A link that
 *  is not a plain `pnpm <script>` throws: this guard compares script names, so
 *  a shape it cannot name is one it cannot check. */
function verifyChain(scripts: Record<string, string>): string[] {
  const body = scripts[VERIFY_SCRIPT];
  if (body === undefined) {
    throw new Error(`${ROOT_MANIFEST}: no "${VERIFY_SCRIPT}" script to compare CI against`);
  }
  return body.split("&&").map((link) => {
    const name = /^\s*pnpm\s+([\w:-]+)\s*$/.exec(link)?.[1];
    if (name === undefined || scripts[name] === undefined) {
      throw new Error(
        `${ROOT_MANIFEST}: "${VERIFY_SCRIPT}" runs \`${link.trim()}\`, which is not a plain \`pnpm <script>\`.\n` +
          `  rule: this guard holds CI against verify by SCRIPT NAME; a link it cannot name is a link it cannot check\n` +
          `  fix: keep the chain to root scripts, or teach verifyChain() this shape`,
      );
    }
    return name;
  });
}

interface WorkflowStep {
  /** `<workflow>:<name>` — the key an exception is declared under. */
  id: string;
  workflow: string;
  name: string;
  run: string;
}

interface GateWorkflow {
  file: string;
  steps: WorkflowStep[];
}

/** A workflow's `on:` — a bare trigger, a list of them, or a mapping keyed by
 *  trigger. Every spelling reads out as the trigger names it declares; a shape
 *  outside the three declares none. */
const triggersSchema = z
  .union([
    z.string().transform((trigger) => [trigger]),
    z.array(z.unknown()).transform((entries) =>
      entries.flatMap((entry) => {
        const trigger = z.string().safeParse(entry);
        return trigger.success ? [trigger.data] : [];
      }),
    ),
    z.record(z.string(), z.unknown()).transform((mapping) => Object.keys(mapping)),
  ])
  .catch([]);

/** Only the two keys this guard reads; `on` absent is a workflow no trigger
 *  fires, which is not a gate. */
// `z.unknown()` is NOT implicitly optional in zod 4 — without `.optional()` an
// absent key fails the parse, which here would silently downgrade "this gate
// has no jobs" from a thrown error to a skipped workflow.
const workflowSchema = z
  .looseObject({ on: triggersSchema.optional(), jobs: z.unknown().optional() })
  .catch({});

const jobsSchema = z.record(z.string(), z.looseObject({ steps: z.array(z.unknown()).optional() }));

/** A step this guard reads: `run:` is what makes one, `name:` is what makes it
 *  declarable in DECLARED_CI_EXTRAS. */
const runStepSchema = z.looseObject({ run: z.string(), name: z.unknown().optional() });

/** Every workflow a `pull_request` or `push` fires: the gates. */
function gateWorkflows(): GateWorkflow[] {
  const dir = path.join(REPO_ROOT, WORKFLOW_DIR);
  const found: GateWorkflow[] = [];
  for (const entry of fs.readdirSync(dir).toSorted()) {
    if (!/\.ya?ml$/.test(entry)) continue;
    const workflow = workflowSchema.parse(
      parseYaml(fs.readFileSync(path.join(dir, entry), "utf8")),
    );
    if (!(workflow.on ?? []).some((trigger) => GATE_TRIGGERS.includes(trigger))) continue;
    const jobs = jobsSchema.safeParse(workflow.jobs);
    if (!jobs.success) throw new Error(`${WORKFLOW_DIR}/${entry}: expected an object at "jobs"`);
    const steps: WorkflowStep[] = [];
    for (const [jobName, job] of Object.entries(jobs.data)) {
      for (const jobStep of job.steps ?? []) {
        const step = runStepSchema.safeParse(jobStep);
        if (!step.success) continue;
        const name = z.string().safeParse(step.data.name);
        if (!name.success) {
          throw new Error(
            `${WORKFLOW_DIR}/${entry}: a \`run:\` step in job "${jobName}" has no \`name:\`.\n` +
              `  rule: the name is how a step is declared in DECLARED_CI_EXTRAS; an unnamed step cannot be excepted, only guessed at\n` +
              `  fix: give it a name`,
          );
        }
        steps.push({
          id: `${entry}:${name.data}`,
          workflow: entry,
          name: name.data,
          run: step.data.run.trim(),
        });
      }
    }
    found.push({ file: entry, steps });
  }
  return found;
}

/** The root script a step invokes, when it invokes exactly one and nothing
 *  else. Anything compound is shell the gate script could not carry anyway. */
function scriptRunBy(step: WorkflowStep, scripts: Record<string, string>): string | null {
  const name = /^pnpm\s+([\w:-]+)$/.exec(step.run)?.[1];
  return name !== undefined && scripts[name] !== undefined ? name : null;
}

describe("CI does not drift from `pnpm verify`", () => {
  const scripts = rootScripts();
  const chain = verifyChain(scripts);
  const gates = gateWorkflows();

  it("finds the gate and the chain it is held against", () => {
    // A sweep that matched no workflow, or a chain that read as empty, would
    // satisfy every assertion below by comparing nothing.
    expect(
      gates.map((gate) => gate.file),
      `no workflow in ${WORKFLOW_DIR} is triggered by ${GATE_TRIGGERS.join(" or ")} — the sweep is broken, not the tree`,
    ).toContain("ci.yml");
    expect(chain, `"${VERIFY_SCRIPT}" chains no scripts`).toContain("test");
  });

  it("every gate runs verify's chain — as the script, or step by step in its order", () => {
    const violations: string[] = [];
    for (const gate of gates) {
      const invoked = gate.steps.map((step) => scriptRunBy(step, scripts));
      if (invoked.includes(VERIFY_SCRIPT)) continue;

      const ranInOrder = invoked.filter(
        (name): name is string => name !== null && chain.includes(name),
      );
      const missing = chain.filter((name) => !ranInOrder.includes(name));
      if (missing.length > 0) {
        violations.push(
          `GATE SKIPS A VERIFY STEP  ${WORKFLOW_DIR}/${gate.file} never runs: ${missing.join(", ")}\n` +
            `  rule: \`${VERIFY_SCRIPT}\` promises that a local green predicts CI, so the gate runs either \`pnpm ${VERIFY_SCRIPT}\` or every link of its chain\n` +
            `  fix: add the step, or drop it from the "${VERIFY_SCRIPT}" script in ${ROOT_MANIFEST}`,
        );
        continue;
      }
      if (ranInOrder.join(" ") !== chain.join(" ")) {
        violations.push(
          `GATE REORDERS VERIFY  ${WORKFLOW_DIR}/${gate.file}\n` +
            `  runs:   ${ranInOrder.join(" -> ")}\n` +
            `  verify: ${chain.join(" -> ")}\n` +
            `  rule: the two are one gate, so they fail in the same order — otherwise the first failure a developer sees is not the first failure CI reports\n` +
            `  fix: reorder one of them, or collapse the gate to a single \`pnpm ${VERIFY_SCRIPT}\` step`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every step a gate adds on top of verify is declared, with a reason", () => {
    const violations: string[] = [];
    for (const gate of gates) {
      const callsVerify = gate.steps.some((step) => scriptRunBy(step, scripts) === VERIFY_SCRIPT);
      for (const step of gate.steps) {
        const script = scriptRunBy(step, scripts);
        if (script === VERIFY_SCRIPT) continue;
        if (!callsVerify && script !== null && chain.includes(script)) continue;
        const reason = DECLARED_CI_EXTRAS.get(step.id);
        if (reason !== undefined && reason.length > 0) continue;
        violations.push(
          `UNDECLARED CI STEP  ${step.id}\n` +
            `  runs: ${step.run.split("\n")[0]}\n` +
            `  rule: CI is \`${VERIFY_SCRIPT}\` plus a DECLARED extra set — an undeclared step is work a developer cannot run before pushing and will discover as a red build\n` +
            `  fix: move it into the "${VERIFY_SCRIPT}" chain, or add a row to DECLARED_CI_EXTRAS saying why it cannot be`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every workspace smoke is reachable from a root script", () => {
    // A smoke wired to nothing is a suite that runs when someone remembers the
    // `--filter` incantation, which is never. This is how `@repo/desktop`'s
    // was found: it existed, it passed, and no script in the repo named it.
    const violations: string[] = [];
    for (const workspace of workspaces()) {
      const manifest = scriptTableSchema.safeParse(
        JSON.parse(sourceOf(path.posix.join(workspace.dir, "package.json"))),
      );
      if (!manifest.success) continue;
      if (manifest.data.scripts[SMOKE_SCRIPT] === undefined) continue;
      const invocation = new RegExp(
        `--filter[= ]${workspace.name.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s+${SMOKE_SCRIPT}\\b`,
      );
      if (Object.values(scripts).some((body) => invocation.test(body))) continue;
      violations.push(
        `UNREACHABLE SMOKE  ${workspace.dir}/package.json declares "${SMOKE_SCRIPT}"\n` +
          `  rule: every smoke has a root script that runs it — one reachable only through \`pnpm --filter ${workspace.name} ${SMOKE_SCRIPT}\` is one nobody runs, and neither \`verify\` nor CI can be held against a command that has no name\n` +
          `  fix: add a root script (beside "smoke:package" in ${ROOT_MANIFEST}) that runs it, and give it a row in MANUAL_SMOKES or a step in a gate workflow`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every root smoke either runs in a gate or is declared manual, with a reason", () => {
    const ranByGate = new Set(
      gates.flatMap((gate) =>
        gate.steps.map((step) => scriptRunBy(step, scripts)).filter((name) => name !== null),
      ),
    );
    const rootSmokes = Object.keys(scripts).filter((name) => name.startsWith(ROOT_SMOKE_PREFIX));
    const violations: string[] = [];
    expect(rootSmokes, `${ROOT_MANIFEST} declares no "${ROOT_SMOKE_PREFIX}*" script`).not.toEqual(
      [],
    );
    for (const name of rootSmokes) {
      if (ranByGate.has(name)) continue;
      const reason = MANUAL_SMOKES.get(name);
      if (reason !== undefined && reason.length > 0) continue;
      violations.push(
        `UNDECLARED MANUAL SMOKE  ${ROOT_MANIFEST}: "${name}"\n` +
          `  rule: a smoke no gate runs is one a developer has to know to run, so what keeps it out of CI is written down rather than assumed\n` +
          `  fix: add a step to a gate workflow, or a row to MANUAL_SMOKES in tools/repo-guards/src/ci-verify-parity.test.ts`,
      );
    }
    for (const [name, why] of MANUAL_SMOKES) {
      if (scripts[name] === undefined) {
        violations.push(
          `STALE MANUAL SMOKE  "${name}" is not a script in ${ROOT_MANIFEST}\n` +
            `  the row claimed: ${why}\n` +
            `  fix: delete the row — an exemption for a script nobody can run excuses nothing`,
        );
      } else if (ranByGate.has(name)) {
        violations.push(
          `STALE MANUAL SMOKE  "${name}" is run by a gate workflow now\n` +
            `  the row claimed: ${why}\n` +
            `  fix: delete the row and declare the STEP in DECLARED_CI_EXTRAS instead`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("no entry in DECLARED_CI_EXTRAS is stale", () => {
    const live = new Set(gates.flatMap((gate) => gate.steps.map((step) => step.id)));
    const stale = [...DECLARED_CI_EXTRAS.keys()]
      .filter((id) => !live.has(id))
      .map(
        (id) =>
          `STALE EXCEPTION  ${id} matches no run step in any gate workflow\n` +
          `  rule: an exception names a step that exists, or it only ever loosens\n` +
          `  fix: delete the entry from DECLARED_CI_EXTRAS, or restore the step`,
      );
    expect(stale, `\n${stale.join("\n\n")}\n`).toEqual([]);
  });
});

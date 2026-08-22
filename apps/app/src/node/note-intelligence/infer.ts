// The inference child: one-shot `claude -p … --output-format json --model
// haiku` (flags verified against the installed CLI). The cheapest model,
// because the ask is a classification over a head-capped body, not writing.
// cwd is the DATA DIR on purpose: `claude` loads CLAUDE.md from its cwd, and
// running in the vault would inject the vault's own agent instructions into a
// task that must read the note as CONTENT, not as a workspace.

import { execFile } from "node:child_process";
import { z } from "zod";

/** The closed field set — the ONLY keys inference may produce (#590). */
const inferredFieldsSchema = z
  .object({
    description: z.string().min(1).max(140),
    tags: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)).max(5),
    status: z.enum(["draft", "active", "reference", "archived"]),
  })
  .strict();
export type InferredFields = z.infer<typeof inferredFieldsSchema>;

/** The seam tests inject; production wires the CLI child below. Null means
 *  "could not infer" and the caller SKIPS — never retries in a loop. */
export type InferenceRunner = (body: string) => Promise<InferredFields | null>;

// The CLI's json output wraps the model text in an envelope; only `result`
// matters here.
const cliEnvelopeSchema = z.object({ result: z.string() }).loose();

function buildInferencePrompt(body: string): string {
  return [
    "Classify this markdown note. Answer with STRICT JSON only — no prose, no code fences:",
    '{"description": "<=140 chars, one sentence, what the note is about",',
    ' "tags": ["<=5 kebab-case topical tags"],',
    ' "status": "draft" | "active" | "reference" | "archived"}',
    "",
    "Note body:",
    body,
  ].join("\n");
}

/** Pull the first JSON object out of the model's text — models fence or
 *  preface despite instructions, and a parse failure is a SKIP, not an error. */
export function parseInferenceOutput(text: string): InferredFields | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const verdict = inferredFieldsSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return verdict.success ? verdict.data : null;
  } catch {
    return null;
  }
}

export interface CliInferenceArgs {
  /** The child's cwd — the data dir, never the vault (see the header). */
  cwd: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function parseCliStdout(stdout: string): InferredFields | null {
  try {
    const envelope = cliEnvelopeSchema.safeParse(JSON.parse(stdout));
    return envelope.success ? parseInferenceOutput(envelope.data.result) : null;
  } catch {
    return null;
  }
}

export function createCliInferenceRunner(args: CliInferenceArgs): InferenceRunner {
  return (body) =>
    new Promise((resolvePromise) => {
      execFile(
        "claude",
        ["-p", buildInferencePrompt(body), "--output-format", "json", "--model", "haiku"],
        { cwd: args.cwd, timeout: args.timeoutMs ?? DEFAULT_TIMEOUT_MS },
        (error, stdout) => {
          resolvePromise(error === null ? parseCliStdout(stdout) : null);
        },
      );
    });
}

// cwd is the data dir, never the vault: `claude` loads CLAUDE.md from its cwd,
// and the note must be read as content, not as a workspace. the body rides
// stdin, never argv — argv is readable by every process on the machine.

import { execFile } from "node:child_process";
import { HARNESSES } from "@repo/agent-runtime/acp/harness-registry";
import { z } from "zod";

// from the harness table, so the boot PATH probe and this spawn name the same binary.
export const INFERENCE_BINARY = HARNESSES.claude.vendorBinary;

const inferredFieldsSchema = z
  .object({
    description: z.string().min(1).max(140),
    tags: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)).max(5),
    status: z.enum(["draft", "active", "reference", "archived"]),
  })
  .strict();
export type InferredFields = z.infer<typeof inferredFieldsSchema>;

// null means "could not infer"; the caller skips, never retries.
export type InferenceRunner = (body: string) => Promise<InferredFields | null>;

// the CLI's json output wraps the model text in an envelope.
const cliEnvelopeSchema = z.object({ result: z.string() }).loose();

const INFERENCE_PROMPT = [
  "Classify this markdown note. Answer with STRICT JSON only — no prose, no code fences:",
  '{"description": "<=140 chars, one sentence, what the note is about",',
  ' "tags": ["<=5 kebab-case topical tags"],',
  ' "status": "draft" | "active" | "reference" | "archived"}',
  "",
  "The note body follows, piped on stdin:",
].join("\n");

// models fence or preface despite instructions; a parse failure is a skip.
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
      const child = execFile(
        INFERENCE_BINARY,
        ["-p", INFERENCE_PROMPT, "--output-format", "json", "--model", "haiku"],
        { cwd: args.cwd, timeout: args.timeoutMs ?? DEFAULT_TIMEOUT_MS },
        (error, stdout) => {
          resolvePromise(error === null ? parseCliStdout(stdout) : null);
        },
      );
      // a child that exits before draining stdin (missing binary, refused login)
      // answers through the callback; the write's EPIPE must not surface.
      child.stdin?.on("error", () => {});
      child.stdin?.end(body);
    });
}

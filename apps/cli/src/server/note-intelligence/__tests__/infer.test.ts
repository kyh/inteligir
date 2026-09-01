// The inference child's spawn, against a fake `claude` on PATH: the note
// body reaches the child on stdin and never on argv, because argv is
// readable by every process on the machine.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createCliInferenceRunner, INFERENCE_BINARY } from "../infer";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A `claude` that records what it was handed and answers a fixed envelope. */
function fakeClaudeOnPath(recordDir: string): void {
  const binDir = join(makeTempDir("inteligir-infer-bin-"), "bin");
  mkdirSync(binDir);
  const script = join(binDir, INFERENCE_BINARY);
  const envelope = JSON.stringify({
    result: JSON.stringify({ description: "Read off stdin.", tags: ["stdin"], status: "draft" }),
  });
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$@" > '${join(recordDir, "argv")}'`,
      `cat > '${join(recordDir, "stdin")}'`,
      `printf '%s' '${envelope}'`,
      "",
    ].join("\n"),
  );
  chmodSync(script, 0o755);
  vi.stubEnv("PATH", `${binDir}${delimiter}${process.env.PATH ?? ""}`);
}

describe("the CLI inference child", () => {
  it("hands the note body to the child on stdin, never on argv", async () => {
    const recordDir = makeTempDir("inteligir-infer-record-");
    fakeClaudeOnPath(recordDir);
    const body = "# Private\n\nA line only the child should see.\n";

    const inferred = await createCliInferenceRunner({ cwd: recordDir })(body);

    expect(inferred).toEqual({ description: "Read off stdin.", tags: ["stdin"], status: "draft" });
    expect(readFileSync(join(recordDir, "stdin"), "utf8")).toBe(body);
    const argv = readFileSync(join(recordDir, "argv"), "utf8");
    expect(argv).not.toContain("only the child should see");
    expect(argv).toContain("The note body follows, piped on stdin:");
  });
});

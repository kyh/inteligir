// CI runs this after a first push: drizzle-kit can misread what it created (a `nextval(…)` default
// as serial) and fail halfway through the next push. Only the dry run's `no_changes` passes.

import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { z } from "zod";
import config from "../drizzle.config.ts";

const reportSchema = z.looseObject({ status: z.string() });

const dbRoot = new URL("..", import.meta.url);

const reportOf = (output: string) => {
  const line = output
    .split("\n")
    .map((text) => text.trim())
    .findLast((text) => text.startsWith("{"));
  if (line === undefined) {
    return null;
  }
  try {
    const parsed = reportSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// drizzle-kit fails on a schema path that matches no module, as `push` skips it then
if (globSync(config.schema, { cwd: dbRoot }).length === 0) {
  console.log("No schema module declares a table yet: a second push has nothing to plan.");
} else {
  const run = spawnSync("drizzle-kit", ["push", "--explain", "--output", "json"], {
    cwd: dbRoot,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const output = run.stdout.trim();
  const report = reportOf(output);

  if (run.status === 0 && report?.status === "no_changes") {
    console.log("Schema push is idempotent: a second push changes nothing.");
  } else {
    console.error(
      [
        `A second schema push would not be a no-op (drizzle-kit exited ${String(run.status ?? run.signal)}, status ${report?.status ?? "unknown"}).`,
        "What it planned:",
        report === null ? output || "(no output)" : JSON.stringify(report, null, 2),
      ].join("\n"),
    );
    process.exitCode = 1;
  }
}

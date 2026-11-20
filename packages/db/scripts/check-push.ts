import { fileURLToPath } from "node:url";
import { push } from "drizzle-kit/cli";

const report = await push({
  config: fileURLToPath(new URL("../drizzle.config.ts", import.meta.url)),
  explain: true,
});

if (report.status === "no_changes") {
  console.log("Schema push is idempotent: a second push changes nothing.");
} else {
  console.error(
    [
      `A second schema push would not be a no-op (status ${report.status}).`,
      "What it planned:",
      JSON.stringify(report, null, 2),
    ].join("\n"),
  );
}

// WARNING: drizzle-kit's push keeps its connection open, so only an exit ends the script
process.exit(report.status === "no_changes" ? 0 : 1);

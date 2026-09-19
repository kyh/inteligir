// The notarization material lives in <repo>/.release (gitignored): the App Store Connect
// key and the two ids electron-builder reads from the environment. They are set HERE,
// inside the turbo task, because turbo's strict env mode strips an undeclared variable
// before this process starts — exporting them in the shell reaches nothing.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
const releaseDir = path.resolve(packageRoot, "../../.release");
const notaryEnv = path.resolve(releaseDir, "notary.env");

const env = { ...process.env };
if (existsSync(notaryEnv)) {
  for (const line of readFileSync(notaryEnv, "utf-8").split("\n")) {
    const match = /^(?<name>APPLE_[A-Z_]+)=(?<value>.+)$/u.exec(line.trim());
    if (match?.groups === undefined) {
      continue;
    }
    const { name, value } = match.groups;
    env[name] = name === "APPLE_API_KEY" ? path.resolve(releaseDir, value) : value;
  }
  process.stdout.write(`package: notarizing with ${notaryEnv}\n`);
} else {
  process.stdout.write(
    `package: ${notaryEnv} absent — signed only if a Developer ID is in the keychain, not notarized\n`,
  );
}

const result = spawnSync("electron-builder", ["--mac", "--arm64", "--publish", "never"], {
  cwd: packageRoot,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);

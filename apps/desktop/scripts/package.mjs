// The notarization material lives in <repo>/.release (gitignored): the App Store Connect
// key and the two ids electron-builder reads from the environment. They are set HERE,
// inside the turbo task, because turbo's strict env mode strips an undeclared variable
// before this process starts — exporting them in the shell reaches nothing.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(packageRoot, "../../.release");
const notaryEnv = resolve(releaseDir, "notary.env");

const env = { ...process.env };
if (existsSync(notaryEnv)) {
  for (const line of readFileSync(notaryEnv, "utf8").split("\n")) {
    const match = /^(APPLE_[A-Z_]+)=(.+)$/u.exec(line.trim());
    if (match === null) continue;
    const [, name, value] = match;
    env[name] = name === "APPLE_API_KEY" ? resolve(releaseDir, value) : value;
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

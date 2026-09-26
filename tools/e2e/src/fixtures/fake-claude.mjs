#!/usr/bin/env node
// Stands in for the bundled claude's sign-in verbs, as CLAUDE_CODE_EXECUTABLE: `auth status --json`,
// `auth login --claudeai` and `auth logout`, over the marker file FAKE_CLAUDE_MARKER names, the way
// the vendor's own store would hold the sign-in. The login prints the lines the real one prints with
// stdout piped and opens no browser, so the only way through is the code FAKE_CLAUDE_CODE names,
// pasted on stdin.

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const SIGN_IN_PAGE = "https://claude.test/oauth/authorize?code=true";

const { FAKE_CLAUDE_CODE: pageCode, FAKE_CLAUDE_MARKER: marker } = process.env;
if (marker === undefined || pageCode === undefined) {
  process.stderr.write("fake claude: FAKE_CLAUDE_MARKER and FAKE_CLAUDE_CODE must both be set\n");
  process.exit(2);
}

const [group, verb] = process.argv.slice(2);

const status = () => {
  const signedIn = existsSync(marker);
  process.stdout.write(
    JSON.stringify(
      signedIn
        ? {
            apiProvider: "firstParty",
            email: "ada@example.com",
            loggedIn: true,
            subscriptionType: "max",
          }
        : { apiProvider: "firstParty", authMethod: "none", loggedIn: false },
    ),
  );
  process.exit(signedIn ? 0 : 1);
};

const login = async () => {
  process.stdout.write("Opening browser to sign in…\n");
  process.stdout.write(`If the browser didn't open, visit: ${SIGN_IN_PAGE}\n`);
  process.stdout.write("Paste code here if prompted > ");
  for await (const line of createInterface({ input: process.stdin })) {
    const [code = "", state = ""] = line.trim().split("#");
    if (code === "" || state === "") {
      process.stderr.write("Invalid code. Please make sure the full code was copied.\n");
      continue;
    }
    if (line.trim() !== pageCode) {
      process.stderr.write("Login failed: Invalid authorization code\n");
      process.exit(1);
    }
    writeFileSync(marker, "");
    process.stdout.write("Login successful.\n");
    process.exit(0);
  }
  process.stderr.write("Login failed: no code was pasted\n");
  process.exit(1);
};

if (group === "auth" && verb === "status") {
  status();
} else if (group === "auth" && verb === "login") {
  await login();
} else if (group === "auth" && verb === "logout") {
  rmSync(marker, { force: true });
  process.exit(0);
} else {
  process.stderr.write(`fake claude: no verb "${process.argv.slice(2).join(" ")}"\n`);
  process.exit(2);
}

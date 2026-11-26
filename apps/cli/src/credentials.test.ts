import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { credentialsPath, forgetHeld, readHeld, writeHeld } from "./credentials";

const configHome = async () => await mkdtemp(path.join(tmpdir(), "inteligir-cli-"));

describe("the sign-in kept on this computer", () => {
  it("lives under the config home, readable only by its owner, and reads back as written", async () => {
    const file = credentialsPath({ XDG_CONFIG_HOME: await configHome() });

    const held = {
      client: { client_id: "client-1" },
      site: "https://inteligir.com",
      tokens: { access_token: "ito_a", refresh_token: "r", token_type: "Bearer" },
    };

    await expect(readHeld(file)).resolves.toBeNull();
    await writeHeld(file, held);
    await expect(readHeld(file)).resolves.toStrictEqual(held);
    const { mode } = await stat(file);
    expect(mode % 0o1000).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf-8"))).toStrictEqual(held);

    await forgetHeld(file);
    await expect(readHeld(file)).resolves.toBeNull();
  });

  it("reads a file it can't make sense of as signed out", async () => {
    const file = credentialsPath({ XDG_CONFIG_HOME: await configHome() });
    await writeHeld(file, { site: "https://inteligir.com" });
    await writeFile(file, "{ half");
    await expect(readHeld(file)).resolves.toBeNull();
    await writeFile(file, JSON.stringify({ site: "not an address" }));
    await expect(readHeld(file)).resolves.toBeNull();
  });
});

import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { HARNESS_IDS } from "@repo/agent-runtime/acp/harness-registry";
import type { ConnectorTargetInput } from "@repo/api/local/connectors/connectors-schema";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { pathContains } from "../../path-containment";
import { createVendorMcpConfigs } from "../connectors-service";

// nothing listens on port 1, so a vendor's look for a sign-in is refused at once and none starts.
const DEAD_URL = "http://127.0.0.1:1/mcp";

const STDIO: ConnectorTargetInput = { args: ["-y", "some-server"], command: "npx", kind: "stdio" };

// the host's env without a vendor override or credential of its own, over stores and a home of the
// suite's: whatever the machine running it holds is never read or written. codex refuses a
// CODEX_HOME that does not exist.
const scratchEnv = (root: string): NodeJS.ProcessEnv => {
  const stores = {
    CLAUDE_CONFIG_DIR: path.join(root, "claude"),
    CODEX_HOME: path.join(root, "codex"),
  };
  for (const dir of Object.values(stores)) {
    mkdirSync(dir);
  }
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(?:ANTHROPIC|CLAUDE|CODEX|OPENAI)_|^CLAUDECODE$/u.test(key),
      ),
    ),
    ...stores,
    HOME: root,
  };
};

// the vendors' real binaries, the ones the app bundles: the contract the ports parse and spell.
// never a sign-in, which would open a browser.
describe("the bundled vendors' MCP config, over empty stores", () => {
  it.each(HARNESS_IDS)(
    "%s adds a URL and a command, lists both, and removes both",
    { timeout: 120_000 },
    async (harness) => {
      const root = makeTempDir(`bundled-mcp-${harness}-`);
      const dataDir = makeTempDir(`bundled-mcp-${harness}-data-`);
      const config = createVendorMcpConfigs({ cwd: dataDir, env: scratchEnv(root) })[harness];
      expect(pathContains(root, config.configPath)).toBe(true);
      expect(await config.list()).toEqual([]);

      expect(await config.add("dead", { kind: "http", url: DEAD_URL })).toBeNull();
      expect(await config.add("local", STDIO)).toBeNull();
      const listed = await config.list();
      expect(listed.map(({ name, target }) => ({ name, target }))).toEqual([
        { name: "dead", target: { kind: "http", url: DEAD_URL } },
        { name: "local", target: STDIO },
      ]);
      expect(listed.find((server) => server.name === "local")?.auth).toBe("not-needed");
      expect(readFileSync(config.configPath, "utf-8")).toContain(DEAD_URL);

      await config.remove("dead");
      await config.remove("local");
      expect(await config.list()).toEqual([]);
    },
  );
});

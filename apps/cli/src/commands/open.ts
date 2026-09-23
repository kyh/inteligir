import { browserHandoffUrl } from "@repo/api/local/routes";
import { defineCommand } from "citty";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeOut } from "../output";
import { systemOpenExternalUrl } from "../server/browser-opener";

export const openCommand = (deps: CliDeps) =>
  defineCommand({
    args: { ...jsonArg },
    meta: {
      description: "Open the workspace in a signed-in browser tab (--json prints the link instead)",
      name: "open",
    },
    run: async ({ args }) => {
      const server = deps.resolveServer();
      const { nonce } = await apiFor(deps).system.browserHandoff();
      const url = browserHandoffUrl(`${server.baseUrl}/`, nonce);
      // a --json caller is a program that hands the link on; a tab it did not ask for would open
      // on the screen of whoever runs it.
      if (outputJson(args, { url })) {
        return;
      }
      const openExternalUrl = deps.openExternalUrl ?? systemOpenExternalUrl;
      if (await openExternalUrl(url)) {
        out.success(`Opened ${server.baseUrl} in your browser.`);
        return;
      }
      out.warn("Could not open a browser. This one-time link signs one in:");
      // raw: consola restyles _underscores_, and a nonce may carry them.
      writeOut(`${url}\n`);
    },
  });

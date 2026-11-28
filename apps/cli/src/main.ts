import process from "node:process";

import { defaultTransport, run } from "./commands";
import { openInBrowser } from "./connector-auth";

process.exitCode = await run(
  {
    env: process.env,
    err: (text) => {
      process.stderr.write(`${text}\n`);
    },
    open: openInBrowser,
    out: (text) => {
      process.stdout.write(`${text}\n`);
    },
    transport: defaultTransport,
  },
  process.argv.slice(2),
);

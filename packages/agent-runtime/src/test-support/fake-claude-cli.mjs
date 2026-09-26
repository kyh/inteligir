// stands in for the claude CLI the adapter's SDK launches: appends its argv to FAKE_VENDOR_RECORD as
// one json line and exits, so the session it would have served never opens. What the adapter
// launched it with is the whole assertion.

import { appendFileSync } from "node:fs";

const recordPath = process.env.FAKE_VENDOR_RECORD;
if (recordPath !== undefined) {
  appendFileSync(recordPath, `${JSON.stringify(process.argv.slice(2))}\n`);
}
process.exit(1);

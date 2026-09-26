// connectors are the default agent's own MCP config, so the registry an older build kept in the data
// dir holds only api keys and tokens nothing reads any more. deleted rather than imported: its rows
// carried headers and grants neither vendor could take as they were.

import { rmSync } from "node:fs";
import path from "node:path";

const RETIRED_CONNECTORS_FILE = "connectors.json";

export const removeRetiredConnectorsFile = (dataDir: string): void => {
  rmSync(path.join(dataDir, RETIRED_CONNECTORS_FILE), { force: true });
};

// The harness probe for Settings' detect+guide surface. It refuses nothing:
// an absent CLI or an unreadable credential store is a REPORTED fact.

import { base } from "../orpc";
import { probeHarnesses } from "./agent-status-probe";

const status = base.agents.status.handler(async () => ({
  harnesses: await probeHarnesses(process.env),
}));

export const agentsRouter = {
  status,
};

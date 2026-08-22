// GET /agents/status — the harness probe for Settings' detect+guide surface.

import { agentsRoutes } from "@repo/server-contract/agents";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import { probeHarnesses } from "./agent-status-probe";

export function registerAgentRoutes(registrars: Pick<TypedRoutesRegistrars, "get">): void {
  registrars.get(agentsRoutes.status, async (c) =>
    c.json({ harnesses: await probeHarnesses(process.env) }),
  );
}

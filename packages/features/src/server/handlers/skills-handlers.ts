import { listIntegrations, listSkills, repairIntegrations } from "../agent/setup";
import { emitEvent } from "../events";
import { getAgentPorts, getBundledResources } from "../lib/agent-lifecycle";
import type { HandlerRegistrar } from "../lib/handler-registry";

export function registerSkillsHandlers(handle: HandlerRegistrar): void {
  handle("listSkills", () => ({ skills: listSkills() }));

  // Integrations (CLI binaries).
  handle("listIntegrations", () => listIntegrations(getAgentPorts()));
  handle("repairIntegrations", () =>
    repairIntegrations(getAgentPorts(), getBundledResources(), (p) =>
      emitEvent("onSetupProgress", p),
    ),
  );
}

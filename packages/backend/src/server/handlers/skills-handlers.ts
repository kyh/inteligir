import { listIntegrations, listSkills, repairIntegrations } from "@repo/agent/setup";
import { emitEvent } from "../events";
import { getAgentPorts, getBundledResources } from "../boot/agent-wiring";
import type { HandlerRegistrar } from "./handler-registry";

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

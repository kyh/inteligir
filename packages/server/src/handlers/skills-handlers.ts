import { createSkill, listIntegrations, listSkills, repairIntegrations } from "@repo/agent/setup";
import { emitEvent } from "../events";
import { getAgentPorts, getBundledResources } from "../boot/agent-wiring";
import type { HandlerRegistrar } from "./handler-registry";

export function registerSkillsHandlers(handle: HandlerRegistrar): void {
  handle("listSkills", () => ({ skills: listSkills(getBundledResources()) }));
  // Authoring, not file management: the skills folder is inside ~/.inteligir,
  // which the app owns — writing a valid SKILL.md is a capability the host
  // already has, where revealing the folder would need a new shell one.
  handle("createSkill", (payload) => createSkill(getBundledResources(), payload));

  // Integrations (CLI binaries).
  handle("listIntegrations", () => listIntegrations(getAgentPorts()));
  handle("repairIntegrations", () =>
    repairIntegrations(getAgentPorts(), getBundledResources(), (p) =>
      emitEvent("onSetupProgress", p),
    ),
  );
}

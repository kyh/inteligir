import { createSkill, listIntegrations, listSkills, repairIntegrations } from "@repo/agent/setup";
import { emitEvent } from "../events";
import type { HandlerRegistrar } from "./handler-registry";
import type { HostServices } from "../boot/host-services";

export function registerSkillsHandlers(
  handle: HandlerRegistrar,
  services: Pick<HostServices, "agentPorts" | "bundledResources">,
): void {
  handle("listSkills", () => ({ skills: listSkills(services.bundledResources) }));
  // Authoring, not file management: the skills folder is inside ~/.inteligir,
  // which the app owns — writing a valid SKILL.md is a capability the host
  // already has, where revealing the folder would need a new shell one.
  handle("createSkill", (payload) => createSkill(services.bundledResources, payload));

  // Integrations (CLI binaries).
  handle("listIntegrations", () => listIntegrations(services.agentPorts));
  handle("repairIntegrations", () =>
    repairIntegrations(services.agentPorts, services.bundledResources, (p) =>
      emitEvent("onSetupProgress", p),
    ),
  );
}

// Handler groups, one per domain, so a reader sees the domain boundaries
// instead of scanning one 150-line block. collectHandlers (handlers/handler-
// registry.ts) verifies at boot that the union covers every registry method
// the host owns.

import type { HandlerRegistrar } from "./handler-registry";
import type { HostServices } from "../boot/host-services";
import { registerAgentHandlers } from "./agent-handlers";
import { registerAiHandlers } from "./ai-handlers";
import { registerAiProviderHandlers } from "./ai-provider-handlers";
import { registerCaptureHandlers } from "./capture-handlers";
import { registerRestoreHandlers } from "./restore-handlers";
import { registerDelegationHandlers } from "./delegation-handlers";
import { registerExecutorHandlers } from "./executor-handlers";
import { registerKnowledgeHandlers } from "./knowledge-handlers";
import { registerLifecycleHandlers } from "./lifecycle-handlers";
import { registerNotificationHandlers } from "./notification-handlers";
import { registerRemoteAccessHandlers } from "./remote-access-handlers";
import { registerRoutinesHandlers } from "./routines-handlers";
import { registerSkillsHandlers } from "./skills-handlers";
import { registerSyncHandlers } from "./sync-handlers";
import { registerUiStateHandlers } from "./ui-state-handlers";
import { registerVaultHandlers } from "./vault-handlers";
import { registerVoiceHandlers } from "./voice-handlers";

export function registerAllHandlers(handle: HandlerRegistrar, services: HostServices): void {
  registerAgentHandlers(handle, services);
  registerAiProviderHandlers(handle);
  registerLifecycleHandlers(handle);
  registerVoiceHandlers(handle, services);
  registerNotificationHandlers(handle, services);
  registerUiStateHandlers(handle, services);
  registerExecutorHandlers(handle, services);
  registerVaultHandlers(handle, services);
  registerKnowledgeHandlers(handle, services);
  registerDelegationHandlers(handle, services);
  registerRoutinesHandlers(handle, services);
  registerRestoreHandlers(handle, services);
  registerCaptureHandlers(handle, services);
  registerAiHandlers(handle);
  registerSkillsHandlers(handle, services);
  registerSyncHandlers(handle, services);
  registerRemoteAccessHandlers(handle, services);
}

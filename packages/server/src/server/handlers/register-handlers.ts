// Handler groups, one per domain, so a reader sees the domain boundaries
// instead of scanning one 150-line block. collectHandlers (handlers/handler-
// registry.ts) verifies at boot that the union covers every registry method
// the host owns.

import type { HandlerRegistrar } from "./handler-registry";
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
import { registerSkillsHandlers } from "./skills-handlers";
import { registerSyncHandlers } from "./sync-handlers";
import { registerUiStateHandlers } from "./ui-state-handlers";
import { registerVaultHandlers } from "./vault-handlers";
import { registerVoiceHandlers } from "./voice-handlers";

export function registerAllHandlers(handle: HandlerRegistrar): void {
  registerAgentHandlers(handle);
  registerAiProviderHandlers(handle);
  registerLifecycleHandlers(handle);
  registerVoiceHandlers(handle);
  registerNotificationHandlers(handle);
  registerUiStateHandlers(handle);
  registerExecutorHandlers(handle);
  registerVaultHandlers(handle);
  registerKnowledgeHandlers(handle);
  registerDelegationHandlers(handle);
  registerRestoreHandlers(handle);
  registerCaptureHandlers(handle);
  registerAiHandlers(handle);
  registerSkillsHandlers(handle);
  registerSyncHandlers(handle);
  registerRemoteAccessHandlers(handle);
}

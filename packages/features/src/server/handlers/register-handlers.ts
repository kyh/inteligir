// Handler groups, one per domain, so a reader sees the domain boundaries
// instead of scanning one 150-line block. collectHandlers (lib/handler-
// registry.ts) verifies at boot that the union covers every registry method
// the host owns.

import type { HandlerRegistrar } from "../lib/handler-registry";
import { registerAgentHandlers } from "./agent-handlers";
import { registerAiHandlers } from "./ai-handlers";
import { registerCaptureHandlers } from "./capture-handlers";
import { registerCheckpointHandlers } from "./checkpoint-handlers";
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
  registerLifecycleHandlers(handle);
  registerVoiceHandlers(handle);
  registerNotificationHandlers(handle);
  registerUiStateHandlers(handle);
  registerExecutorHandlers(handle);
  registerVaultHandlers(handle);
  registerKnowledgeHandlers(handle);
  registerDelegationHandlers(handle);
  registerCheckpointHandlers(handle);
  registerCaptureHandlers(handle);
  registerAiHandlers(handle);
  registerSkillsHandlers(handle);
  registerSyncHandlers(handle);
  registerRemoteAccessHandlers(handle);
}

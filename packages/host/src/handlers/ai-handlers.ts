import { cancelInline, classifyIntent, generateInline } from "../app/inline-ai";
import { cancelGhost, generateGhost, listGhostModels } from "../app/ghost-text";
import type { HandlerRegistrar } from "../lib/handler-registry";

export function registerAiHandlers(handle: HandlerRegistrar): void {
  handle("generateInlineAi", (params) => generateInline(params.prompt, params.requestId));
  handle("cancelInlineAi", (params) => cancelInline(params.requestId));
  handle("classifyAiIntent", (params) => classifyIntent(params.prompt, params.hasSelection));
  handle("generateGhostText", (params) => generateGhost(params.prompt, params.requestId));
  handle("cancelGhostText", (params) => cancelGhost(params.requestId));
  handle("listGhostModels", () => listGhostModels());
}

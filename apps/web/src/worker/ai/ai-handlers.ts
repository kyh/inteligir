// ---------------------------------------------------------------------------
// The editor AI's six Bridge handlers, over this object's own generator.
//
// Thin by design: every decision that could differ between hosts — which model,
// which bound, what a cancel means — is ./text-generator's. What this module
// owns is the SHAPE the registry promises, and the shape is uniform here: all
// six answer with VALUES, because an editor that got an exception where it
// expected `{ ok: false }` would surface a stack trace inside a document.
// ---------------------------------------------------------------------------

import type { HandlerRegistrar } from "../host/handler-registry";
import type { TextGenerator } from "./text-generator";

export function registerAiHandlers(handle: HandlerRegistrar, generator: TextGenerator): void {
  handle("generateInlineAi", ({ prompt, requestId }) => generator.generate(prompt, requestId));
  handle("cancelInlineAi", ({ requestId }) => {
    generator.cancel(requestId);
  });
  handle("classifyAiIntent", ({ prompt, hasSelection }) =>
    generator.classify(prompt, hasSelection),
  );
  handle("generateGhostText", ({ prompt, requestId }) => generator.ghost(prompt, requestId));
  handle("cancelGhostText", ({ requestId }) => {
    generator.cancelGhost(requestId);
  });
  handle("listGhostModels", () => generator.ghostModels());
}

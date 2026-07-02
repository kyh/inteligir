// The editor's AI surface, composed: the transient `ai` streaming mark, the
// suggestion (track-changes) rendering, the ghost-text copilot, and the AI
// session plugin carrying the menu + review bar as afterEditable renders.
// Live editor only — none of this exists in the headless serialization
// mirror, because none of it ever serializes (see transient.ts).

import { AiMarkKit } from "@repo/app/editor/ai/ai-mark";
import { AiMenu } from "@repo/app/editor/ai/ai-menu";
import { AiSessionPlugin } from "@repo/app/editor/ai/ai-session";
import { GhostTextKit } from "@repo/app/editor/ai/ghost-text-kit";
import { SuggestionKit } from "@repo/app/editor/ai/suggestion-kit";
import { SuggestionReviewBar } from "@repo/app/editor/ai/suggestion-review-bar";

function AiSurface() {
  return (
    <>
      <AiMenu />
      <SuggestionReviewBar />
    </>
  );
}

export const AiKit = [
  ...AiMarkKit,
  ...SuggestionKit,
  ...GhostTextKit,
  AiSessionPlugin.configure({ render: { afterEditable: AiSurface } }),
];

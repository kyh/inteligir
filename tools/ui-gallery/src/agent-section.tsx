import { ApprovalCard, ApprovalOption, ApprovalQuestion } from "@repo/ui/ai/approval-card";
import { LoadingState } from "@repo/ui/ai/loading-state";
import { StreamingText } from "@repo/ui/ai/streaming-text";
import { Thinking, ThinkingReasoning } from "@repo/ui/ai/thinking";
import { ToolChip, ToolChipDetail, ToolChipList } from "@repo/ui/ai/tool-chips";
import { useState } from "react";

import { Demo, DemoCase, GallerySection } from "./gallery-chrome";

// fixed so the elapsed readout is stable across screenshots.
const STARTED_AT = 0;

const ANSWER_TEXT =
  "The library holds four notes. Two link to Welcome, and none of them are unresolved.";

export const AgentSection = () => {
  const [decision, setDecision] = useState<string | null>(null);

  return (
    <GallerySection id="agent" title="Agent surfaces">
      <Demo
        name="LoadingState"
        purpose="A turn is running. Elapsed counts from the turn's own start, not from mount."
      >
        <DemoCase label="drive">
          <LoadingState label="Reading the library" variant="drive" />
        </DemoCase>
        <DemoCase label="dots">
          <LoadingState label="Indexing" variant="dots" />
        </DemoCase>
        <DemoCase label="orbit">
          <LoadingState label="Waiting on the model" variant="orbit" />
        </DemoCase>
        <DemoCase label="with elapsed">
          <LoadingState label="Committing" startedAt={STARTED_AT} showElapsed={false} />
        </DemoCase>
      </Demo>

      <Demo
        name="Thinking · ThinkingReasoning"
        purpose="The turn's trace, expandable: what the agent noted while it worked."
        stack
      >
        <div className="w-full max-w-md">
          <Thinking label="Working" doneLabel="Thought for 4s" working>
            <ThinkingReasoning>
              The link is unresolved because the target was renamed, not deleted.
            </ThinkingReasoning>
          </Thinking>
        </div>
        <div className="w-full max-w-md">
          <Thinking label="Working" doneLabel="Thought for 4s">
            <ThinkingReasoning>
              Settled — collapsed by default once the turn is done.
            </ThinkingReasoning>
          </Thinking>
        </div>
      </Demo>

      <Demo
        name="ToolChipList · ToolChip · ToolChipDetail"
        purpose="What the turn touched: commands run, files changed. Details open per chip."
        stack
      >
        <div className="w-full max-w-md">
          <ToolChipList summary="3 files changed">
            <ToolChip icon="write" label="Edited" chip="Getting Started.md">
              <ToolChipDetail>+ Added a section on backlinks</ToolChipDetail>
              <ToolChipDetail>- Removed the stale link</ToolChipDetail>
            </ToolChip>
            <ToolChip icon="read" label="Read" chip="Use Cases.md" />
          </ToolChipList>
        </div>
      </Demo>

      <Demo
        name="StreamingText"
        purpose="The assistant's answer, as it arrives."
        note="The word-by-word reveal is off in the product — the text is already live. It is shown on here."
        stack
      >
        <div className="w-full max-w-md">
          <StreamingText text={ANSWER_TEXT} streaming={false} animate={false} />
        </div>
      </Demo>

      <Demo
        name="ApprovalCard · ApprovalQuestion · ApprovalOption"
        purpose="Human-in-the-loop: the turn is blocked until the reader answers."
        note={decision === null ? undefined : `You answered: ${decision}`}
        stack
      >
        <div className="w-full max-w-md">
          <ApprovalCard
            onSubmit={(answers) => {
              setDecision(answers[0]?.optionIds[0] ?? "nothing");
            }}
            sentLabel="Answered"
          >
            <ApprovalQuestion
              questionId="write-getting-started"
              prompt="Write to Getting Started.md?"
              detail="The turn wants to add a section on backlinks."
            >
              <ApprovalOption optionId="allow">Allow once</ApprovalOption>
              <ApprovalOption optionId="allow-always">Allow for this turn</ApprovalOption>
              <ApprovalOption optionId="deny">Deny</ApprovalOption>
            </ApprovalQuestion>
          </ApprovalCard>
        </div>
      </Demo>
    </GallerySection>
  );
};

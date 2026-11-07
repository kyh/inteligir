import { ApprovalCard, ApprovalOption, ApprovalQuestion } from "@repo/ui/ai/approval-card";
import { LoadingState } from "@repo/ui/ai/loading-state";
import { StreamingText } from "@repo/ui/ai/streaming-text";
import { Thinking, ThinkingReasoning } from "@repo/ui/ai/thinking";
import { ToolChip, ToolChipDetail, ToolChipList } from "@repo/ui/ai/tool-chips";
import { useState } from "react";

import { Demo, DemoCase, GallerySection } from "./gallery-chrome";

// a turn that began before this page loaded, so its readout runs ahead of the cases counting from
// mount
const TURN_STARTED_AT = Date.now() - 12_000;

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
        <DemoCase label="from the turn's start">
          <LoadingState label="Filing items" startedAt={TURN_STARTED_AT} />
        </DemoCase>
        <DemoCase label="no elapsed">
          <LoadingState label="Saving" showElapsed={false} />
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
              The link is unresolved because no item holds that title yet.
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
        purpose="What the turn touched: the library calls it made. Details open per chip."
        stack
      >
        <div className="w-full max-w-md">
          <ToolChipList summary="3 library calls">
            <ToolChip icon="write" label="Edited an item" chip="Getting Started">
              <ToolChipDetail>+ Added a section on backlinks</ToolChipDetail>
              <ToolChipDetail>- Removed the stale link</ToolChipDetail>
            </ToolChip>
            <ToolChip icon="read" label="Read an item" chip="Use Cases" />
            <ToolChip icon="read" label="Searched the library" chip="2 matches">
              <ToolChipDetail>Getting Started, Use Cases</ToolChipDetail>
            </ToolChip>
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
              questionId="edit-getting-started"
              prompt="Edit Getting Started?"
              detail="The agent wants to add a section on backlinks."
            >
              <ApprovalOption optionId="allow">Approve</ApprovalOption>
              <ApprovalOption optionId="deny">Cancel</ApprovalOption>
            </ApprovalQuestion>
          </ApprovalCard>
        </div>
      </Demo>
    </GallerySection>
  );
};

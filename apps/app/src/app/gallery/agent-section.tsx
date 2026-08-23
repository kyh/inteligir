// Agent surfaces: what a turn looks like while it runs and after it settles.
// These are compound components — the demo composes children, because that is
// the API a caller writes.

import {
  ApprovalActions,
  ApprovalCard,
  ApprovalOption,
  ApprovalQuestion,
} from "@repo/ui/ai/approval-card";
import {
  ChatComposer,
  ChatMessage,
  ChatPanel,
  ChatPanelBody,
  ChatPanelHeader,
  ChatTab,
} from "@repo/ui/ai/chat";
import {
  ContextCard,
  ContextCardBody,
  ContextCardList,
  ContextCardListHeading,
  ContextCardSource,
} from "@repo/ui/ai/context-cards";
import { LoadingState } from "@repo/ui/ai/loading-state";
import {
  ConfidenceMeter,
  RecommendationAlternative,
  RecommendationAlternatives,
  RecommendationCard,
  RecommendationCardFooter,
  RecommendationCardHeader,
} from "@repo/ui/ai/recommendation-card";
import { StreamingAction, StreamingText } from "@repo/ui/ai/streaming-text";
import {
  TaskDetail,
  TaskItem,
  TaskItemDetails,
  TaskItemLabel,
  TaskItemRow,
  TaskList,
  TaskStatusLabel,
} from "@repo/ui/ai/task-rows";
import { Thinking, ThinkingReasoning, ThinkingStep, ThinkingTool } from "@repo/ui/ai/thinking";
import { ToolChip, ToolChipDetail, ToolChipList } from "@repo/ui/ai/tool-chips";
import { useState } from "react";

import { Demo, DemoCase, GallerySection } from "./gallery-chrome";

/** Fixed so the elapsed readout is stable across renders — a demo that counts
 *  up from mount would show a different number in every screenshot. */
const STARTED_AT = 0;

const ANSWER_TEXT =
  "The vault holds four notes. Two link to Welcome, and none of them are unresolved.";

export function AgentSection() {
  const [decision, setDecision] = useState<string | null>(null);

  return (
    <GallerySection id="agent" title="Agent surfaces">
      <Demo
        name="LoadingState"
        purpose="A turn is running. Elapsed counts from the turn's own start, not from mount."
      >
        <DemoCase label="drive">
          <LoadingState label="Reading the vault" variant="drive" />
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
        name="Thinking · ThinkingStep · ThinkingReasoning · ThinkingTool"
        purpose="The turn's trace, expandable. One row per thing the agent did or considered."
        stack
      >
        <div className="w-full max-w-md">
          <Thinking label="Working" doneLabel="Thought for 4s" working defaultExpanded>
            <ThinkingStep>Read Getting Started.md</ThinkingStep>
            <ThinkingReasoning>
              The link is unresolved because the target was renamed, not deleted.
            </ThinkingReasoning>
            <ThinkingTool secondary="2 matches" mono>
              grep &quot;Welcome&quot;
            </ThinkingTool>
          </Thinking>
        </div>
        <div className="w-full max-w-md">
          <Thinking label="Working" doneLabel="Thought for 4s">
            <ThinkingStep>Settled — collapsed by default once the turn is done.</ThinkingStep>
          </Thinking>
        </div>
      </Demo>

      <Demo
        name="ToolChipList · ToolChip · ToolChipDetail"
        purpose="What the turn touched: commands run, files changed. Details open per chip."
        stack
      >
        <div className="w-full max-w-md">
          <ToolChipList summary="3 files changed" defaultExpanded>
            <ToolChip icon="write" label="Edited" chip="Getting Started.md" mono>
              <ToolChipDetail tone="add">+ Added a section on backlinks</ToolChipDetail>
              <ToolChipDetail>- Removed the stale link</ToolChipDetail>
            </ToolChip>
            <ToolChip icon="read" label="Read" chip="Use Cases.md" mono />
            <ToolChip icon="run" label="Ran" chip="pnpm verify" mono detailMono>
              <ToolChipDetail>18 tasks, all green</ToolChipDetail>
            </ToolChip>
          </ToolChipList>
        </div>
      </Demo>

      <Demo
        name="TaskList · TaskItem · TaskItemRow · TaskDetail"
        purpose="The actions list: one row per agent conversation, with its lifecycle state."
        stack
      >
        <div className="w-full max-w-md">
          <TaskList variant="capsules">
            <TaskItem>
              <TaskItemRow status="running" ordinal={1}>
                <TaskItemLabel>Summarize this note in two lines</TaskItemLabel>
                <TaskStatusLabel>running</TaskStatusLabel>
              </TaskItemRow>
              <TaskItemDetails>
                <TaskDetail meta="just now">Reading Getting Started.md</TaskDetail>
              </TaskItemDetails>
            </TaskItem>
            <TaskItem>
              <TaskItemRow status="done" ordinal={2}>
                <TaskItemLabel>Add a section about backlinks</TaskItemLabel>
                <TaskStatusLabel>done</TaskStatusLabel>
              </TaskItemRow>
            </TaskItem>
            <TaskItem>
              <TaskItemRow status="failed" ordinal={3}>
                <TaskItemLabel>Rename every link to the old title</TaskItemLabel>
                <TaskStatusLabel>failed</TaskStatusLabel>
              </TaskItemRow>
            </TaskItem>
            <TaskItem>
              <TaskItemRow status="pending" ordinal={4}>
                <TaskItemLabel>Draft the release notes</TaskItemLabel>
                <TaskStatusLabel>queued</TaskStatusLabel>
              </TaskItemRow>
            </TaskItem>
          </TaskList>
        </div>
      </Demo>

      <Demo
        name="StreamingText · StreamingAction"
        purpose="The assistant's answer, with the actions that belong to it."
        note="The word-by-word reveal is off in the product — the text is already live. It is shown on here."
        stack
      >
        <div className="w-full max-w-md">
          <StreamingText text={ANSWER_TEXT} streaming={false} animate={false}>
            <StreamingAction label="Copy" />
            <StreamingAction label="Retry" />
          </StreamingText>
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
              kind="radio"
            >
              <ApprovalOption optionId="allow">Allow once</ApprovalOption>
              <ApprovalOption optionId="allow-always">Allow for this turn</ApprovalOption>
              <ApprovalOption optionId="deny">Deny</ApprovalOption>
            </ApprovalQuestion>
            <ApprovalActions />
          </ApprovalCard>
        </div>
      </Demo>

      <Demo
        name="ContextCardList · ContextCard · ContextCardSource"
        purpose="What the agent retrieved to answer with — the chunks, and where each came from."
        stack
      >
        <div className="w-full max-w-md">
          <ContextCardList>
            <ContextCardListHeading count={2}>Context</ContextCardListHeading>
            <ContextCard title="Getting Started" extent="lines 12–24">
              <ContextCardBody>
                The filename is the title, and renaming rewrites the links that point here.
              </ContextCardBody>
              <ContextCardSource kind="note">Getting Started.md</ContextCardSource>
            </ContextCard>
            <ContextCard title="Vault conventions" extent="lines 3–9">
              <ContextCardBody>
                Frontmatter is the only property store — there is no metadata table.
              </ContextCardBody>
              <ContextCardSource kind="note">Use Cases.md</ContextCardSource>
            </ContextCard>
          </ContextCardList>
        </div>
      </Demo>

      <Demo
        name="RecommendationCard · ConfidenceMeter"
        purpose="A suggestion the agent is prepared to defend, with how sure it is and what it ruled out."
        stack
      >
        <div className="w-full max-w-md">
          <RecommendationCard>
            <RecommendationCardHeader body="Both notes already link to it, and the section it needs exists.">
              Add the backlinks section to Getting Started
            </RecommendationCardHeader>
            <RecommendationAlternatives label="Considered">
              <RecommendationAlternative>Write a new note instead</RecommendationAlternative>
              <RecommendationAlternative>Leave the link unresolved</RecommendationAlternative>
            </RecommendationAlternatives>
            <RecommendationCardFooter actions={<ConfidenceMeter signal={3} strength="high" />}>
              High confidence
            </RecommendationCardFooter>
          </RecommendationCard>
        </div>
      </Demo>

      <Demo
        name="ChatPanel · ChatMessage · ChatComposer"
        purpose="A conversation with tabs — the shape a docked assistant takes when it is not the ⌘K composer."
        stack
      >
        <div className="h-80 w-full max-w-md">
          <ChatPanel>
            <ChatPanelHeader>
              <ChatTab active>Chat</ChatTab>
              <ChatTab>Sources</ChatTab>
            </ChatPanelHeader>
            <ChatPanelBody>
              <ChatMessage author="You" meta="just now">
                Which notes link to Welcome?
              </ChatMessage>
              <ChatMessage author="Agent" meta="just now" detail="Read 4 notes">
                Two: Getting Started and Kitchen Sink.
              </ChatMessage>
            </ChatPanelBody>
            <ChatComposer placeholder="Reply…" />
          </ChatPanel>
        </div>
      </Demo>
    </GallerySection>
  );
}

// Editing: surfaces that act on a selection, tune a value, or summarize a
// number the reader is about to make a decision from.

import {
  FineTuneCard,
  FineTuneMenu,
  FineTuneMenuItem,
  FineTuneSection,
  ScrubField,
  SegmentGroup,
  SegmentOption,
} from "@repo/ui/ai/fine-tune-card";
import {
  InsightCard,
  InsightCardGrid,
  InsightCardHeader,
  InsightCardMetric,
  InsightChart,
  InsightChartLegendItem,
} from "@repo/ui/ai/insight-cards";
import {
  SelectionAction,
  SelectionActions,
  SelectionActionsSeparator,
  SelectionResult,
  SelectionResultBody,
  SelectionResultFooter,
  SelectionResultHeader,
} from "@repo/ui/ai/selection-actions";
import {
  SidebarGroup,
  SidebarNavFooter,
  SidebarNavItem,
  SidebarRail,
  SidebarWorkspace,
} from "@repo/ui/ai/sidebar-nav";
import { useState } from "react";

import { Demo, GallerySection } from "./gallery-chrome";

const SERIES = [
  { id: "notes", label: "Notes indexed", points: [4, 6, 5, 9, 12, 11, 14] },
  { id: "links", label: "Links resolved", points: [2, 3, 5, 6, 6, 8, 10] },
] as const;

const TONES = ["Neutral", "Direct", "Warm"];

export function EditingSection() {
  const [temperature, setTemperature] = useState(40);
  const [tone, setTone] = useState("Neutral");

  return (
    <GallerySection id="editing" title="Editing">
      <Demo
        name="SelectionActions · SelectionResult"
        purpose="The toolbar over a selection, and the answer it returns in place."
        stack
      >
        <SelectionActions>
          <SelectionAction>Rewrite</SelectionAction>
          <SelectionAction>Summarize</SelectionAction>
          <SelectionActionsSeparator />
          <SelectionAction hasMenu>More</SelectionAction>
        </SelectionActions>
        <div className="w-full max-w-md">
          <SelectionResult>
            <SelectionResultHeader>Rewritten</SelectionResultHeader>
            <SelectionResultBody>
              The filename is the title, so renaming a note rewrites every link that points at it.
            </SelectionResultBody>
            <SelectionResultFooter>
              <SelectionAction>Replace</SelectionAction>
              <SelectionAction>Discard</SelectionAction>
            </SelectionResultFooter>
          </SelectionResult>
        </div>
      </Demo>

      <Demo
        name="FineTuneCard · ScrubField · SegmentGroup"
        purpose="Dials for a generated result — drag a number, pick a mode, run it again."
        stack
      >
        <div className="w-full max-w-sm">
          <FineTuneCard>
            <FineTuneSection label="Model">
              <ScrubField
                label="Temperature"
                value={temperature}
                onChange={setTemperature}
                min={0}
                max={100}
              />
            </FineTuneSection>
            <FineTuneSection label="Voice">
              <SegmentGroup label="Tone">
                {TONES.map((option) => (
                  <SegmentOption
                    key={option}
                    active={tone === option}
                    onClick={() => {
                      setTone(option);
                    }}
                  >
                    {option}
                  </SegmentOption>
                ))}
              </SegmentGroup>
            </FineTuneSection>
            <FineTuneMenu>
              <FineTuneMenuItem meta="⌘⏎">Run again</FineTuneMenuItem>
              <FineTuneMenuItem meta="⌘Z">Revert</FineTuneMenuItem>
            </FineTuneMenu>
          </FineTuneCard>
        </div>
      </Demo>

      <Demo
        name="InsightCardGrid · InsightCard · InsightChart"
        purpose="A number worth watching, with the line that shows how it got there."
        stack
      >
        <div className="w-full max-w-lg">
          <InsightCardGrid>
            <InsightCard>
              <InsightCardHeader>Vault</InsightCardHeader>
              <InsightCardMetric delta="+3" direction="up">
                14 notes
              </InsightCardMetric>
              <InsightChart series={SERIES} height={72} />
              <div className="flex gap-3 px-3 pb-3">
                {SERIES.map((line) => (
                  <InsightChartLegendItem key={line.id}>{line.label}</InsightChartLegendItem>
                ))}
              </div>
            </InsightCard>
            <InsightCard>
              <InsightCardHeader>Unresolved links</InsightCardHeader>
              <InsightCardMetric delta="-1" direction="down">
                1
              </InsightCardMetric>
            </InsightCard>
          </InsightCardGrid>
        </div>
      </Demo>

      <Demo
        name="SidebarRail · SidebarNavItem"
        purpose="A compact navigation rail — the collapsed shape a workspace switcher takes."
        note="Shown expanded and collapsed; `collapsed` is the caller's state, not the rail's."
      >
        <SidebarRail className="w-52">
          <SidebarWorkspace monogram="I">inteligir</SidebarWorkspace>
          <SidebarGroup label="Vault">
            <SidebarNavItem active count={14}>
              All notes
            </SidebarNavItem>
            <SidebarNavItem count={1}>Trash</SidebarNavItem>
          </SidebarGroup>
          <SidebarNavFooter>Local only</SidebarNavFooter>
        </SidebarRail>
        <SidebarRail collapsed className="w-14">
          <SidebarWorkspace monogram="I" collapsed />
          <SidebarGroup collapsed>
            <SidebarNavItem active collapsed />
            <SidebarNavItem collapsed />
          </SidebarGroup>
        </SidebarRail>
      </Demo>
    </GallerySection>
  );
}

import { type CSSProperties } from "react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@repo/ui";
import { ChevronDown, ChevronRight } from "lucide-react";

const triggerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  padding: "6px 8px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
  fontSize: 14,
  textAlign: "left",
};

export function OpenSection() {
  return (
    <div style={{ width: 320 }}>
      <Collapsible defaultOpen>
        <CollapsibleTrigger style={triggerStyle}>
          <ChevronDown size={16} />
          Research notes
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div
            className="text-muted-foreground"
            style={{ padding: "2px 8px 8px 30px", fontSize: 13, lineHeight: 1.5 }}
          >
            <p style={{ margin: 0 }}>Compared three embedding models for local vault search.</p>
            <p style={{ margin: "6px 0 0" }}>
              Next: benchmark recall against the personal notes corpus.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function ClosedTasks() {
  return (
    <div style={{ width: 320 }}>
      <Collapsible>
        <CollapsibleTrigger style={triggerStyle}>
          <ChevronRight size={16} />
          Delegated tasks (3)
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div
            className="text-muted-foreground"
            style={{ padding: "2px 8px 8px 30px", fontSize: 13, lineHeight: 1.5 }}
          >
            Hidden until expanded — summarize meeting, draft reply, tidy backlinks.
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function NoteOutline() {
  return (
    <div style={{ width: 320 }}>
      <Collapsible defaultOpen>
        <CollapsibleTrigger style={triggerStyle}>
          <ChevronDown size={16} />
          Launch checklist
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul
            style={{
              margin: 0,
              padding: "2px 8px 8px 30px",
              fontSize: 13,
              lineHeight: 1.7,
              listStyle: "none",
            }}
          >
            <li>☑ Finalize the changelog</li>
            <li>☐ Delegate release notes to agent</li>
            <li>☐ Update the pricing page</li>
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

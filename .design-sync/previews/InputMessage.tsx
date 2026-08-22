import { Badge, InputMessage } from "@repo/ui";
import { FileText } from "lucide-react";

const noop = () => {};

export function AskAgent() {
  return (
    <div style={{ maxWidth: 560 }}>
      <InputMessage
        value="Summarize this note in two lines"
        onValueChange={noop}
        placeholder="Ask the agent…"
        sendLabel="Send"
        topSlot={
          <>
            <Badge variant="outline" style={{ gap: 4 }}>
              <FileText size={12} /> Parity Test.md
            </Badge>
            <Badge variant="outline" style={{ gap: 4 }}>
              <FileText size={12} /> Welcome.md
            </Badge>
          </>
        }
      />
    </div>
  );
}

export function Empty() {
  return (
    <div style={{ maxWidth: 560 }}>
      <InputMessage
        value=""
        onValueChange={noop}
        placeholder="Ask the agent… @ mentions a note"
        sendLabel="Send"
        minRows={2}
      />
    </div>
  );
}

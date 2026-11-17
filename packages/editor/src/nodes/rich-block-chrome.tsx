// A rich block's shell: its card, the editors over its payload and the view of what it parses to.
// Degrading never touches bytes: the fence value stays verbatim on the node; only the presentation changes.

import { useState } from "react";
import type { ReactNode } from "react";
import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";

import { cn } from "@repo/ui/lib/cn";

import { useFrozen } from "@repo/editor/kits/rich-block-lock-kit";
import { stringProp } from "@repo/editor/headless/node-props";

// what a block's fence value reads as: its payload, or why it stays code
export type Parse<T> = { ok: true; payload: T } | { ok: false; reason: string };

// the actions wait for a hover, which a finger never makes, so a coarse pointer shows them outright
const RichBlockCard = ({
  actions,
  children,
  label,
}: {
  label: string;
  actions: ReactNode;
  children: ReactNode;
}) => (
  <div
    contentEditable={false}
    className="group/richblock relative my-2 rounded-md border border-border bg-muted/20"
  >
    <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1">
      <span className="font-mono text-caption tracking-wide text-muted-foreground uppercase select-none">
        {label}
      </span>
      <span className="flex-1" />
      <span className="flex items-center gap-2 opacity-0 transition-opacity group-hover/richblock:opacity-100 pointer-coarse:opacity-100">
        {actions}
      </span>
    </div>
    {children}
  </div>
);

// Outside the editable, so the browser types nothing into a locked container's blocks; a caret a
// tap leaves there has its keystrokes refused by the lock, and its model guard refuses whatever
// edit arrives some other way.
export const LockedContent = ({
  children,
  locked,
}: {
  children: ReactNode;
  locked: boolean;
}): ReactNode => (locked ? <div contentEditable={false}>{children}</div> : children);

export const DegradedPayloadView = ({ reason, value }: { reason: string; value: string }) => (
  <div>
    <p className="px-2 pt-1 text-body text-amber-600 dark:text-amber-500">{reason}</p>
    <pre className="overflow-x-auto px-3 py-2 font-mono text-body whitespace-pre text-muted-foreground">
      {value}
    </pre>
  </div>
);

const PayloadEditor = ({
  initial,
  onCancel,
  onSave,
  validate,
}: {
  initial: string;
  onCancel: () => void;
  validate: (value: string) => string | null;
  onSave: (value: string) => void;
}) => {
  const [value, setValue] = useState(initial);
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <div className="p-2">
      <textarea
        aria-label="Block payload"
        value={value}
        rows={Math.min(16, Math.max(4, value.split("\n").length + 1))}
        spellCheck={false}
        className={cn(
          "w-full resize-y rounded-md border bg-background p-2 font-mono text-body",
          refusal === null ? "border-border" : "border-destructive",
        )}
        onChange={(event) => {
          setValue(event.target.value);
          setRefusal(null);
        }}
      />
      {refusal === null ? null : <p className="pt-1 text-body text-destructive">{refusal}</p>}
      <div className="flex justify-end gap-2 pt-1.5">
        <button
          type="button"
          className="rounded-md px-2 py-0.5 text-body text-muted-foreground hover:text-foreground"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded-md bg-primary px-2 py-0.5 text-body text-primary-foreground"
          onClick={() => {
            const verdict = validate(value);
            if (verdict === null) {
              onSave(value);
            } else {
              setRefusal(verdict);
            }
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
};

const HeaderAction = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    className="text-body text-muted-foreground hover:text-foreground"
    onClick={onClick}
  >
    {label}
  </button>
);

// view: what the payload parses to. structured: the block's own editor over the parsed payload.
// raw: the payload's text, which is all a payload that does not parse can be edited as.
type Mode = "view" | "structured" | "raw";

interface RichBlockSpec<T> {
  label: string;
  parse: (value: string) => Parse<T>;
  renderView: (payload: T) => ReactNode;
  // what the header says of a payload that parses, in the label's place
  titleOf?: (payload: T) => string | undefined;
  // the view's own actions, which change nothing in the note
  viewActions?: ReactNode;
  structured?: {
    // names the button that opens it
    label: string;
    renderEditor: (payload: T, write: (value: string) => void, value: string) => ReactNode;
  };
}

export const RichBlock = <T,>({
  label,
  parse,
  renderView,
  structured,
  titleOf,
  viewActions,
  ...props
}: PlateElementProps & RichBlockSpec<T>) => {
  const [mode, setMode] = useState<Mode>("view");
  const frozen = useFrozen();
  const value = stringProp(props.element, "value") ?? "";
  const parsed = parse(value);
  // a block that takes no edit draws its view, whichever editor it had open
  const shown = frozen ? "view" : mode;
  const toView = (): void => {
    setMode("view");
  };
  // an ordinary transaction, so the change rides the item's next write like typing
  const write = (next: string): void => {
    const path = props.editor.api.findPath(props.element);
    if (path !== undefined) {
      props.editor.tf.setNodes({ value: next }, { at: path });
    }
  };

  const body = (): ReactNode => {
    if (shown === "raw") {
      return (
        <PayloadEditor
          initial={value}
          validate={(next) => {
            const verdict = parse(next);
            return verdict.ok ? null : verdict.reason;
          }}
          onCancel={toView}
          onSave={(next) => {
            write(next);
            toView();
          }}
        />
      );
    }
    if (!parsed.ok) {
      return <DegradedPayloadView reason={parsed.reason} value={value} />;
    }
    return shown === "structured" && structured !== undefined
      ? structured.renderEditor(parsed.payload, write, value)
      : renderView(parsed.payload);
  };

  return (
    <PlateElement {...props}>
      <RichBlockCard
        label={(parsed.ok ? titleOf?.(parsed.payload) : undefined) ?? label}
        actions={
          <>
            {shown === "view" ? viewActions : null}
            {shown === "view" && !frozen && structured !== undefined && parsed.ok ? (
              <HeaderAction
                label={structured.label}
                onClick={() => {
                  setMode("structured");
                }}
              />
            ) : null}
            {shown === "raw" || frozen ? null : (
              <HeaderAction
                label="Edit payload"
                onClick={() => {
                  setMode("raw");
                }}
              />
            )}
            {shown === "structured" ? <HeaderAction label="Done" onClick={toView} /> : null}
          </>
        }
      >
        {body()}
      </RichBlockCard>
      {props.children}
    </PlateElement>
  );
};

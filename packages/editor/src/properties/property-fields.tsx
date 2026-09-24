import { useId, useState } from "react";
import type { KeyboardEvent } from "react";
import { XIcon } from "lucide-react";

import { isTagName } from "@repo/notes/knowledge/tag-grammar";
import { TAGS_KEY } from "@repo/notes/markdown/frontmatter";
import type { TypedProperty } from "@repo/notes/markdown/frontmatter";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";
import { isImeComposing } from "@repo/ui/lib/ime";

const FIELD_CLASS =
  "h-7 border-transparent bg-transparent px-1.5 text-body shadow-none hover:bg-hover focus-visible:bg-card focus-visible:ring-1";

// buffered so the document isn't re-serialized on every keystroke.
const useBuffer = (value: string, commit: (next: string) => void) => {
  const [local, setLocal] = useState(value);
  // a new `value` from the document wins over the buffer; re-key during render (not in an
  // effect) so the field never paints a frame of the previous property's text.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setLocal(value);
  }
  return {
    onBlur: () => {
      if (local !== value) {
        commit(local);
      }
    },
    onChange: (e: { target: { value: string } }) => {
      setLocal(e.target.value);
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (isImeComposing(e)) {
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.currentTarget.blur();
      } else if (e.key === "Escape") {
        setLocal(value);
        e.currentTarget.blur();
      }
    },
    value: local,
  };
};

export const TextField = ({
  prop,
  onChange,
}: {
  prop: Extract<TypedProperty, { type: "text" | "date" }>;
  onChange: (next: TypedProperty) => void;
}) => {
  const buffer = useBuffer(prop.value, (value) => {
    onChange({ ...prop, value });
  });
  return (
    <Input
      {...buffer}
      spellCheck={false}
      placeholder={prop.type === "date" ? "YYYY-MM-DD" : "Empty"}
      className={FIELD_CLASS}
      aria-label={prop.key}
    />
  );
};

export const NumberField = ({
  prop,
  onChange,
}: {
  prop: Extract<TypedProperty, { type: "number" }>;
  onChange: (next: TypedProperty) => void;
}) => {
  const buffer = useBuffer(String(prop.value), (raw) => {
    const value = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(value)) {
      onChange({ ...prop, value });
    }
  });
  return <Input {...buffer} type="number" className={FIELD_CLASS} aria-label={prop.key} />;
};

export const CheckboxField = ({
  prop,
  onChange,
}: {
  prop: Extract<TypedProperty, { type: "checkbox" }>;
  onChange: (next: TypedProperty) => void;
}) => (
  <div className="flex h-7 items-center px-1.5">
    <Checkbox
      checked={prop.value}
      onCheckedChange={(value) => {
        onChange({ ...prop, value });
      }}
      aria-label={prop.key}
    />
  </div>
);

export const TagsField = ({
  prop,
  onChange,
}: {
  prop: Extract<TypedProperty, { type: "tags" }>;
  onChange: (next: TypedProperty) => void;
}) => {
  const [draft, setDraft] = useState("");
  const [refused, setRefused] = useState(false);
  const hintId = useId();
  // the index reads a `tags` entry only when an inline `#` could spell it, so the panel writes
  // no other; any other list key holds free text
  const isTagList = prop.key === TAGS_KEY;
  const commitTag = () => {
    const tag = isTagList ? draft.trim().replace(/^#/u, "") : draft.trim();
    if (tag === "" || prop.value.includes(tag)) {
      setDraft("");
      setRefused(false);
      return;
    }
    if (isTagList && !isTagName(tag)) {
      setRefused(true);
      return;
    }
    onChange({ ...prop, value: [...prop.value, tag] });
    setDraft("");
  };
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-1 px-1.5 py-0.5">
      {prop.value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 rounded-[6px] bg-muted px-1.5 py-0.5 text-caption text-foreground"
        >
          {tag}
          <Tooltip content={`Remove ${tag}`}>
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => {
                onChange({ ...prop, value: prop.value.filter((t) => t !== tag) });
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </Tooltip>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setRefused(false);
        }}
        onBlur={commitTag}
        onKeyDown={(e) => {
          if (isImeComposing(e)) {
            return;
          }
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commitTag();
          } else if (e.key === "Backspace" && draft === "" && prop.value.length > 0) {
            onChange({ ...prop, value: prop.value.slice(0, -1) });
          }
        }}
        placeholder={prop.value.length === 0 ? "Add tag" : ""}
        aria-label={`${prop.key} tags`}
        aria-invalid={refused || undefined}
        aria-describedby={refused ? hintId : undefined}
        className="min-w-16 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground/60 aria-invalid:text-destructive"
      />
      {refused ? (
        <p id={hintId} className="basis-full text-body text-destructive">
          A tag starts with a letter and holds only letters, digits, -, _ and /.
        </p>
      ) : null}
    </div>
  );
};

export const UnsupportedField = ({
  prop,
}: {
  prop: Extract<TypedProperty, { type: "unsupported" }>;
}) => (
  <div className="flex min-h-7 items-center px-1.5">
    <pre
      title="Unsupported YAML — preserved byte-for-byte."
      className={cn(
        "max-w-full overflow-x-auto rounded-[6px] bg-muted/60 px-1.5 py-0.5",
        "font-mono text-body whitespace-pre text-muted-foreground",
      )}
    >
      {prop.rawYaml === "" ? "—" : prop.rawYaml}
    </pre>
  </div>
);

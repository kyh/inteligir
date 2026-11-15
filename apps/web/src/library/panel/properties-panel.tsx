import type { PropertyOp } from "@repo/contract/library/field-ops";
import type { PropertyValue } from "@repo/contract/library/library-item";
import type { TypedProperty } from "@repo/editor/markdown/frontmatter";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@repo/ui/components/radio-group";
import { isImeComposing } from "@repo/ui/lib/ime";
import { PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { ComponentProps, KeyboardEvent } from "react";

import { nameRefusal, propertyOp, rowsOf } from "./item-properties";
import type { Properties } from "./item-properties";
import { CheckboxField, HELD, LineField, TagsField, UnsupportedField } from "./property-fields";
import type { PropertyKind } from "./property-fields";

const Field = ({
  prop,
  onCommit,
}: {
  prop: TypedProperty;
  onCommit: (value: PropertyValue) => void;
}) => {
  switch (prop.type) {
    case "checkbox": {
      return <CheckboxField label={prop.key} value={prop.value} onCommit={onCommit} />;
    }
    case "tags": {
      return <TagsField label={prop.key} value={prop.value} onCommit={onCommit} />;
    }
    case "unsupported": {
      return <UnsupportedField raw={prop.raw} />;
    }
    case "number": {
      return <LineField label={prop.key} type="number" value={prop.value} onCommit={onCommit} />;
    }
    case "text":
    case "date": {
      return <LineField label={prop.key} type={prop.type} value={prop.value} onCommit={onCommit} />;
    }
    default: {
      const exhaustive: never = prop;
      return exhaustive;
    }
  }
};

const PropertyRow = ({
  prop,
  onCommit,
  onRemove,
}: {
  prop: TypedProperty;
  onCommit: (value: PropertyValue) => void;
  onRemove: () => void;
}) => (
  <div className="group grid grid-cols-[9rem_1fr] items-start gap-2">
    <span className="truncate pt-1 text-body text-muted-foreground" title={prop.key}>
      {prop.key}
    </span>
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <Field prop={prop} onCommit={onCommit} />
      </div>
      <button
        type="button"
        aria-label={`Remove ${prop.key}`}
        onClick={onRemove}
        className="mt-1 rounded-[4px] px-1 text-body text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        Remove
      </button>
    </div>
  </div>
);

const KINDS = [
  { kind: "text", label: "Text" },
  { kind: "number", label: "Number" },
  { kind: "checkbox", label: "Checkbox" },
  { kind: "date", label: "Date" },
  { kind: "tags", label: "List" },
] as const satisfies readonly { kind: PropertyKind; label: string }[];

// the one-line control each type's value is typed into; a checkbox is its own
const VALUE_INPUT = {
  date: { required: true, type: "date" },
  number: { placeholder: "Value", required: true, step: "any", type: "number" },
  tags: { placeholder: "One, two" },
  text: { placeholder: "Value" },
} satisfies Record<Exclude<PropertyKind, "checkbox">, ComponentProps<"input">>;

const ADD_INPUT_CLASS = "h-7 px-1.5 text-body";

// A new property: its name, its type and that type's control, so the value written is the type
// picked and never one read into what was typed. A submit either adds and closes or stays open
// saying why: the browser for a number or a date left empty, the form for a name already taken.
const AddForm = ({
  refuse,
  onAdd,
  onCancel,
}: {
  refuse: (name: string) => string | null;
  onAdd: (name: string, value: PropertyValue) => void;
  onCancel: () => void;
}) => {
  const [kind, setKind] = useState<PropertyKind>("text");
  const [refusal, setRefusal] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const valueInput = useRef<HTMLInputElement>(null);

  const cancelOnEscape = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && !isImeComposing(event)) {
      onCancel();
    }
  };

  return (
    <form
      className="flex flex-col gap-1.5 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        const name = nameInput.current?.value.trim() ?? "";
        const value = valueInput.current === null ? null : HELD[kind](valueInput.current);
        if (name === "" || value === null) {
          return;
        }
        const refused = refuse(name);
        setRefusal(refused);
        if (refused === null) {
          onAdd(name, value);
        }
      }}
    >
      <RadioGroup<PropertyKind>
        aria-label="Type"
        value={kind}
        onValueChange={setKind}
        className="flex-wrap"
      >
        {KINDS.map((option) => (
          <RadioGroupItem key={option.kind} value={option.kind} className="px-2 py-0.5 text-body">
            {option.label}
          </RadioGroupItem>
        ))}
      </RadioGroup>
      <div className="grid grid-cols-[9rem_1fr] items-center gap-2">
        <Input
          ref={nameInput}
          autoFocus
          required
          onChange={() => {
            setRefusal(null);
          }}
          onKeyDown={cancelOnEscape}
          placeholder="Property"
          aria-label="Name"
          aria-invalid={refusal !== null || undefined}
          spellCheck={false}
          className={ADD_INPUT_CLASS}
        />
        {kind === "checkbox" ? (
          <div className="flex h-7 items-center px-1.5">
            <Checkbox inputRef={valueInput} aria-label="Value" />
          </div>
        ) : (
          <Input
            key={kind}
            ref={valueInput}
            onKeyDown={cancelOnEscape}
            aria-label="Value"
            spellCheck={false}
            className={ADD_INPUT_CLASS}
            {...VALUE_INPUT[kind]}
          />
        )}
      </div>
      {refusal === null ? null : (
        <p role="alert" className="m-0 text-body text-destructive">
          {refusal}
        </p>
      )}
      <div className="flex gap-1">
        <Button type="submit" variant="secondary">
          Add
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

// an item's properties as rows, each edited in place, and every edit handed back as one op
export const PropertiesPanel = ({
  properties,
  onWrite,
}: {
  properties: Properties;
  onWrite: (op: PropertyOp) => void;
}) => {
  const [adding, setAdding] = useState(false);
  const write = (key: string, value?: PropertyValue) => {
    onWrite(propertyOp(properties, key, value));
  };
  return (
    <div className="flex flex-col gap-0.5">
      {rowsOf(properties).map((prop) => (
        <PropertyRow
          key={prop.key}
          prop={prop}
          onCommit={(value) => {
            write(prop.key, value);
          }}
          onRemove={() => {
            write(prop.key);
          }}
        />
      ))}
      {adding ? (
        <AddForm
          refuse={(name) => nameRefusal(properties, name)}
          onAdd={(name, value) => {
            write(name, value);
            setAdding(false);
          }}
          onCancel={() => {
            setAdding(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
          }}
          className="flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-body text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          <PlusIcon className="size-3.5" />
          Add property
        </button>
      )}
    </div>
  );
};

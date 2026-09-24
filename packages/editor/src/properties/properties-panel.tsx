import { useMemo, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent } from "react";
import { PlusIcon } from "lucide-react";
import type { SlateEditor } from "platejs";

import {
  parseProperties,
  serializeProperties,
  typeNewProperty,
} from "@repo/notes/markdown/frontmatter";
import type {
  ParsedProperties,
  PropertyType,
  TypedProperty,
} from "@repo/notes/markdown/frontmatter";
import { Input } from "@repo/ui/components/input";

import { subscribeLiveEditors } from "@repo/editor/live-editor";
import { readFrontmatterRaw, writeFrontmatterRaw } from "@repo/editor/properties/properties-node";
import {
  CheckboxField,
  NumberField,
  TagsField,
  TextField,
  UnsupportedField,
} from "@repo/editor/properties/property-fields";

// only strings are ambiguous (text and date serialize identically); overrides are session-only.
const overrideOptions = (prop: TypedProperty): PropertyType[] =>
  prop.type === "text" || prop.type === "date" ? ["text", "date"] : [prop.type];

const TYPE_LABEL = {
  checkbox: "Checkbox",
  date: "Date",
  number: "Number",
  tags: "Tags",
  text: "Text",
  unsupported: "Unsupported",
} satisfies Record<PropertyType, string>;

const Field = ({
  prop,
  onChange,
}: {
  prop: TypedProperty;
  onChange: (next: TypedProperty) => void;
}) => {
  switch (prop.type) {
    case "checkbox": {
      return <CheckboxField prop={prop} onChange={onChange} />;
    }
    case "number": {
      return <NumberField prop={prop} onChange={onChange} />;
    }
    case "tags": {
      return <TagsField prop={prop} onChange={onChange} />;
    }
    case "unsupported": {
      return <UnsupportedField prop={prop} />;
    }
    case "text":
    case "date": {
      return <TextField prop={prop} onChange={onChange} />;
    }
    default: {
      const exhaustive: never = prop;
      return exhaustive;
    }
  }
};

const PropertyRow = ({
  prop,
  onChange,
  onDelete,
  onOverrideType,
}: {
  prop: TypedProperty;
  onChange: (next: TypedProperty) => void;
  onDelete: () => void;
  onOverrideType: (type: PropertyType) => void;
}) => {
  const options = overrideOptions(prop);
  return (
    <div className="group grid grid-cols-[9rem_1fr] items-start gap-2">
      <div className="flex flex-col gap-0.5 pt-1">
        <span className="truncate text-body text-muted-foreground" title={prop.key}>
          {prop.key}
        </span>
        {options.length > 1 && (
          <select
            value={prop.type}
            onChange={(e) => {
              const type = e.target.value;
              if (type === "text" || type === "date") {
                onOverrideType(type);
              }
            }}
            aria-label={`${prop.key} type`}
            className="w-fit rounded-[4px] bg-transparent text-caption text-muted-foreground/70 outline-none hover:text-foreground"
          >
            {options.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <Field prop={prop} onChange={onChange} />
        </div>
        <button
          type="button"
          aria-label={`Remove ${prop.key}`}
          onClick={onDelete}
          className="mt-1 rounded-[4px] px-1 text-body text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        >
          Remove
        </button>
      </div>
    </div>
  );
};

const AddProperty = ({ onAdd }: { onAdd: (key: string, value: string) => void }) => {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const reset = () => {
    setOpen(false);
    setKey("");
    setValue("");
  };
  const submit = () => {
    const trimmed = key.trim();
    if (trimmed === "") {
      reset();
      return;
    }
    onAdd(trimmed, value);
    reset();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      reset();
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-body text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      >
        <PlusIcon className="size-3.5" />
        Add property
      </button>
    );
  }
  return (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-2">
      <Input
        autoFocus
        value={key}
        onChange={(e) => {
          setKey(e.target.value);
        }}
        onKeyDown={onKeyDown}
        placeholder="Property"
        spellCheck={false}
        className="h-7 px-1.5 text-body"
      />
      <Input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={submit}
        placeholder="Value"
        spellCheck={false}
        className="h-7 px-1.5 text-body"
      />
    </div>
  );
};

// one row's change, applied to the frontmatter as it stands when the edit lands rather than to
// the list the render drew: a pin, an undo or the previous edit may have moved it since
type PropertyEdit =
  | { readonly kind: "set"; readonly prop: TypedProperty }
  | { readonly kind: "remove"; readonly key: string }
  | { readonly kind: "add"; readonly prop: TypedProperty };

const hasKey = (properties: readonly TypedProperty[], key: string): boolean =>
  properties.some((p) => p.key === key);

// null when the edit no longer applies: its row is gone, or the key it adds exists (a duplicate
// key would make the whole block invalid)
const applyEdit = (
  properties: readonly TypedProperty[],
  edit: PropertyEdit,
): TypedProperty[] | null => {
  switch (edit.kind) {
    case "set": {
      return hasKey(properties, edit.prop.key)
        ? properties.map((p) => (p.key === edit.prop.key ? edit.prop : p))
        : null;
    }
    case "remove": {
      return hasKey(properties, edit.key) ? properties.filter((p) => p.key !== edit.key) : null;
    }
    case "add": {
      return hasKey(properties, edit.prop.key) ? null : [...properties, edit.prop];
    }
    default: {
      const exhaustive: never = edit;
      return exhaustive;
    }
  }
};

export const PropertiesPanel = ({ editor }: { editor: SlateEditor }) => {
  // outside the Plate tree, so no useEditorSelector: the live-editor channel carries its edits
  const raw = useSyncExternalStore(subscribeLiveEditors, () => readFrontmatterRaw(editor));
  const parsed = useMemo<ParsedProperties | null>(
    () => (raw === null ? null : parseProperties(raw)),
    [raw],
  );
  const [overrides, setOverrides] = useState<Record<string, PropertyType>>({});

  const properties = parsed?.kind === "valid" ? parsed.properties : [];
  const invalid = parsed?.kind === "invalid";

  const commit = (edit: PropertyEdit) => {
    const current = readFrontmatterRaw(editor) ?? "";
    const fresh = parseProperties(current);
    if (fresh.kind === "invalid") {
      return;
    }
    const next = applyEdit(fresh.kind === "valid" ? fresh.properties : [], edit);
    if (next !== null) {
      writeFrontmatterRaw(editor, serializeProperties(next, current));
    }
  };

  const applyOverride = (prop: TypedProperty): TypedProperty => {
    const forced = overrides[prop.key];
    if (forced === undefined || forced === prop.type) {
      return prop;
    }
    if (
      (prop.type === "text" || prop.type === "date") &&
      (forced === "text" || forced === "date")
    ) {
      return { key: prop.key, type: forced, value: prop.value };
    }
    return prop;
  };

  const handleAdd = (key: string, value: string) => {
    commit({ kind: "add", prop: typeNewProperty(key, value) });
  };

  if (invalid) {
    return (
      <p className="rounded-[8px] bg-muted/50 px-2.5 py-1.5 text-body text-muted-foreground">
        Properties unavailable — this note&rsquo;s frontmatter isn&rsquo;t a valid property list.
        It&rsquo;s preserved untouched; edit it in the document.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {properties.map((prop) => {
        const shown = applyOverride(prop);
        return (
          <PropertyRow
            key={prop.key}
            prop={shown}
            onChange={(nextProp) => {
              commit({ kind: "set", prop: nextProp });
            }}
            onDelete={() => {
              commit({ key: prop.key, kind: "remove" });
            }}
            onOverrideType={(type) => {
              setOverrides((prev) => ({ ...prev, [prop.key]: type }));
            }}
          />
        );
      })}
      <AddProperty onAdd={handleAdd} />
    </div>
  );
};

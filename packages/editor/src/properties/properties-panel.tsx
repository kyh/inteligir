import { useMemo, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent } from "react";
import { PlusIcon } from "lucide-react";

import { typeNewProperty } from "@repo/notes/markdown/frontmatter";
import type { PropertyType, TypedProperty } from "@repo/notes/markdown/frontmatter";
import { Input } from "@repo/ui/components/input";
import { isImeComposing } from "@repo/ui/lib/ime";

import type { PropertyEdit, PropertySource } from "@repo/editor/properties/property-source";
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
    if (isImeComposing(e)) {
      return;
    }
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

// the rows a source holds, each editable in place
export const PropertiesPanel = <S,>({ source }: { source: PropertySource<S> }) => {
  const snapshot = useSyncExternalStore(source.subscribe, source.snapshot);
  const properties = useMemo(() => source.read(snapshot), [source, snapshot]);
  const [overrides, setOverrides] = useState<Record<string, PropertyType>>({});

  const commit = (edit: PropertyEdit) => {
    source.commit(edit);
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

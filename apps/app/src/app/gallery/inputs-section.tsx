// Inputs: everything that takes something from the reader.

import { Checkbox, CheckboxGroup, CheckboxItem } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@repo/ui/components/input-group";
import { InputMessage } from "@repo/ui/components/input-message";
import { Label } from "@repo/ui/components/label";
import {
  PromptBar,
  PromptBarAction,
  PromptBarField,
  PromptBarSend,
  PromptBarSource,
  PromptBarSources,
  PromptBarToolbar,
} from "@repo/ui/ai/prompt-bar";
import { Switch } from "@repo/ui/components/switch";
import { Textarea } from "@repo/ui/components/textarea";
import { SearchIcon } from "lucide-react";
import { useState } from "react";

import { Demo, DemoCase, GallerySection } from "./gallery-chrome";

/** The group's rows are addressed by INDEX (the panel owns roving focus), so
 *  the labels live in one ordered list rather than beside each item. */
const PANEL_ROWS = ["Show backlinks", "Show related notes", "Show properties"];

/** The pinned-state demos are deliberately inert — they show a state, not a
 *  control the reader is meant to change. */
const noop = (): void => undefined;

export function InputsSection() {
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [picked, setPicked] = useState<Set<number>>(new Set([0]));
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");

  return (
    <GallerySection id="inputs" title="Inputs">
      <Demo name="Input · Label" purpose="One line of text, with the label that names it." stack>
        <div className="w-72 space-y-1.5">
          <Label htmlFor="gallery-title">Note title</Label>
          <Input id="gallery-title" defaultValue="Release checklist" />
        </div>
        <div className="w-72 space-y-1.5">
          <Label htmlFor="gallery-disabled">Vault location</Label>
          <Input id="gallery-disabled" defaultValue="~/notes" disabled />
        </div>
      </Demo>

      <Demo
        name="Textarea"
        purpose="Several lines of text, where the length is the reader's call."
        stack
      >
        <Textarea
          className="w-72"
          rows={3}
          defaultValue={"Ship the parity wave.\nThen re-read the decision record."}
        />
      </Demo>

      <Demo
        name="InputGroup"
        purpose="An input wearing attachments — an icon, a unit, or a button that acts on its value."
        stack
      >
        <InputGroup className="w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search notes" />
        </InputGroup>
        <InputGroup className="w-72">
          <InputGroupInput placeholder="Auto-commit every" defaultValue="30" />
          <InputGroupAddon align="inline-end">
            <InputGroupText>seconds</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        <InputGroup className="w-72">
          <InputGroupInput placeholder="Git remote" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton>Test</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Demo>

      <Demo name="Checkbox" purpose="One independent yes/no.">
        <DemoCase label="checked">
          <Checkbox checked={checked} onCheckedChange={setChecked} />
        </DemoCase>
        <DemoCase label="unchecked">
          <Checkbox checked={false} />
        </DemoCase>
        <DemoCase label="disabled">
          <Checkbox checked disabled />
        </DemoCase>
      </Demo>

      <Demo
        name="CheckboxGroup · CheckboxItem"
        purpose="Several yes/nos that belong together, sharing one value."
        stack
      >
        <CheckboxGroup checkedIndices={picked}>
          {PANEL_ROWS.map((label, index) => (
            <CheckboxItem
              key={label}
              index={index}
              label={label}
              checked={picked.has(index)}
              onToggle={() => {
                setPicked((prior) => {
                  const next = new Set(prior);
                  if (next.has(index)) next.delete(index);
                  else next.add(index);
                  return next;
                });
              }}
            />
          ))}
        </CheckboxGroup>
      </Demo>

      <Demo name="Switch" purpose="Flips a setting that takes effect immediately.">
        <DemoCase label="on">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </DemoCase>
        <DemoCase label="off">
          <Switch checked={false} onCheckedChange={noop} />
        </DemoCase>
        <DemoCase label="disabled">
          <Switch checked disabled onCheckedChange={noop} />
        </DemoCase>
      </Demo>

      <Demo
        name="InputMessage"
        purpose="The ask-an-agent composer: a growing field with slots either side of the send."
        note={sent === null ? undefined : `Last send: ${sent}`}
        stack
      >
        <div className="w-full max-w-xl">
          <InputMessage
            value={message}
            onValueChange={setMessage}
            placeholder="Ask the agent…"
            minRows={2}
            maxRows={8}
            sendLabel="Send"
            onSend={(value) => {
              setSent(value);
              setMessage("");
            }}
          />
        </div>
      </Demo>
      <Demo
        name="PromptBar · PromptBarSources · PromptBarToolbar"
        purpose="The other composer shape: context chips above, a toolbar of controls below the field."
        note="Not the product's ⌘K composer — that one is InputMessage. Shown because both ship."
        stack
      >
        <div className="w-full max-w-xl">
          <PromptBar>
            <PromptBarSources>
              <PromptBarSource onRemove={() => undefined}>Getting Started.md</PromptBarSource>
              <PromptBarSource onRemove={() => undefined}>Use Cases.md</PromptBarSource>
            </PromptBarSources>
            <PromptBarField
              value={prompt}
              placeholder="Ask about these notes…"
              onChange={(event) => {
                setPrompt(event.target.value);
              }}
              onSend={() => {
                setPrompt("");
              }}
            />
            <PromptBarToolbar>
              <PromptBarAction label="Attach">@</PromptBarAction>
              <PromptBarAction label="Commands">/</PromptBarAction>
              <PromptBarSend
                onClick={() => {
                  setPrompt("");
                }}
              />
            </PromptBarToolbar>
          </PromptBar>
        </div>
      </Demo>
    </GallerySection>
  );
}

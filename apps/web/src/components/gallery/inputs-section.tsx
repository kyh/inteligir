import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import { InputField, InputGroup } from "@repo/ui/components/input-group";
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
import { MailIcon, SearchIcon, UserIcon } from "lucide-react";
import { useState } from "react";

import { Demo, DemoCase, GallerySection } from "./gallery-chrome";

const noop = (): void => undefined;

export const InputsSection = () => {
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [vaultName, setVaultName] = useState("Second brain");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("not-an-address");
  const [needle, setNeedle] = useState("");

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
        name="InputGroup · InputField"
        purpose="A stack of labelled fields the pointer travels between — the nearest one lifts its fill, its ring, its label and its icon together."
        stack
      >
        <InputGroup>
          <InputField
            index={0}
            label="Vault name"
            placeholder="What to call it"
            value={vaultName}
            onChange={setVaultName}
          />
        </InputGroup>
        <InputGroup>
          <InputField
            index={0}
            label="Name"
            icon={UserIcon}
            placeholder="Who owns the vault"
            value={ownerName}
            onChange={setOwnerName}
          />
          <InputField
            index={1}
            label="Email"
            icon={MailIcon}
            placeholder="name@example.com"
            value={ownerEmail}
            onChange={setOwnerEmail}
            error={ownerEmail.includes("@") ? undefined : "That is not an email address."}
          />
        </InputGroup>
        <InputGroup size="compact">
          <InputField
            index={0}
            label="Search notes"
            labelHidden
            icon={SearchIcon}
            placeholder="Search notes"
            value={needle}
            onChange={setNeedle}
          />
          <InputField
            index={1}
            label="Replace with"
            labelHidden
            placeholder="Replace with…"
            value=""
            onChange={noop}
            disabled
          />
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
              <PromptBarSource onRemove={noop}>Getting Started.md</PromptBarSource>
              <PromptBarSource onRemove={noop}>Use Cases.md</PromptBarSource>
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
};

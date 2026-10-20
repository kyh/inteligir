import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import { InputMessage } from "@repo/ui/components/input-message";
import { Label } from "@repo/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@repo/ui/components/radio-group";
import { Switch } from "@repo/ui/components/switch";
import { Textarea } from "@repo/ui/components/textarea";
import { useState } from "react";

import { Demo, DemoCase, GallerySection } from "./gallery-chrome";

const noop = (): void => undefined;

type Transport = "http" | "stdio" | "oauth";

export const InputsSection = () => {
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [transport, setTransport] = useState<Transport>("http");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<string | null>(null);

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
        name="RadioGroup · RadioGroupItem"
        purpose="One of a few choices, all on screen at once; one tab stop, the arrows move it."
      >
        <DemoCase label="live">
          <RadioGroup aria-label="Transport" value={transport} onValueChange={setTransport}>
            <RadioGroupItem value="http">URL</RadioGroupItem>
            <RadioGroupItem value="stdio">Command</RadioGroupItem>
            <RadioGroupItem value="oauth">OAuth</RadioGroupItem>
          </RadioGroup>
        </DemoCase>
        <DemoCase label="disabled">
          <RadioGroup aria-label="Theme" value="system" disabled>
            <RadioGroupItem value="system">System</RadioGroupItem>
            <RadioGroupItem value="light">Light</RadioGroupItem>
            <RadioGroupItem value="dark">Dark</RadioGroupItem>
          </RadioGroup>
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
    </GallerySection>
  );
};

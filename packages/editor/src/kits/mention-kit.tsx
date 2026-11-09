import { KEYS } from "platejs";
import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { MentionInputPlugin, MentionPlugin } from "@platejs/mention/react";

import { MentionChip } from "@repo/editor/mention/mention-chip";
import { MentionInputElement } from "@repo/editor/mention/mention-input";
import { stringProp } from "@repo/editor/node-props";

const MentionElement = (props: PlateElementProps) => {
  const itemId = stringProp(props.element, "key") ?? "";
  const title = stringProp(props.element, "value") ?? "";
  return (
    <PlateElement {...props} as="span" className="inline-block">
      <span contentEditable={false}>
        <MentionChip itemId={itemId} title={title} />
      </span>
      {props.children}
    </PlateElement>
  );
};

// A page link opens on `[[`: the second `[` opens Plate's mention input, the first stays typed
// until a pick takes it, and an `@` stays the character typed.
export const MentionKit = [
  MentionPlugin.configure({
    options: {
      trigger: "[",
      triggerPreviousCharPattern: /^\[$/u,
      triggerQuery: (editor) =>
        !editor.api.some({ match: { type: editor.getType(KEYS.codeBlock) } }),
    },
  }).withComponent(MentionElement),
  MentionInputPlugin.withComponent(MentionInputElement),
];

// The chip is lazy: it reaches the editor host seam, and an eager import from a file base-kit
// composes closes an import cycle.

import { Suspense, lazy } from "react";
import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { MentionPlugin } from "@platejs/mention/react";

import { shownTitle } from "@repo/contract/items/item-name";
import { stringProp } from "@repo/editor/node-props";

const WikiChip = lazy(async () => await import("@repo/editor/wiki/wiki-chip"));

const FallbackChip = ({ title }: { title: string }) => (
  <span
    contentEditable={false}
    className="cursor-default rounded-sm bg-primary/10 px-1 text-primary/80"
  >
    {shownTitle(title)}
  </span>
);

const MentionElement = (props: PlateElementProps) => {
  const itemId = stringProp(props.element, "key") ?? "";
  const title = stringProp(props.element, "value") ?? "";
  return (
    <PlateElement {...props} as="span" className="inline-block">
      <span contentEditable={false}>
        <Suspense fallback={<FallbackChip title={title} />}>
          <WikiChip itemId={itemId} title={title} />
        </Suspense>
      </span>
      {props.children}
    </PlateElement>
  );
};

// the `[[` picker is how a page link is made, so an `@` stays the character typed
export const MentionKit = [
  MentionPlugin.configure({ options: { triggerQuery: () => false } }).withComponent(MentionElement),
];

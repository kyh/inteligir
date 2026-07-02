// Link kit. Base half feeds the headless serialization mirror; the React half
// renders the anchor. WP3 adds the link popover (open/edit/unlink) on top.

import { BaseLinkPlugin } from "@platejs/link";
import { LinkPlugin } from "@platejs/link/react";
import { PlateElement, type PlateElementProps } from "platejs/react";

export const LinkBaseKit = [BaseLinkPlugin];

function LinkElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="a"
      className="cursor-pointer border-b border-current font-medium text-foreground/70"
    />
  );
}

export const LinkKit = [LinkPlugin.withComponent(LinkElement)];

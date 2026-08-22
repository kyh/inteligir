// Link kit. Base half feeds the headless serialization mirror; the React half
// renders the anchor + its popover (open/edit/unlink — nodes/link-node.tsx).

import { BaseLinkPlugin } from "@platejs/link";
import { LinkPlugin } from "@platejs/link/react";

import { LinkElement } from "@repo/editor/nodes/link-node";

export const LinkBaseKit = [BaseLinkPlugin];

export const LinkKit = [LinkPlugin.withComponent(LinkElement)];

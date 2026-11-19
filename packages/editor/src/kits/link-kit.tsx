import { LinkPlugin } from "@platejs/link/react";

import { LinkElement } from "@repo/editor/nodes/link-node";

export const LinkKit = [LinkPlugin.withComponent(LinkElement)];

import { LinkFloatingToolbar } from "@/components/editor/ui/link-floating-toolbar-app";
import { LinkElement } from "@/components/editor/ui/link-node-app";
import { linkPlugin } from "@/registry/components/editor/plugins/link-kit";

export const LinkKit = [
  linkPlugin.configure({
    render: {
      node: LinkElement,
      afterEditable: () => <LinkFloatingToolbar />,
    },
  }),
];

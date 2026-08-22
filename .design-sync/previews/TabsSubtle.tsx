import { TabsSubtle, TabsSubtleItem } from "@repo/ui";
import { ListTodo, MessageSquareText, Settings } from "lucide-react";

const noop = () => {};

export function PanelTabs() {
  return (
    <TabsSubtle aria-label="Panel tabs" selectedIndex={0} onSelect={noop}>
      <TabsSubtleItem index={0} label="Actions" />
      <TabsSubtleItem index={1} label="Comments" />
    </TabsSubtle>
  );
}

export function CompactWithIcons() {
  return (
    <TabsSubtle aria-label="Sections" size="compact" selectedIndex={1} onSelect={noop}>
      <TabsSubtleItem index={0} label="Tasks" icon={ListTodo} />
      <TabsSubtleItem index={1} label="Comments" icon={MessageSquareText} />
      <TabsSubtleItem index={2} label="Settings" icon={Settings} />
    </TabsSubtle>
  );
}

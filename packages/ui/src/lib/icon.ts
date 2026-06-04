import { iconMap, type IconComponent, type IconName } from "@repo/ui/lib/icon-map";

export type { IconComponent, IconName } from "@repo/ui/lib/icon-map";

export function getIcon(name: IconName): IconComponent {
  return iconMap[name];
}

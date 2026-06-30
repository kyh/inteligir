"use client";

import { iconMap, type IconComponent, type IconName } from "@repo/ui/lib/icon-map";

// Re-export the icon types for consumers (button.tsx + tabs.tsx import IconComponent).
export type { IconComponent, IconName } from "@repo/ui/lib/icon-map";

/** The Lucide icon component for the given name. */
export function useIcon(name: IconName): IconComponent {
  return iconMap.lucide[name];
}

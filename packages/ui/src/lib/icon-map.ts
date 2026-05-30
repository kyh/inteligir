"use client";

import type { ComponentType } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Dot,
  Globe,
  Heart,
  Home,
  ImageIcon,
  Inbox,
  Lightbulb,
  Link,
  Loader,
  Lock,
  Mail,
  Menu,
  MessageCircle,
  Monitor,
  Moon,
  Paintbrush,
  Palette,
  Pause,
  Pencil,
  Pipette,
  Play,
  Plus,
  RectangleHorizontal,
  Rocket,
  RotateCcw,
  Search,
  Settings,
  Shield,
  SkipForward,
  SquareLibrary,
  Star,
  Sun,
  User,
  Users,
  X,
} from "lucide-react";

/**
 * Icon component contract shared by Fluid Functionalism components. Matches the
 * shape of a lucide-react icon (size + strokeWidth props), so consumers can pass
 * any lucide icon — or their own component with the same signature.
 */
export type IconComponent = ComponentType<{
  size?: number;
  strokeWidth?: number;
  className?: string;
}>;

/**
 * Upstream Fluid Functionalism ships swappable icon sets (Lucide, Tabler,
 * Phosphor, HugeIcons). This project standardises on lucide-react (see
 * CLAUDE.md), so every library resolves to the same lucide map — the
 * `IconLibrary` API is preserved for source-compatibility with FF components,
 * but switching is a no-op rather than pulling three extra icon packages.
 */
export type IconLibrary = "lucide" | "tabler" | "phosphor" | "hugeicons";

export type IconName =
  | "chevron-right"
  | "chevron-down"
  | "pipette"
  | "x"
  | "copy"
  | "menu"
  | "dot"
  | "monitor"
  | "sun"
  | "moon"
  | "rectangle-horizontal"
  | "circle"
  | "square-library"
  | "clock"
  | "star"
  | "settings"
  | "plus"
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "search"
  | "loader"
  | "users"
  | "lock"
  | "mail"
  | "bell"
  | "shield"
  | "palette"
  | "lightbulb"
  | "rocket"
  | "heart"
  | "paintbrush"
  | "brain"
  | "globe"
  | "user"
  | "image"
  | "link"
  | "check"
  | "rotate-ccw"
  | "play"
  | "pause"
  | "home"
  | "message-circle"
  | "inbox"
  | "pencil"
  | "skip-forward";

const lucideMap: Record<IconName, IconComponent> = {
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  pipette: Pipette,
  x: X,
  copy: Copy,
  menu: Menu,
  dot: Dot,
  monitor: Monitor,
  sun: Sun,
  moon: Moon,
  "rectangle-horizontal": RectangleHorizontal,
  circle: Circle,
  "square-library": SquareLibrary,
  clock: Clock,
  star: Star,
  settings: Settings,
  plus: Plus,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  search: Search,
  loader: Loader,
  users: Users,
  lock: Lock,
  mail: Mail,
  bell: Bell,
  shield: Shield,
  palette: Palette,
  lightbulb: Lightbulb,
  rocket: Rocket,
  heart: Heart,
  paintbrush: Paintbrush,
  brain: Brain,
  globe: Globe,
  user: User,
  image: ImageIcon,
  link: Link,
  check: Check,
  "rotate-ccw": RotateCcw,
  play: Play,
  pause: Pause,
  home: Home,
  "message-circle": MessageCircle,
  inbox: Inbox,
  pencil: Pencil,
  "skip-forward": SkipForward,
};

export const iconMap: Record<IconLibrary, Record<IconName, IconComponent>> = {
  lucide: lucideMap,
  tabler: lucideMap,
  phosphor: lucideMap,
  hugeicons: lucideMap,
};

export const iconLibraryOrder: IconLibrary[] = [
  "lucide",
  "tabler",
  "phosphor",
  "hugeicons",
];

export const iconLibraryLabels: Record<IconLibrary, string> = {
  lucide: "Lucide",
  tabler: "Tabler",
  phosphor: "Phosphor",
  hugeicons: "HugeIcons",
};

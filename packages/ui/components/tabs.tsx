"use client";

import * as TabsPrimitives from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "../lib/cn";

const TabsRoot = (
  props: React.ComponentPropsWithoutRef<typeof TabsPrimitives.Root>,
) => {
  return <TabsPrimitives.Root {...props} />;
};
TabsRoot.displayName = "Tabs";

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitives.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitives.Trigger>
>(({ className, children, ...props }, ref) => (
  <TabsPrimitives.Trigger
    className={cn(
      "inline-flex items-center justify-center rounded-full border border-transparent bg-transparent px-3 py-1.5 text-xs text-ui-fg-subtle outline-none transition-fg",
      "hover:text-ui-fg-base",
      "focus:border-ui-border-interactive focus:bg-ui-bg-base focus:!shadow-borders-focus",
      "data-[state=active]:bg-ui-bg-base data-[state=active]:text-ui-fg-base data-[state=active]:shadow-elevation-card-rest",
      className,
    )}
    ref={ref}
    {...props}
  >
    {children}
  </TabsPrimitives.Trigger>
));
TabsTrigger.displayName = "Tabs.Trigger";

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitives.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitives.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitives.List
    className={cn("flex items-center gap-2", className)}
    ref={ref}
    {...props}
  />
));
TabsList.displayName = "Tabs.List";

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitives.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitives.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitives.Content
    className={cn("outline-none", className)}
    ref={ref}
    {...props}
  />
));
TabsContent.displayName = "Tabs.Content";

const Tabs = Object.assign(TabsRoot, {
  Trigger: TabsTrigger,
  List: TabsList,
  Content: TabsContent,
});

export { Tabs };

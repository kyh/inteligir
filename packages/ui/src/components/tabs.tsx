"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "@repo/ui/lib/cn";

// Flat tabs: a row of labels and one underline that slides between them.
const Tabs = ({ className, ...props }: TabsPrimitive.Root.Props) => (
  <TabsPrimitive.Root
    data-slot="tabs"
    className={cn("flex min-h-0 flex-col", className)}
    {...props}
  />
);

const TabsList = ({ className, children, ...props }: TabsPrimitive.List.Props) => (
  <TabsPrimitive.List
    data-slot="tabs-list"
    className={cn("relative flex h-full items-stretch", className)}
    {...props}
  >
    {children}
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className="absolute bottom-0 left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-full bg-foreground transition-[translate,width] duration-200 ease-out"
    />
  </TabsPrimitive.List>
);

const TabsTrigger = ({ className, ...props }: TabsPrimitive.Tab.Props) => (
  <TabsPrimitive.Tab
    data-slot="tabs-trigger"
    className={cn(
      "flex items-center px-2 text-body text-muted-foreground outline-none select-none hover:text-foreground focus-visible:text-foreground data-active:text-foreground",
      className,
    )}
    {...props}
  />
);

const TabsContent = ({ className, ...props }: TabsPrimitive.Panel.Props) => (
  <TabsPrimitive.Panel
    data-slot="tabs-content"
    className={cn("flex min-h-0 flex-1 flex-col outline-none", className)}
    {...props}
  />
);

export { Tabs, TabsContent, TabsList, TabsTrigger };

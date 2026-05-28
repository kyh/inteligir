"use client";

import { useState } from "react";
import {
  BellIcon,
  HeartIcon,
  HomeIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
} from "lucide-react";

import {
  AccordionContent,
  AccordionGroup,
  AccordionItem,
  AccordionTrigger,
} from "@repo/ui/components/accordion";
import { alertDialog } from "@repo/ui/components/alert-dialog";
import { AskUserQuestions } from "@repo/ui/components/ask-user-questions";
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@repo/ui/components/avatar";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { CheckboxGroup, CheckboxItem } from "@repo/ui/components/checkbox-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible";
import { ColorPickerPopover } from "@repo/ui/components/color-picker";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@repo/ui/components/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { InputCopy } from "@repo/ui/components/input-copy";
import {
  InputGroup as AddonInputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@repo/ui/components/input-group";
import { InputField, InputGroup } from "@repo/ui/components/input-group-fields";
import { InputMessage } from "@repo/ui/components/input-message";
import { Label } from "@repo/ui/components/label";
import { Logo } from "@repo/ui/components/logo";
import { NavItem } from "@repo/ui/components/nav-item";
import { NavMenu } from "@repo/ui/components/nav-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";
import { RadioGroup, RadioItem } from "@repo/ui/components/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@repo/ui/components/select";
import { Separator } from "@repo/ui/components/separator";
import { Slider, SliderComfortable } from "@repo/ui/components/slider";
import { toast } from "@repo/ui/components/sonner";
import { Spinner } from "@repo/ui/components/spinner";
import { Switch } from "@repo/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { TabItem, TabPanel, Tabs, TabsList } from "@repo/ui/components/tabs";
import { TabsSubtle, TabsSubtleItem } from "@repo/ui/components/tabs-subtle";
import { Textarea } from "@repo/ui/components/textarea";
import { ThinkingIndicator } from "@repo/ui/components/thinking-indicator";
import {
  ThinkingStep,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader,
} from "@repo/ui/components/thinking-steps";
import { Tooltip } from "@repo/ui/components/tooltip";

import { HeroOrb } from "@/components/hero-orb";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-b border-border py-10">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      <div className="flex flex-wrap items-start gap-6">{children}</div>
    </section>
  );
}

export default function UiPage() {
  const [switchOn, setSwitchOn] = useState(true);
  const [checked, setChecked] = useState<Set<number>>(new Set([0]));
  const [radio, setRadio] = useState("comfortable");
  const [volume, setVolume] = useState(60);
  const [brightness, setBrightness] = useState(40);
  const [fruit, setFruit] = useState("");
  const [subtleTab, setSubtleTab] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [color, setColor] = useState("#6b97ff");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [navSlug, setNavSlug] = useState<string | null>("/home");

  const toggleChecked = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <main className="mx-auto max-w-3xl px-6 pt-24 pb-32">
      <header className="flex items-center gap-3">
        <Logo className="size-8" />
        <div className="flex flex-col">
          <h1 className="text-2xl font-semibold">UI library</h1>
          <p className="text-sm text-muted-foreground">
            Every component in @repo/ui — motion is information, not decoration.
          </p>
        </div>
      </header>

      <Section title="Buttons">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="tertiary">Tertiary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button leadingIcon={PlusIcon}>New</Button>
        <Button variant="secondary" trailingIcon={SettingsIcon}>
          Settings
        </Button>
        <Button size="icon" variant="secondary" aria-label="Search">
          <SearchIcon />
        </Button>
        <Button
          loading={loading}
          onClick={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 1600);
          }}
        >
          {loading ? "Working" : "Click to load"}
        </Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
      </Section>

      <Section title="Badges">
        <Badge>Default</Badge>
        <Badge color="green">Success</Badge>
        <Badge color="amber">Warning</Badge>
        <Badge color="red">Error</Badge>
        <Badge variant="dot" color="blue">
          In progress
        </Badge>
        <Badge variant="dot" color="violet" size="lg">
          Large dot
        </Badge>
      </Section>

      <Section title="Avatars">
        <Avatar>
          <AvatarFallback>AL</AvatarFallback>
          <AvatarBadge className="bg-green-500" />
        </Avatar>
        <Avatar size="lg">
          <AvatarFallback>AT</AvatarFallback>
        </Avatar>
        <AvatarGroup>
          <Avatar>
            <AvatarFallback>A</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>B</AvatarFallback>
          </Avatar>
          <AvatarGroupCount>+3</AvatarGroupCount>
        </AvatarGroup>
      </Section>

      <Section title="Switch & Checkbox group">
        <Switch label="Notifications" checked={switchOn} onToggle={() => setSwitchOn((v) => !v)} />
        <CheckboxGroup checkedIndices={checked}>
          <CheckboxItem index={0} label="Email" checked={checked.has(0)} onToggle={() => toggleChecked(0)} />
          <CheckboxItem index={1} label="SMS" checked={checked.has(1)} onToggle={() => toggleChecked(1)} />
          <CheckboxItem index={2} label="Push" checked={checked.has(2)} onToggle={() => toggleChecked(2)} />
        </CheckboxGroup>
        <div className="flex items-center gap-2">
          <Checkbox />
          <span className="text-sm">Standalone</span>
        </div>
      </Section>

      <Section title="Radio group">
        <RadioGroup value={radio} onValueChange={setRadio}>
          <RadioItem index={0} value="comfortable" label="Comfortable" />
          <RadioItem index={1} value="compact" label="Compact" />
          <RadioItem index={2} value="spacious" label="Spacious" />
        </RadioGroup>
      </Section>

      <Section title="Sliders">
        <div className="flex w-full flex-col gap-8">
          <Slider value={volume} onChange={(v) => setVolume(v as number)} min={0} max={100} label="Volume" showValue />
          <SliderComfortable value={brightness} onChange={setBrightness} min={0} max={100} step={10} label="Brightness" variant="pips" />
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabItem value="overview" label="Overview" icon={HomeIcon} />
            <TabItem value="activity" label="Activity" icon={BellIcon} />
            <TabItem value="starred" label="Starred" icon={StarIcon} />
          </TabsList>
          <TabPanel value="overview" className="pt-4 text-sm text-muted-foreground">
            Overview content.
          </TabPanel>
          <TabPanel value="activity" className="pt-4 text-sm text-muted-foreground">
            Activity content.
          </TabPanel>
          <TabPanel value="starred" className="pt-4 text-sm text-muted-foreground">
            Starred content.
          </TabPanel>
        </Tabs>
      </Section>

      <Section title="Subtle tabs">
        <div className="flex w-full flex-col gap-3">
          <TabsSubtle selectedIndex={subtleTab} onSelect={setSubtleTab}>
            <TabsSubtleItem index={0} label="Day" />
            <TabsSubtleItem index={1} label="Week" />
            <TabsSubtleItem index={2} label="Month" />
          </TabsSubtle>
          <p className="text-sm text-muted-foreground">
            {["Daily view.", "Weekly view.", "Monthly view."][subtleTab]}
          </p>
        </div>
      </Section>

      <Section title="Accordion">
        <AccordionGroup type="single" collapsible defaultValue="a" className="w-full">
          <AccordionItem value="a">
            <AccordionTrigger>What is Fluid Functionalism?</AccordionTrigger>
            <AccordionContent>
              A design system where every animation serves a functional purpose.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="b">
            <AccordionTrigger>Is it accessible?</AccordionTrigger>
            <AccordionContent>Built on Base UI primitives with keyboard support.</AccordionContent>
          </AccordionItem>
        </AccordionGroup>
      </Section>

      <Section title="Collapsible">
        <Collapsible className="w-full">
          <CollapsibleTrigger
            render={
              <Button variant="secondary" size="sm">
                Toggle details
              </Button>
            }
          />
          <CollapsibleContent className="pt-3 text-sm text-muted-foreground">
            Hidden content revealed on toggle.
          </CollapsibleContent>
        </Collapsible>
      </Section>

      <Section title="Select & menus">
        <Select value={fruit} onValueChange={setFruit}>
          <SelectTrigger placeholder="Pick a fruit" />
          <SelectContent>
            <SelectItem index={0} value="apple">
              Apple
            </SelectItem>
            <SelectItem index={1} value="banana">
              Banana
            </SelectItem>
            <SelectItem index={2} value="cherry">
              Cherry
            </SelectItem>
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="secondary">Menu (Base UI)</Button>} />
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Billing</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Overlays">
        <Tooltip content="Add to favorites">
          <Button size="icon" variant="secondary" aria-label="Favorite">
            <HeartIcon />
          </Button>
        </Tooltip>
        <Popover>
          <PopoverTrigger render={<Button variant="secondary">Popover</Button>} />
          <PopoverContent>
            <p className="text-sm">Popovers float above content with elevation.</p>
          </PopoverContent>
        </Popover>
        <Button onClick={() => setDialogOpen(true)}>Dialog</Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete project</DialogTitle>
              <DialogDescription>This action cannot be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="tertiary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setDialogOpen(false)}>Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button
          variant="tertiary"
          onClick={() =>
            alertDialog.open("Delete this item?", {
              description: "This permanently removes the item.",
              action: { label: "Delete" },
            })
          }
        >
          Alert dialog
        </Button>
        <Button variant="tertiary" onClick={() => toast.success("Saved changes")}>
          Toast
        </Button>
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="secondary">Drawer</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Drawer</DrawerTitle>
              <DrawerDescription>Slides up from the bottom (vaul).</DrawerDescription>
            </DrawerHeader>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button>Close</Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </Section>

      <Section title="Inputs">
        <div className="flex w-full flex-col gap-4">
          <Field>
            <FieldLabel>Project name</FieldLabel>
            <Input placeholder="Acme" />
            <FieldDescription>Shown in the dashboard header.</FieldDescription>
          </Field>
          <FieldGroup>
            <Label>Notes</Label>
            <Textarea placeholder="Add a note…" />
          </FieldGroup>
          <AddonInputGroup>
            <InputGroupAddon>
              <SearchIcon className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </AddonInputGroup>
          <InputCopy value="npm install @repo/ui" label="Install" />
          <InputGroup>
            <InputField index={0} label="Name" value={name} onChange={setName} placeholder="Ada Lovelace" />
            <InputField index={1} label="Email" value={email} onChange={setEmail} placeholder="ada@example.com" />
          </InputGroup>
        </div>
      </Section>

      <Section title="Color picker">
        <ColorPickerPopover
          value={color}
          onValueChange={setColor}
          triggerLabel="Brand color"
          triggerShowValue
        />
      </Section>

      <Section title="Chat input">
        <div className="w-full">
          <InputMessage
            value={message}
            onValueChange={setMessage}
            onSend={() => setMessage("")}
            placeholder="Send a message…"
          />
        </div>
      </Section>

      <Section title="Navigation">
        <NavMenu activeSlug={navSlug}>
          <NavItem
            index={0}
            href="/home"
            label="Home"
            icon={HomeIcon}
            onClick={(e) => {
              e.preventDefault();
              setNavSlug("/home");
            }}
          />
          <NavItem
            index={1}
            href="/settings"
            label="Settings"
            icon={SettingsIcon}
            onClick={(e) => {
              e.preventDefault();
              setNavSlug("/settings");
            }}
          />
          <NavItem
            index={2}
            href="/alerts"
            label="Alerts"
            icon={BellIcon}
            onClick={(e) => {
              e.preventDefault();
              setNavSlug("/alerts");
            }}
          />
        </NavMenu>
      </Section>

      <Section title="Command">
        <div className="w-80 rounded-xl border border-border bg-surface-3 shadow-surface-3">
          <Command>
            <CommandInput placeholder="Type a command…" />
            <CommandList>
              <CommandEmpty>No results.</CommandEmpty>
              <CommandGroup>
                <CommandItem>New file</CommandItem>
                <CommandItem>Open project</CommandItem>
                <CommandItem>Toggle theme</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </Section>

      <Section title="Questions">
        <AskUserQuestions
          className="w-full"
          questions={[
            {
              id: "stack",
              title: "Which framework?",
              options: [
                { id: "next", title: "Next.js", description: "React, app router" },
                { id: "remix", title: "Remix", description: "Nested routing" },
                { id: "astro", title: "Astro", description: "Content-first" },
              ],
            },
          ]}
        />
      </Section>

      <Section title="Table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow index={0}>
              <TableCell>Ada Lovelace</TableCell>
              <TableCell>Engineer</TableCell>
              <TableCell>
                <Badge variant="dot" color="green">
                  Active
                </Badge>
              </TableCell>
            </TableRow>
            <TableRow index={1}>
              <TableCell>Alan Turing</TableCell>
              <TableCell>Researcher</TableCell>
              <TableCell>
                <Badge variant="dot" color="amber">
                  Away
                </Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section title="Thinking & feedback">
        <Spinner className="size-6 text-foreground" />
        <ThinkingIndicator />
        <ThinkingSteps>
          <ThinkingStepsHeader>Reasoning</ThinkingStepsHeader>
          <ThinkingStepsContent>
            <ThinkingStep index={0} label="Read the request" status="complete" />
            <ThinkingStep index={1} label="Search the codebase" status="active" />
            <ThinkingStep index={2} label="Draft a fix" status="pending" isLast />
          </ThinkingStepsContent>
        </ThinkingSteps>
      </Section>

      <Section title="Separator">
        <div className="flex w-full flex-col gap-3 text-sm">
          <span>Above</span>
          <Separator />
          <span>Below</span>
        </div>
      </Section>

      <Section title="Geometric orb">
        <div className="h-48 w-48">
          <HeroOrb />
        </div>
      </Section>
    </main>
  );
}

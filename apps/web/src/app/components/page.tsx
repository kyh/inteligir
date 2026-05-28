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

import { AccordionContent, AccordionGroup, AccordionItem, AccordionTrigger } from "@repo/ui/components/accordion";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { CheckboxGroup, CheckboxItem } from "@repo/ui/components/checkbox-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Dropdown } from "@repo/ui/components/dropdown";
import { Input } from "@repo/ui/components/input";
import { InputCopy } from "@repo/ui/components/input-copy";
import { InputField, InputGroup } from "@repo/ui/components/input-group-fields";
import { MenuItem } from "@repo/ui/components/menu-item";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";
import { RadioGroup, RadioItem } from "@repo/ui/components/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@repo/ui/components/select";
import { Slider } from "@repo/ui/components/slider";
import { Spinner } from "@repo/ui/components/spinner";
import { Switch } from "@repo/ui/components/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui/components/table";
import { TabItem, TabPanel, Tabs, TabsList } from "@repo/ui/components/tabs";
import { TabsSubtle, TabsSubtleItem } from "@repo/ui/components/tabs-subtle";
import { Textarea } from "@repo/ui/components/textarea";
import { ThinkingIndicator } from "@repo/ui/components/thinking-indicator";
import { Tooltip } from "@repo/ui/components/tooltip";

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

export default function ComponentsPage() {
  const [switchOn, setSwitchOn] = useState(true);
  const [checked, setChecked] = useState<Set<number>>(new Set([0]));
  const [radio, setRadio] = useState("comfortable");
  const [volume, setVolume] = useState<number>(60);
  const [fruit, setFruit] = useState("");
  const [subtleTab, setSubtleTab] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const toggleChecked = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <main className="mx-auto max-w-3xl px-6 pt-24 pb-32">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Component library</h1>
        <p className="text-sm text-muted-foreground">
          Fluid Functionalism components — motion is information, not decoration.
        </p>
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
        <Button loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1600); }}>
          {loading ? "Working" : "Click to load"}
        </Button>
      </Section>

      <Section title="Button sizes">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
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

      <Section title="Switch & Checkbox group">
        <Switch label="Notifications" checked={switchOn} onToggle={() => setSwitchOn((v) => !v)} />
        <CheckboxGroup checkedIndices={checked}>
          <CheckboxItem index={0} label="Email" checked={checked.has(0)} onToggle={() => toggleChecked(0)} />
          <CheckboxItem index={1} label="SMS" checked={checked.has(1)} onToggle={() => toggleChecked(1)} />
          <CheckboxItem index={2} label="Push" checked={checked.has(2)} onToggle={() => toggleChecked(2)} />
        </CheckboxGroup>
        <div className="flex items-center gap-2">
          <Checkbox />
          <span className="text-sm">Standalone checkbox</span>
        </div>
      </Section>

      <Section title="Radio group">
        <RadioGroup value={radio} onValueChange={setRadio}>
          <RadioItem index={0} value="comfortable" label="Comfortable" />
          <RadioItem index={1} value="compact" label="Compact" />
          <RadioItem index={2} value="spacious" label="Spacious" />
        </RadioGroup>
      </Section>

      <Section title="Slider">
        <div className="w-80">
          <Slider value={volume} onChange={(v) => setVolume(v as number)} min={0} max={100} label="Volume" showValue />
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

      <Section title="Select">
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
      </Section>

      <Section title="Dropdown menu">
        <div className="w-56 rounded-2xl bg-surface-3 p-1 shadow-surface-3">
          <Dropdown checkedIndex={menuIndex}>
            <MenuItem index={0} label="Profile" icon={HomeIcon} checked={menuIndex === 0} onSelect={() => setMenuIndex(0)} />
            <MenuItem index={1} label="Settings" icon={SettingsIcon} checked={menuIndex === 1} onSelect={() => setMenuIndex(1)} />
            <MenuItem index={2} label="Notifications" icon={BellIcon} checked={menuIndex === 2} onSelect={() => setMenuIndex(2)} />
          </Dropdown>
        </div>
      </Section>

      <Section title="Tooltip, Popover & Dialog">
        <Tooltip content="Add to favorites">
          <Button size="icon" variant="secondary" aria-label="Favorite">
            <HeartIcon />
          </Button>
        </Tooltip>
        <Popover>
          <PopoverTrigger render={<Button variant="secondary">Open popover</Button>} />
          <PopoverContent>
            <p className="text-sm">Popovers float above content with elevation.</p>
          </PopoverContent>
        </Popover>
        <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
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
      </Section>

      <Section title="Inputs">
        <div className="flex w-full flex-col gap-4">
          <Input placeholder="Plain input" />
          <Textarea placeholder="Textarea" />
          <InputCopy value="npm install @repo/ui" label="Install" />
          <InputGroup>
            <InputField index={0} label="Name" value={name} onChange={setName} placeholder="Ada Lovelace" />
            <InputField index={1} label="Email" value={email} onChange={setEmail} placeholder="ada@example.com" />
          </InputGroup>
        </div>
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

      <Section title="Feedback">
        <Spinner className="size-6 text-foreground" />
        <ThinkingIndicator />
      </Section>
    </main>
  );
}

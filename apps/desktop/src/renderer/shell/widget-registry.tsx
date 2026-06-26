// ---------------------------------------------------------------------------
// json-render component registry for widget panels. Each implementation maps a
// catalog component onto a shadcn (@repo/ui) primitive so widgets match the
// rest of the app. Components emit events ("press", "change") which the
// renderer resolves against each element's `on` field.
//
// The implementations live in ./catalog/{layout,inputs,display,overlays}.tsx
// (shared types + bind hooks in ./catalog/shared.tsx). This file only wires
// them into the registry.
// ---------------------------------------------------------------------------

import { defineRegistry } from "@json-render/react";

import {
  CatalogAvatar,
  CatalogAccent,
  CatalogBadge,
  CatalogCard,
  CatalogChart,
  CatalogCollapsible,
  CatalogImage,
  CatalogMarkdown,
  CatalogSeparator,
  CatalogSpinner,
  CatalogTable,
  CatalogTableBody,
  CatalogTableCell,
  CatalogTableHead,
  CatalogTableHeader,
  CatalogTableRow,
  CatalogTabs,
} from "@/renderer/shell/catalog/display";
import {
  CatalogButton,
  CatalogCheckbox,
  CatalogInput,
  CatalogRadioGroup,
  CatalogSelect,
  CatalogSlider,
  CatalogSwitch,
  CatalogTextarea,
} from "@/renderer/shell/catalog/inputs";
import {
  Grid,
  Heading,
  Row,
  Section,
  Stack,
  Text,
  TextBlock,
} from "@/renderer/shell/catalog/layout";
import {
  CatalogDialog,
  CatalogDrawer,
  CatalogDropdownMenu,
  CatalogMenuItem,
  CatalogPopover,
  CatalogTooltip,
} from "@/renderer/shell/catalog/overlays";
import { widgetCatalog } from "@/renderer/shell/widget-catalog";

export const { registry: widgetRegistry } = defineRegistry(widgetCatalog, {
  components: {
    Stack,
    Section,
    Row,
    Grid,
    Heading,
    Text,
    TextBlock,
    Markdown: CatalogMarkdown,
    Badge: CatalogBadge,
    Button: CatalogButton,
    Checkbox: CatalogCheckbox,
    Switch: CatalogSwitch,
    Input: CatalogInput,
    Textarea: CatalogTextarea,
    Select: CatalogSelect,
    RadioGroup: CatalogRadioGroup,
    Slider: CatalogSlider,
    Avatar: CatalogAvatar,
    Spinner: CatalogSpinner,
    Image: CatalogImage,
    Chart: CatalogChart,
    Card: CatalogCard,
    Accent: CatalogAccent,
    Collapsible: CatalogCollapsible,
    Tabs: CatalogTabs,
    Table: CatalogTable,
    TableHeader: CatalogTableHeader,
    TableBody: CatalogTableBody,
    TableRow: CatalogTableRow,
    TableHead: CatalogTableHead,
    TableCell: CatalogTableCell,
    Dialog: CatalogDialog,
    Drawer: CatalogDrawer,
    Popover: CatalogPopover,
    Tooltip: CatalogTooltip,
    DropdownMenu: CatalogDropdownMenu,
    MenuItem: CatalogMenuItem,
    Separator: CatalogSeparator,
  },
  // Action stubs — real handlers are mounted per-viewer in widget-viewer.tsx
  // so they can close over the bridge, store, and toast singleton.
  actions: {
    notify: async () => {},
    openUrl: async () => {},
    sendPrompt: async () => {},
    generateText: async () => {},
    fetchUrl: async () => {},
    fetchJson: async () => {},
    setNow: async () => {},
    callTool: async () => {},
    readDoc: async () => {},
    writeDoc: async () => {},
    readBlob: async () => {},
    writeBlob: async () => {},
  },
});

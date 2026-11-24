import { DragKit } from "@repo/editor/block-draggable";
import { BasicBlocksKit } from "@repo/editor/kits/basic-blocks-kit";
import { BasicMarksKit } from "@repo/editor/kits/basic-marks-kit";
import { BlockMenuKit } from "@repo/editor/kits/block-menu-kit";
import { BlockPlaceholderKit } from "@repo/editor/kits/block-placeholder-kit";
import { CodeBlockKit } from "@repo/editor/kits/code-block-kit";
import { ColumnKit } from "@repo/editor/kits/column-kit";
import { DateKit } from "@repo/editor/kits/date-kit";
import { EmbedKit } from "@repo/editor/kits/embed-kit";
import { ImageKit } from "@repo/editor/kits/image-kit";
import { LinkKit } from "@repo/editor/kits/link-kit";
import { ListKit } from "@repo/editor/kits/list-kit";
import { MarkdownKit } from "@repo/editor/headless/kits/markdown-kit";
import { MathKit } from "@repo/editor/kits/math-kit";
import { MentionKit } from "@repo/editor/kits/mention-kit";
import { TableKit } from "@repo/editor/kits/table-kit";
import { TagChipKit } from "@repo/editor/kits/tag-chip-kit";
import { ToggleKit } from "@repo/editor/kits/toggle-kit";
import { EditorShortcutsKit } from "@repo/editor/editor-shortcuts";
import { FindBarKit } from "@repo/editor/find-bar";
import { RichBlocksKit } from "@repo/editor/kits/rich-blocks-kit";
import { InlineConstructsKit } from "@repo/editor/kits/inline-constructs-kit";
import { TabsKit } from "@repo/editor/kits/tabs-kit";
import { HeadingCollapseKit } from "@repo/editor/heading-collapse";
import { SelectionToolbarKit } from "@repo/editor/selection-toolbar";
import { SlashKit } from "@repo/editor/slash-menu";
import { TocKit } from "@repo/editor/toc";
import { FormulaAutocompleteKit } from "@repo/editor/formulas/formula-autocomplete";
import { PickerRaceKit } from "@repo/editor/headless/combobox-input";
import { ReadOnlyGuardPlugin } from "@repo/editor/edit-guard";
import { NoteSectionPlugin } from "@repo/editor/headless/kits/note-section";

export const CONTENT_KIT = [
  ...PickerRaceKit,
  ...BasicMarksKit,
  ...BasicBlocksKit,
  ...CodeBlockKit,
  ...TableKit,
  ...ListKit,
  ...LinkKit,
  ...ToggleKit,
  ...ColumnKit,
  ...EmbedKit,
  ...ImageKit,
  ...DateKit,
  ...MathKit,
  ...MentionKit,
  ...InlineConstructsKit,
  ...RichBlocksKit,
  ...TabsKit,
  ...FormulaAutocompleteKit,
  ...TagChipKit,
  ...MarkdownKit,
  NoteSectionPlugin,
  ReadOnlyGuardPlugin,
];

export const DESKTOP_CHROME_KIT = [
  ...HeadingCollapseKit,
  ...SlashKit,
  ...EditorShortcutsKit,
  ...FindBarKit,
  ...DragKit,
  ...BlockMenuKit,
  ...SelectionToolbarKit,
  ...BlockPlaceholderKit,
  ...TocKit,
];

export const EDITOR_KIT = [...CONTENT_KIT, ...DESKTOP_CHROME_KIT];

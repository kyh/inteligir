// The headless mirror: the codec's editor is built from exactly this list, and the live kit
// composes the React halves of the same plugins. Every file here is headless (the base kits and
// the markdown wiring), so the codec runs headless: the Worker's fill reads a saved page's tree
// with it, and nothing it reaches imports React, a stylesheet or a node built-in.

import { MarkdownKit } from "@repo/editor/headless/kits/markdown-kit";
import { NoteSectionPlugin } from "@repo/editor/headless/live/note-section";

import { BasicBlocksBaseKit } from "./basic-blocks-base";
import { BasicMarksBaseKit } from "./basic-marks-base";
import { CodeBlockBaseKit } from "./code-block-base";
import { ColumnBaseKit } from "./column-base";
import { DateBaseKit } from "./date-base";
import { EmbedBaseKit } from "./embed-base";
import { ImageBaseKit } from "./image-base";
import { InlineConstructsBaseKit } from "./inline-constructs-base";
import { LinkBaseKit } from "./link-base";
import { ListBaseKit } from "./list-base";
import { MathBaseKit } from "./math-base";
import { MentionBaseKit } from "./mention-base";
import { PickerInputBaseKit } from "./picker-input-base";
import { RichBlocksBaseKit } from "./rich-blocks-base";
import { TableBaseKit } from "./table-base";
import { TabsBaseKit } from "./tabs-base";
import { ToggleBaseKit } from "./toggle-base";

export const BASE_KIT = [
  ...BasicMarksBaseKit,
  ...BasicBlocksBaseKit,
  ...CodeBlockBaseKit,
  ...TableBaseKit,
  ...ListBaseKit,
  ...LinkBaseKit,
  ...ToggleBaseKit,
  ...ColumnBaseKit,
  ...EmbedBaseKit,
  ...ImageBaseKit,
  ...DateBaseKit,
  ...MathBaseKit,
  ...MentionBaseKit,
  ...PickerInputBaseKit,
  ...InlineConstructsBaseKit,
  ...RichBlocksBaseKit,
  ...TabsBaseKit,
  ...MarkdownKit,
  NoteSectionPlugin,
];

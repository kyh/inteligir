// The headless mirror: the gate editor is built from exactly this list, and the live kit composes
// the React halves of the same plugins. Every file here is headless (kits/headless/, plus the
// markdown wiring), so the fixpoint runs in node: the fill worker canonicalizes a saved page with
// it, and nothing it reaches imports React, a stylesheet or a node built-in.

import { MarkdownKit } from "@repo/editor/kits/markdown-kit";

import { BasicBlocksBaseKit } from "./headless/basic-blocks-base";
import { BasicMarksBaseKit } from "./headless/basic-marks-base";
import { CodeBlockBaseKit } from "./headless/code-block-base";
import { ColumnBaseKit } from "./headless/column-base";
import { DateBaseKit } from "./headless/date-base";
import { EmbedBaseKit } from "./headless/embed-base";
import { FrontmatterBaseKit } from "./headless/frontmatter-base";
import { ImageBaseKit } from "./headless/image-base";
import { InlineConstructsBaseKit } from "./headless/inline-constructs-base";
import { LinkBaseKit } from "./headless/link-base";
import { ListBaseKit } from "./headless/list-base";
import { MathBaseKit } from "./headless/math-base";
import { OpaqueBaseKit } from "./headless/opaque-base";
import { RichBlocksBaseKit } from "./headless/rich-blocks-base";
import { TableBaseKit } from "./headless/table-base";
import { TabsBaseKit } from "./headless/tabs-base";
import { ToggleBaseKit } from "./headless/toggle-base";
import { WikiLinkBaseKit } from "./headless/wiki-link-base";

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
  ...OpaqueBaseKit,
  ...FrontmatterBaseKit,
  ...WikiLinkBaseKit,
  ...InlineConstructsBaseKit,
  ...RichBlocksBaseKit,
  ...TabsBaseKit,
  ...MarkdownKit,
];

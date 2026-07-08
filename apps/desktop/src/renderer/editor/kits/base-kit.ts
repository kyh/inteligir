// BASE_KIT — the headless mirror composition. markdown-doc's gate editor is
// built from exactly this list; the live editor's kit (WP2's EDITOR_KIT)
// composes the React halves of the SAME kit files, so the two stay in sync by
// construction (kit-parity test enforces it: identical MarkdownPlugin options,
// identical serialization of the fixture corpus).

import { BasicBlocksBaseKit } from "@renderer/editor/kits/basic-blocks-kit";
import { BasicMarksBaseKit } from "@renderer/editor/kits/basic-marks-kit";
import { CalloutBaseKit } from "@renderer/editor/kits/callout-kit";
import { CodeBlockBaseKit } from "@renderer/editor/kits/code-block-kit";
import { ColumnBaseKit } from "@renderer/editor/kits/column-kit";
import { DateBaseKit } from "@renderer/editor/kits/date-kit";
import { EmbedBaseKit } from "@renderer/editor/kits/embed-kit";
import { FrontmatterBaseKit } from "@renderer/editor/kits/frontmatter-kit";
import { ImageBaseKit } from "@renderer/editor/kits/image-kit";
import { LinkBaseKit } from "@renderer/editor/kits/link-kit";
import { ListBaseKit } from "@renderer/editor/kits/list-kit";
import { MarkdownKit } from "@renderer/editor/kits/markdown-kit";
import { MathBaseKit } from "@renderer/editor/kits/math-kit";
import { TableBaseKit } from "@renderer/editor/kits/table-kit";
import { ToggleBaseKit } from "@renderer/editor/kits/toggle-kit";
import { WikiLinkBaseKit } from "@renderer/editor/kits/wiki-link-kit";

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
  ...CalloutBaseKit,
  ...FrontmatterBaseKit,
  ...WikiLinkBaseKit,
  ...MarkdownKit,
];

// BASE_KIT — the headless mirror composition. markdown-doc's gate editor is
// built from exactly this list; the live editor's kit (EDITOR_KIT)
// composes the React halves of the SAME kit files, so the two stay in sync by
// construction (kit-parity test enforces it: identical MarkdownPlugin options,
// identical serialization of the fixture corpus).

import { BasicBlocksBaseKit } from "@repo/editor/kits/basic-blocks-kit";
import { BasicMarksBaseKit } from "@repo/editor/kits/basic-marks-kit";
import { CalloutBaseKit } from "@repo/editor/kits/callout-kit";
import { CodeBlockBaseKit } from "@repo/editor/kits/code-block-kit";
import { ColumnBaseKit } from "@repo/editor/kits/column-kit";
import { DateBaseKit } from "@repo/editor/kits/date-kit";
import { EmbedBaseKit } from "@repo/editor/kits/embed-kit";
import { FrontmatterBaseKit } from "@repo/editor/kits/frontmatter-kit";
import { ImageBaseKit } from "@repo/editor/kits/image-kit";
import { LinkBaseKit } from "@repo/editor/kits/link-kit";
import { ListBaseKit } from "@repo/editor/kits/list-kit";
import { MarkdownKit } from "@repo/editor/kits/markdown-kit";
import { MathBaseKit } from "@repo/editor/kits/math-kit";
import { OpaqueBaseKit } from "@repo/editor/kits/opaque-kit";
import { TableBaseKit } from "@repo/editor/kits/table-kit";
import { ToggleBaseKit } from "@repo/editor/kits/toggle-kit";
import { WikiLinkBaseKit } from "@repo/editor/kits/wiki-link-kit";

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
  ...OpaqueBaseKit,
  ...FrontmatterBaseKit,
  ...WikiLinkBaseKit,
  ...MarkdownKit,
];

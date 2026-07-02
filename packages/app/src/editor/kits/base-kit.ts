// BASE_KIT — the headless mirror composition. markdown-doc's gate editor is
// built from exactly this list; the live editor's kit (WP2's EDITOR_KIT)
// composes the React halves of the SAME kit files, so the two stay in sync by
// construction (kit-parity test enforces it: identical MarkdownPlugin options,
// identical serialization of the fixture corpus).

import { BasicBlocksBaseKit } from "@repo/app/editor/kits/basic-blocks-kit";
import { BasicMarksBaseKit } from "@repo/app/editor/kits/basic-marks-kit";
import { CalloutBaseKit } from "@repo/app/editor/kits/callout-kit";
import { CodeBlockBaseKit } from "@repo/app/editor/kits/code-block-kit";
import { ColumnBaseKit } from "@repo/app/editor/kits/column-kit";
import { DateBaseKit } from "@repo/app/editor/kits/date-kit";
import { EmbedBaseKit } from "@repo/app/editor/kits/embed-kit";
import { FrontmatterBaseKit } from "@repo/app/editor/kits/frontmatter-kit";
import { LinkBaseKit } from "@repo/app/editor/kits/link-kit";
import { ListBaseKit } from "@repo/app/editor/kits/list-kit";
import { MarkdownKit } from "@repo/app/editor/kits/markdown-kit";
import { MathBaseKit } from "@repo/app/editor/kits/math-kit";
import { TableBaseKit } from "@repo/app/editor/kits/table-kit";
import { ToggleBaseKit } from "@repo/app/editor/kits/toggle-kit";
import { WikiLinkBaseKit } from "@repo/app/editor/kits/wiki-link-kit";

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
  ...DateBaseKit,
  ...MathBaseKit,
  ...CalloutBaseKit,
  ...FrontmatterBaseKit,
  ...WikiLinkBaseKit,
  ...MarkdownKit,
];

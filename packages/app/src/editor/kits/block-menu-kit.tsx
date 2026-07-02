// Block menu kit — WP3 fills this file (BlockSelection/BlockMenu plugins +
// the Base UI context menu). Landed empty in WP2 so EDITOR_KIT's composition
// is final and WP3 stays file-disjoint. Constraint carried from WP1: block
// selection must exclude `frontmatter`, `column`, `codeLine`, and `td`.

import type { SlatePlugins } from "platejs";

export const BlockMenuKit: SlatePlugins = [];

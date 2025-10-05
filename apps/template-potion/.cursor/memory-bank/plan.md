# Plate 49.0.0 Migration Plan

## Phase 1: Package Dependencies Migration ✅ **COMPLETE**

### 1.1 Package Renames (Direct 1:1 replacements)

- [x] `@udecode/plate` → `platejs`
- [x] `@udecode/plate-ai` → `@platejs/ai`
- [x] `@udecode/plate-autoformat` → `@platejs/autoformat`
- [x] `@udecode/plate-callout` → `@platejs/callout`
- [x] `@udecode/plate-caption` → `@platejs/caption`
- [x] `@udecode/plate-code-block` → `@platejs/code-block`
- [x] `@udecode/plate-combobox` → `@platejs/combobox`
- [x] `@udecode/plate-comments` → `@platejs/comment` ⚠️ Note: comments → comment
- [x] `@udecode/plate-date` → `@platejs/date`
- [x] `@udecode/plate-diff` → `@platejs/diff`
- [x] `@udecode/plate-dnd` → `@platejs/dnd`
- [x] `@udecode/plate-docx` → `@platejs/docx`
- [x] `@udecode/plate-emoji` → `@platejs/emoji`
- [x] `@udecode/plate-floating` → `@platejs/floating`
- [x] `@udecode/plate-font` → `@platejs/basic-styles`
- [x] `@udecode/plate-indent` → `@platejs/indent`
- [x] `@udecode/plate-indent-list` → `@platejs/list`
- [x] `@udecode/plate-juice` → `@platejs/juice`
- [x] `@udecode/plate-layout` → `@platejs/layout`
- [x] `@udecode/plate-link` → `@platejs/link`
- [x] `@udecode/plate-markdown` → `@platejs/markdown`
- [x] `@udecode/plate-math` → `@platejs/math`
- [x] `@udecode/plate-media` → `@platejs/media`
- [x] `@udecode/plate-mention` → `@platejs/mention`
- [x] `@udecode/plate-resizable` → `@platejs/resizable`
- [x] `@udecode/plate-selection` → `@platejs/selection`
- [x] `@udecode/plate-slash-command` → `@platejs/slash-command`
- [x] `@udecode/plate-suggestion` → `@platejs/suggestion`
- [x] `@udecode/plate-table` → `@platejs/table`
- [x] `@udecode/plate-test-utils` → `@platejs/test-utils`
- [x] `@udecode/plate-toggle` → `@platejs/toggle`

### 1.2 Deprecated Packages (REMOVE from package.json)

- [x] ❌ `@udecode/plate-basic-marks` → Consolidated into `@platejs/basic-nodes`
- [x] ❌ `@udecode/plate-block-quote` → Moved to `@platejs/basic-nodes`
- [x] ❌ `@udecode/plate-break` → Functionality moved to `platejs`
- [x] ❌ `@udecode/plate-heading` → HeadingPlugin → `@platejs/basic-nodes`, TocPlugin → `@platejs/toc`
- [x] ❌ `@udecode/plate-horizontal-rule` → Moved to `@platejs/basic-nodes`
- [x] ❌ `@udecode/plate-node-id` → Now part of core (enabled by default)
- [x] ❌ `@udecode/plate-reset-node` → Replaced by plugin rules configuration
- [x] ❌ `@udecode/plate-select` → Functionality built into core
- [x] ❌ `@udecode/plate-trailing-block` → Moved to platejs (re-exported)

### 1.3 New Packages to Add

- [ ] `@platejs/basic-nodes` (consolidates basic-marks, block-quote, heading, horizontal-rule)
- [ ] `@platejs/toc` (for TocPlugin from heading)
- [ ] `@platejs/basic-styles` (for FontColorPlugin, FontBackgroundColorPlugin from font)

## Phase 2: Import Path Updates ✅ **MOSTLY COMPLETE**

### 2.1 Core Imports ✅

- [x] Update all `'@udecode/plate/react'` → `'platejs/react'`
- [x] Update all `'@udecode/plate'` → `'platejs'`

### 2.2 Plugin Imports ✅

- [x] Update all `@udecode/plate-*` imports to `@platejs/*`
- [x] Special cases:
  - [x] `@udecode/plate-comments` → `@platejs/comment`
  - [x] `@udecode/plate-indent-list` → `@platejs/list`
  - [x] `@udecode/plate-break/react` → `platejs`
  - [x] Basic elements/marks → `@platejs/basic-nodes/react`
  - [x] HeadingPlugin → `@platejs/basic-nodes/react`
  - [x] TocPlugin → `@platejs/toc/react` (used in `toc-plugin.tsx`)

### 2.3 Type Imports

- [ ] Update node type imports `T*Element` and `T*Text` (TImageElement, TParagraphElement, etc.) to import from `platejs`

**🔄 CONSTANTS UPDATE NEEDED:** `INDENT_LIST_KEYS` → `KEYS` from `platejs`:

- [ ] Replace all `INDENT_LIST_KEYS.todo` → `KEYS.listTodo`
- [ ] Replace all `INDENT_LIST_KEYS.listStyleType` → `KEYS.listType`
- [ ] Replace all `INDENT_LIST_KEYS.checked` → `KEYS.listChecked`
- [ ] Update imports: remove `INDENT_LIST_KEYS` from `@platejs/list` imports

## Phase 3: Plugin Configuration Updates ✅ **COMPLETE**

### 3.1 Plugin Renames ✅

- [x] `CommentsPlugin` → `CommentPlugin`
- [x] `IndentListPlugin` → `ListPlugin`

### 3.2 Plugin Key Changes ✅

- [x] Update `CommentsPlugin.key` → `CommentPlugin.key` usage (automatically handled by rename)
- [x] Update `'listStyleType'` key references → `'list'` (automatically handled by rename)

### 3.3 NodeIdPlugin Removal ✅

- [x] Remove `NodeIdPlugin` from explicit plugin lists (now enabled by default)

## Phase 4: API Changes

### 4.1 Editor API Changes

- [x] `editor.getType()` now takes `pluginKey: string` instead of plugin instance
  - [x] Replace all `editor.getType(PluginName)` → `editor.getType(PluginName.key)`
- [x] Replace all `editor.uid` → `editor.meta.uid`

### 4.2 Fragment API Changes

- [ ] Replace `structuralTypes` option with `unwrap` in `editor.api.fragment()`

### 4.3 Plugin Configuration Updates ⚠️ **IN PROGRESS**

- [x] **ExitBreakPlugin** (`exit-break-plugin.ts`): ✅ Already updated to shortcuts-based configuration

- [x] **ResetNodePlugin** (`reset-block-type-plugin.ts`): ✅ Temporarily disabled (needs complete refactor)

  - Plugin has been deprecated and removed
  - Functionality moved to plugin rules configuration (`rules.break` and `rules.delete`)
  - Current file commented out with TODO for proper migration

- [x] **DeletePlugin/SelectOnBackspacePlugin**: ✅ Removed deprecated plugins and file

  - Functionality is now built into Plate core
  - Removed `delete-plugins.ts` file and usage from `editor-plugins.tsx`

- [x] **SoftBreakPlugin**: ✅ Removed deprecated plugin and file

  - Functionality is now built into Plate core
  - Removed `soft-break-plugin.ts` file and usage from `editor-plugins.tsx`

- [x] **CaptionPlugin**: ✅ Updated configuration in all files
  - Updated `media-plugins.tsx` - Changed `plugins` array to `query.allow` with plugin keys
  - Updated `media-toolbar-plugins.tsx` - Changed `plugins` array to `query.allow` with plugin keys
  - Updated `upload-plugins.tsx` - Changed `plugins` array to `query.allow` with plugin keys

## Phase 5: Hook and Utility Updates

### 5.1 Removed Hooks/Utilities

- [ ] Remove usage of `usePlaceholderState` → Use `BlockPlaceholderPlugin` instead

### 5.2 Type Updates

- [ ] Replace `TMentionInputElement` → `TComboboxInputElement`
- [ ] Replace `TSlashInputElement` → `TComboboxInputElement`

## Phase 6: Testing and Validation

### 6.1 Build and Runtime Checks

- [ ] Run `pnpm install` after package.json changes
- [ ] Fix TypeScript compilation errors

### 6.2 Feature Validation

- [ ] Verify read-only mode behavior (editOnly plugins)

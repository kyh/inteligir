// The selector hooks styles.css reads, spelled ONCE. A kit emits one of these
// and the stylesheet's rule is what makes it behave — hide a collapsed
// toggle's body, swap a callout's marker line for its badge — so a spelling
// that drifts between the two is behaviour that silently stops applying, with
// no error anywhere. `__tests__/style-hooks.test.ts` pins the stylesheet to
// this table and refuses a literal re-spelling in any other module.

/** Set on a toggle element while its body is collapsed. */
export const TOGGLE_COLLAPSED_ATTR = "data-toggle-collapsed";

/** An alert blockquote (`> [!NOTE]`), live or static. */
export const CALLOUT_ALERT = "callout-alert";

/** An alert blockquote the caret is inside — its marker bytes are revealed. */
export const CALLOUT_EDITING = "callout-editing";

/** The `[!TYPE]` marker leaf at the head of an alert blockquote. */
export const CALLOUT_MARKER = "callout-marker";

/** A first paragraph that is EXACTLY the marker line. */
export const CALLOUT_MARKER_LINE = "callout-marker-line";

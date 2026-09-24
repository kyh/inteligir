// every selector styles.css reads, spelled once: a spelling that drifts between the two is
// behaviour that silently stops applying.

export const TOGGLE_COLLAPSED_ATTR = "data-toggle-collapsed";

export const CALLOUT_ALERT = "callout-alert";

// the caret is inside the alert, so its marker bytes are revealed.
export const CALLOUT_EDITING = "callout-editing";

export const CALLOUT_MARKER = "callout-marker";

// a first paragraph that is exactly the marker line.
export const CALLOUT_MARKER_LINE = "callout-marker-line";

// typeset's own class, whose :where() rules style the tags; the table rules out-specify them.
export const TYPESET = "typeset";

// the scope the appearance dials feed typeset's size, leading and faces through.
export const TYPESET_DOCS = "typeset-docs";

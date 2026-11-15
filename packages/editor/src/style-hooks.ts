// every selector styles.css reads, spelled once: a spelling that drifts between the two is
// behaviour that silently stops applying.

export const TOGGLE_COLLAPSED_ATTR = "data-toggle-collapsed";

// typeset's own class, whose :where() rules style the tags; the table rules out-specify them.
export const TYPESET = "typeset";

// the scope the appearance dials feed typeset's size, leading and faces through.
export const TYPESET_DOCS = "typeset-docs";

// the frame a diagram draws in, which feeds Pele's variables the app's own tokens.
export const DIAGRAM_PREVIEW = "diagram-preview";

// a long note's run of top-level blocks, which skips its layout and paint while off screen.
export const EDITOR_CHUNK = "editor-chunk";

// a block being dragged, or the one it would land by: its run stops clipping while it lasts.
export const DRAG_OVERHANG_ATTR = "data-drag-overhang";

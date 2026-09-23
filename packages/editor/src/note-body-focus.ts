// the title's Enter hands the caret to the body, keyed by path like the title's own focus. a
// rename remounts the note under its new path only once the carried runtime has read it, so a
// focus asked for across the carry waits here for that body; the next body to register takes
// it, so one that never comes cannot steal the caret later.

const installed = new Map<string, () => void>();
let pending: string | null = null;

export const registerNoteBodyFocus = (path: string, focus: () => void): (() => void) => {
  installed.set(path, focus);
  if (pending !== null) {
    const wanted = pending === path;
    pending = null;
    if (wanted) {
      focus();
    }
  }
  return () => {
    if (installed.get(path) === focus) {
      installed.delete(path);
    }
  };
};

export const focusNoteBody = (path: string): void => {
  const focus = installed.get(path);
  pending = focus === undefined ? path : null;
  focus?.();
};

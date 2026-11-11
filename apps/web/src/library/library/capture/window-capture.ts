// CLAUDE.md § A save from the window is a paste or a drop that no field claimed. A paste lands
// where nothing takes text; a drop lands where no field, row, card or editor took it, and a drop
// that holds nothing to save keeps the browser's own handling. WebKit fires no paste on a target
// that is not editable, so ⌘V there first moves the focus to a 1×1 off-screen catcher, without
// preventing the key, and the paste the key then makes fires on the catcher, which hands the focus
// back, or lets it go when nothing had it (or no paste came). A drag that starts inside the page (a
// picture in the viewer or Quick Look, a selection of text) is never a save: only what comes from
// outside the window is.

import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { RefObject } from "react";

import { isTextEntryTarget } from "../../global-shortcuts";
import { libraryShortcutFor } from "../library-keys";
import { isEmptyPayload, payloadFrom } from "./capture-payload";
import type { CapturePayload } from "./capture-payload";

export interface WindowCaptureOptions {
  // off while another surface covers the workspace
  enabled: boolean;
  // the name of where a save lands (a folder, Unsorted), which the drop's layer says
  into: () => string;
  onCapture: (payload: CapturePayload) => void;
  // the platform's shortcut modifier, ⌘ on a Mac, which the table's save-clipboard row is read by
  modifier: ShortcutModifier;
}

export interface WindowCapture {
  // the off-screen field a ⌘V lands in when nothing else takes text
  catcherRef: RefObject<HTMLTextAreaElement | null>;
  // where a drop over the window would save into, while one is held over it
  dropInto: string | null;
}

// a drag hovers by repeated dragover events; the layer goes once they stop
const DROP_LAYER_LINGER_MS = 150;
// how long the catcher waits for the paste its ⌘V should make: WebKit sends none when its Paste
// command is off, and the focus must not stay in a field nobody sees
const PASTE_WAIT_MS = 250;

const inEditor = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest("[data-slate-editor]") !== null;

// the window's row of the library's table (`../library-keys`), the one its labels are spelled from
const isSaveChord = (event: KeyboardEvent, modifier: ShortcutModifier): boolean =>
  libraryShortcutFor(
    {
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      key: event.key,
      metaKey: event.metaKey,
      nativeEvent: event,
      shiftKey: event.shiftKey,
    },
    "window",
    modifier,
  )?.action === "save-clipboard";

export const useWindowCapture = ({
  enabled,
  into,
  onCapture,
  modifier,
}: WindowCaptureOptions): WindowCapture => {
  const catcherRef = useRef<HTMLTextAreaElement | null>(null);
  const [dropInto, setDropInto] = useState<string | null>(null);
  const capture = useEffectEvent((payload: CapturePayload) => {
    onCapture(payload);
  });
  const intoNow = useEffectEvent(() => into());

  useEffect(() => {
    if (!enabled) {
      return;
    }
    // the element the catcher took the focus from, handed back once the paste has landed
    let returnFocus: HTMLElement | null = null;
    // a drag that started inside the page, from its start to its end: what the window shows is
    // already in the library
    let fromPage = false;
    let lingering: ReturnType<typeof setTimeout> | null = null;
    let waitingPaste: ReturnType<typeof setTimeout> | null = null;
    const hideLayer = (): void => {
      if (lingering !== null) {
        clearTimeout(lingering);
        lingering = null;
      }
      setDropInto(null);
    };

    // the focus back where it was, or nowhere: the body takes no focus, so a focus() on it would
    // leave the catcher holding it
    const restoreFocus = (): void => {
      if (waitingPaste !== null) {
        clearTimeout(waitingPaste);
        waitingPaste = null;
      }
      const back = returnFocus;
      returnFocus = null;
      if (back !== null && back !== document.body && back.isConnected) {
        back.focus({ preventScroll: true });
      }
      if (document.activeElement === catcherRef.current) {
        catcherRef.current?.blur();
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isSaveChord(event, modifier) || isTextEntryTarget(event.target)) {
        return;
      }
      const catcher = catcherRef.current;
      if (catcher === null) {
        return;
      }
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      catcher.value = "";
      catcher.focus({ preventScroll: true });
      if (waitingPaste !== null) {
        clearTimeout(waitingPaste);
      }
      waitingPaste = setTimeout(restoreFocus, PASTE_WAIT_MS);
    };

    const onPaste = (event: ClipboardEvent): void => {
      const onCatcher = event.target === catcherRef.current;
      if (!onCatcher && (isTextEntryTarget(event.target) || inEditor(event.target))) {
        return;
      }
      const payload = payloadFrom(event.clipboardData);
      if (onCatcher) {
        // the catcher never keeps what lands in it, whatever the paste held
        event.preventDefault();
        restoreFocus();
      }
      if (isEmptyPayload(payload)) {
        return;
      }
      event.preventDefault();
      capture(payload);
    };

    // a field's drop is the field's: a link dragged into the composer or Info's address is typed
    // there, never saved
    const accepts = (event: DragEvent): boolean =>
      !event.defaultPrevented &&
      !fromPage &&
      !inEditor(event.target) &&
      !isTextEntryTarget(event.target);

    const onDragOver = (event: DragEvent): void => {
      if (!accepts(event)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = "copy";
      }
      setDropInto(intoNow());
      if (lingering !== null) {
        clearTimeout(lingering);
      }
      lingering = setTimeout(hideLayer, DROP_LAYER_LINGER_MS);
    };

    const onDragStart = (): void => {
      fromPage = true;
    };
    const onDragEnd = (): void => {
      fromPage = false;
      hideLayer();
    };

    const onDrop = (event: DragEvent): void => {
      hideLayer();
      if (!accepts(event)) {
        fromPage = false;
        return;
      }
      const payload = payloadFrom(event.dataTransfer);
      if (isEmptyPayload(payload)) {
        return;
      }
      event.preventDefault();
      capture(payload);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("paste", onPaste, true);
    window.addEventListener("dragstart", onDragStart, true);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onDragEnd, true);
    return () => {
      hideLayer();
      if (waitingPaste !== null) {
        clearTimeout(waitingPaste);
      }
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("paste", onPaste, true);
      window.removeEventListener("dragstart", onDragStart, true);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onDragEnd, true);
    };
  }, [enabled, modifier]);

  // a covered window takes no drop, so it draws no layer for one
  return { catcherRef, dropInto: enabled ? dropInto : null };
};

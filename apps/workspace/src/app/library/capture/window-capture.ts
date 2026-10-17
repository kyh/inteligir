// CLAUDE.md § A SAVE FROM THE WINDOW IS A PASTE OR A DROP THAT NO FIELD CLAIMED. A paste lands
// where nothing takes text; a drop lands where no row, card or editor took it. WebKit fires no
// paste on a target that is not editable, so ⌘V there first moves the focus to a 1×1 off-screen
// catcher, without preventing the key, and the paste the key then makes fires on the catcher,
// which hands the focus back. The window's own drags (cards, folder rows) are moves, never saves.

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { RefObject } from "react";

import { isTextEntryTarget } from "../../global-shortcuts";
import { internalDrag } from "../drag-store";
import { isEmptyPayload, payloadFrom } from "./capture-payload";
import type { CapturePayload } from "./capture-payload";

export interface WindowCaptureOptions {
  // off while another surface covers the workspace
  enabled: boolean;
  // the folder a save lands in, read at the save
  dirFor: () => string;
  onCapture: (payload: CapturePayload, folder: string) => void;
}

export interface WindowCapture {
  // the off-screen field a ⌘V lands in when nothing else takes text
  catcherRef: RefObject<HTMLTextAreaElement | null>;
  // the folder a drop over the window would save into, while one is held over it
  dropInto: string | null;
}

// a drag hovers by repeated dragover events; the layer goes once they stop
const DROP_LAYER_LINGER_MS = 150;

const inEditor = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest("[data-slate-editor]") !== null;

const isPasteChord = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) &&
  !event.altKey &&
  !event.shiftKey &&
  event.key.toLowerCase() === "v";

export const useWindowCapture = ({
  enabled,
  dirFor,
  onCapture,
}: WindowCaptureOptions): WindowCapture => {
  const catcherRef = useRef<HTMLTextAreaElement | null>(null);
  const [dropInto, setDropInto] = useState<string | null>(null);
  const capture = useEffectEvent((payload: CapturePayload) => {
    onCapture(payload, dirFor());
  });
  const folderNow = useEffectEvent(() => dirFor());

  useEffect(() => {
    if (!enabled) {
      return;
    }
    // the element the catcher took the focus from, handed back once the paste has landed
    let returnFocus: HTMLElement | null = null;
    let lingering: ReturnType<typeof setTimeout> | null = null;
    const hideLayer = (): void => {
      if (lingering !== null) {
        clearTimeout(lingering);
        lingering = null;
      }
      setDropInto(null);
    };

    const restoreFocus = (): void => {
      const back = returnFocus;
      returnFocus = null;
      if (back?.isConnected === true) {
        back.focus({ preventScroll: true });
      } else {
        catcherRef.current?.blur();
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isPasteChord(event) || isTextEntryTarget(event.target) || internalDrag() !== null) {
        return;
      }
      const catcher = catcherRef.current;
      if (catcher === null) {
        return;
      }
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      catcher.value = "";
      catcher.focus({ preventScroll: true });
    };

    const onPaste = (event: ClipboardEvent): void => {
      const onCatcher = event.target === catcherRef.current;
      if (!onCatcher && (isTextEntryTarget(event.target) || inEditor(event.target))) {
        return;
      }
      if (internalDrag() !== null) {
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

    const accepts = (event: DragEvent): boolean =>
      !event.defaultPrevented && internalDrag() === null && !inEditor(event.target);

    const onDragOver = (event: DragEvent): void => {
      if (!accepts(event)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = "copy";
      }
      setDropInto(folderNow());
      if (lingering !== null) {
        clearTimeout(lingering);
      }
      lingering = setTimeout(hideLayer, DROP_LAYER_LINGER_MS);
    };

    const onDrop = (event: DragEvent): void => {
      hideLayer();
      if (!accepts(event)) {
        return;
      }
      event.preventDefault();
      const payload = payloadFrom(event.dataTransfer);
      if (!isEmptyPayload(payload)) {
        capture(payload);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("paste", onPaste, true);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", hideLayer);
    return () => {
      hideLayer();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("paste", onPaste, true);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", hideLayer);
    };
  }, [enabled]);

  // a covered window takes no drop, so it draws no layer for one
  return { catcherRef, dropInto: enabled ? dropInto : null };
};

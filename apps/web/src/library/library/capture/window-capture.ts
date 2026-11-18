import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { RefObject } from "react";

import { isTextEntryTarget, shortcutFor } from "../../shortcuts";
import { isEmptyPayload, payloadFrom } from "./capture-payload";
import type { CapturePayload } from "./capture-payload";

export interface WindowCaptureOptions {
  enabled: boolean;
  into: () => string;
  onCapture: (payload: CapturePayload) => void;
  modifier: ShortcutModifier;
}

interface WindowCapture {
  catcherRef: RefObject<HTMLTextAreaElement | null>;
  dropInto: string | null;
}

const DROP_LAYER_LINGER_MS = 150;
const PASTE_WAIT_MS = 250;

const inEditor = (target: EventTarget | null) =>
  target instanceof Element && target.closest("[data-slate-editor]") !== null;

const isSaveChord = (event: KeyboardEvent, modifier: ShortcutModifier) =>
  shortcutFor(event, "paste", modifier)?.action === "save-clipboard";

export const useWindowCapture = ({ enabled, into, onCapture, modifier }: WindowCaptureOptions) => {
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

    let returnFocus: HTMLElement | null = null;
    let fromPage = false;
    let lingering: ReturnType<typeof setTimeout> | null = null;
    let waitingPaste: ReturnType<typeof setTimeout> | null = null;

    const hideLayer = () => {
      if (lingering !== null) {
        clearTimeout(lingering);
        lingering = null;
      }

      setDropInto(null);
    };

    const restoreFocus = () => {
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

    const onKeyDown = (event: KeyboardEvent) => {
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

    const onPaste = (event: ClipboardEvent) => {
      const onCatcher = event.target === catcherRef.current;

      if (!onCatcher && (isTextEntryTarget(event.target) || inEditor(event.target))) {
        return;
      }

      const payload = payloadFrom(event.clipboardData);

      if (onCatcher) {
        event.preventDefault();
        restoreFocus();
      }

      if (isEmptyPayload(payload)) {
        return;
      }

      event.preventDefault();
      capture(payload);
    };

    const accepts = (event: DragEvent) =>
      !event.defaultPrevented &&
      !fromPage &&
      !inEditor(event.target) &&
      !isTextEntryTarget(event.target);

    const onDragOver = (event: DragEvent) => {
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

    const onDragStart = () => {
      fromPage = true;
    };

    const onDragEnd = () => {
      fromPage = false;
      hideLayer();
    };

    const onDrop = (event: DragEvent) => {
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

  return { catcherRef, dropInto: enabled ? dropInto : null } satisfies WindowCapture;
};

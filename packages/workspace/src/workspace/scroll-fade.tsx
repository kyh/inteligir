/**
 * The document dissolving into the canvas at the bottom of the pane.
 *
 * An OVERLAY, deliberately, and not a `mask-image` on the scroll container.
 * A mask on an ancestor kills `backdrop-filter` in every descendant and clips
 * their paint, and the editor's floating surfaces are not all portalled: the
 * slash menu, wiki autocomplete, AI menu and block menu each portal to `body`
 * and would survive it, but the selection toolbar is `position: absolute`
 * INSIDE the editable — a masked scroller would fade it out whenever a
 * selection sits near the bottom of the viewport. The pane's background is a
 * solid token, so a gradient to it is pixel-identical and touches no
 * descendant at all.
 *
 * Sits below the composer (z-30) and above the document, and is inert to the
 * pointer so a click near the bottom of the page still reaches the text.
 */
export function ScrollFade() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-7 z-10 h-24 bg-gradient-to-t from-background to-transparent"
    />
  );
}

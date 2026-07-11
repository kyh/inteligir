// Shared className-only node renderers. Plate plugins ship headless, so most
// nodes render as a fixed tag + className wrapper. Two base components are
// covered: the live editor uses PlateElement/PlateLeaf (platejs/react); the
// read-only transclusion render uses SlateElement (platejs/static) — same
// shape, different render path, so it gets its own factory.

import {
  PlateElement,
  PlateLeaf,
  type PlateElementProps,
  type PlateLeafProps,
} from "platejs/react";
import { SlateElement, type SlateElementProps } from "platejs/static";

/** className-only element renderer over the live PlateElement. */
export function classNameElement(as: keyof HTMLElementTagNameMap, className: string) {
  return function Element(props: PlateElementProps) {
    return <PlateElement {...props} as={as} className={className} />;
  };
}

/** className-only element renderer over the static SlateElement (transclusion). */
export function classNameSlateElement(as: keyof HTMLElementTagNameMap, className: string) {
  return function StaticElement(props: SlateElementProps) {
    return <SlateElement {...props} as={as} className={className} />;
  };
}

/** Semantic-tag leaf renderer over the live PlateLeaf. Marks render as their
 * semantic tag (strong/em/s/code) so typeset's :where() rules style them;
 * className is for the rare functional extra, not typography. */
export function semanticLeaf(as: keyof HTMLElementTagNameMap, className?: string) {
  return function Leaf(props: PlateLeafProps) {
    return <PlateLeaf {...props} as={as} {...(className === undefined ? {} : { className })} />;
  };
}

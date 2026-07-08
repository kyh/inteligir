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

/** className-only leaf renderer over the live PlateLeaf. */
export function classNameLeaf(className: string) {
  return function Leaf(props: PlateLeafProps) {
    return <PlateLeaf {...props} className={className} />;
  };
}

import {
  PlateElement,
  PlateLeaf,
  type PlateElementProps,
  type PlateLeafProps,
} from "platejs/react";
import { SlateElement, type SlateElementProps } from "platejs/static";

export function classNameElement(as: keyof HTMLElementTagNameMap, className: string) {
  return function Element(props: PlateElementProps) {
    return <PlateElement {...props} as={as} className={className} />;
  };
}

export function classNameSlateElement(as: keyof HTMLElementTagNameMap, className: string) {
  return function StaticElement(props: SlateElementProps) {
    return <SlateElement {...props} as={as} className={className} />;
  };
}

// Marks render as their semantic tag so typeset's :where() rules style them; className is not for typography.
export function semanticLeaf(as: keyof HTMLElementTagNameMap, className?: string) {
  return function Leaf(props: PlateLeafProps) {
    return <PlateLeaf {...props} as={as} {...(className === undefined ? {} : { className })} />;
  };
}

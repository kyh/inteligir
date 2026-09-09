import { PlateElement, PlateLeaf } from "platejs/react";
import type { PlateElementProps, PlateLeafProps } from "platejs/react";
import { SlateElement } from "platejs/static";
import type { SlateElementProps } from "platejs/static";

export const classNameElement = (as: keyof HTMLElementTagNameMap, className: string) =>
  function Element(props: PlateElementProps) {
    return <PlateElement {...props} as={as} className={className} />;
  };

export const classNameSlateElement = (as: keyof HTMLElementTagNameMap, className: string) =>
  function StaticElement(props: SlateElementProps) {
    return <SlateElement {...props} as={as} className={className} />;
  };

// Marks render as their semantic tag so typeset's :where() rules style them; className is not for typography.
export const semanticLeaf = (as: keyof HTMLElementTagNameMap, className?: string) =>
  function Leaf(props: PlateLeafProps) {
    return <PlateLeaf {...props} as={as} {...(className === undefined ? {} : { className })} />;
  };

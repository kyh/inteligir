import { PlateElement, PlateLeaf } from "platejs/react";
import type { PlateElementProps, PlateLeafProps } from "platejs/react";

export const classNameElement = (as: keyof HTMLElementTagNameMap, className: string) =>
  function Element(props: PlateElementProps) {
    return <PlateElement {...props} as={as} className={className} />;
  };

export const semanticLeaf = (as: keyof HTMLElementTagNameMap, className?: string) =>
  function Leaf(props: PlateLeafProps) {
    return <PlateLeaf {...props} as={as} {...(className === undefined ? {} : { className })} />;
  };

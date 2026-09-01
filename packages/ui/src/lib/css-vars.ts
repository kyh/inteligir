// @types/react deliberately ships a closed CSSProperties type — custom
// properties (`--foo`) are documented as requiring augmentation or assertion.
// This module is the one sanctioned widening: `cssVars` accepts CSS variables
// alongside standard properties (typos in standard properties still error,
// unlike an `as React.CSSProperties` cast) and returns a plain CSSProperties
// for `style` props.

type CSSPropertiesWithVars = React.CSSProperties & {
  [key: `--${string}`]: string | number | undefined;
};

export function cssVars(style: CSSPropertiesWithVars): React.CSSProperties {
  return style;
}

// @types/react ships a closed CSSProperties, so custom properties need a widening; this one keeps
// typos in standard properties erroring, unlike an `as CSSProperties` cast

type CSSPropertiesWithVars = React.CSSProperties & {
  [key: `--${string}`]: string | number | undefined;
};

export function cssVars(style: CSSPropertiesWithVars): React.CSSProperties {
  return style;
}

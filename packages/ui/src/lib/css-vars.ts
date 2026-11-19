type CSSPropertiesWithVars = React.CSSProperties & {
  [key: `--${string}`]: string | number | undefined;
};

export const cssVars = (style: CSSPropertiesWithVars) => style;

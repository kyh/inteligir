// The only module that imports katex (JS + CSS). equation-node.tsx loads it
// with React.lazy, so the ~280KB renderer and its stylesheet live in an async
// chunk that only downloads when a document actually shows an equation.

import { useEffect, useRef } from "react";
import katex from "katex";

import "katex/dist/katex.min.css";

type Props = {
  tex: string;
  displayMode: boolean;
  className?: string;
};

function KatexView({ tex, displayMode, className }: Props) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    katex.render(tex, ref.current, {
      displayMode,
      errorColor: "#cc0000",
      output: "htmlAndMathml",
      strict: "warn",
      throwOnError: false,
    });
  }, [tex, displayMode]);

  return <span ref={ref} className={className} />;
}

export default KatexView;

// The only module importing katex (JS + CSS), so the ~280KB lands in a lazy chunk.

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

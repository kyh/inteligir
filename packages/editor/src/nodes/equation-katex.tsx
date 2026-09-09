// The only module importing katex (JS + CSS), so the ~280KB lands in a lazy chunk.

import { useEffect, useRef } from "react";
import { render } from "katex";

import "katex/dist/katex.min.css";

interface Props {
  tex: string;
  displayMode: boolean;
  className?: string;
}

const KatexView = ({ tex, displayMode, className }: Props) => {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    render(tex, ref.current, {
      displayMode,
      errorColor: "#cc0000",
      output: "htmlAndMathml",
      strict: "warn",
      throwOnError: false,
    });
  }, [tex, displayMode]);

  return <span ref={ref} className={className} />;
};

export default KatexView;

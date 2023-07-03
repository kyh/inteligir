import { cn } from "~/lib/utils/cn";

const spinnerSizes = {
  xs: "12px",
  sm: "16px",
  md: "24px",
  lg: "32px",
  xl: "48px",
};

type SpinnerSizes = keyof typeof spinnerSizes;

const borderWidth: Record<SpinnerSizes, string> = {
  xs: "3px",
  sm: "3px",
  md: "3px",
  lg: "3px",
  xl: "3px",
};

type SpinnerProps = {
  size?: SpinnerSizes;
  className?: string;
};

function Spinner({ className, size }: SpinnerProps) {
  return (
    <div
      className={cn("spinner", className)}
      style={
        {
          "--spinner-size": spinnerSizes[size || "md"],
          "--spinner-border-width": borderWidth[size || "md"],
        } as React.CSSProperties
      }
    >
      <div className="relative h-full w-full">
        <div className="spinner-line" />
        <div className="spinner-line" />
        <div className="spinner-line" />
      </div>
    </div>
  );
}

export default Spinner;

import { cn } from "../lib/cn";

type SpinnerColor = "white" | "black";

type SpinnerSizes = "xs" | "sm" | "md" | "lg" | "xl";

export type SpinnerProps = {
  color?: SpinnerColor;
  size?: SpinnerSizes;
  className?: string;
};

export const Spinner = ({
  className,
  size = "md",
  color = "white",
}: SpinnerProps) => {
  return (
    <div
      className={cn(
        "spinner",
        `spinner-size-${size}`,
        `spinner-color-${color}`,
        className,
      )}
    >
      <div className="relative h-full w-full">
        <div className="spinner-line" />
        <div className="spinner-line" />
        <div className="spinner-line" />
      </div>
    </div>
  );
};

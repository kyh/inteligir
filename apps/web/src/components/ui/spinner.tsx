import { cn } from "@/lib/cn";

type SpinnerSizes = "xs" | "sm" | "md" | "lg" | "xl";

export type SpinnerProps = {
  size?: SpinnerSizes;
  className?: string;
};

export const Spinner = ({ className, size = "md" }: SpinnerProps) => {
  return (
    <div className={cn("spinner", `spinner-size-${size}`, className)}>
      <div className="relative h-full w-full">
        <div className="spinner-line" />
        <div className="spinner-line" />
        <div className="spinner-line" />
      </div>
    </div>
  );
};

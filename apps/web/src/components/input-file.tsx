import { forwardRef } from "react";
import { clx } from "@inteligir/ui";

// eslint-disable-next-line react/display-name -- forwardRef
const InputFile = forwardRef<
  React.ElementRef<"input">,
  React.InputHTMLAttributes<unknown>
>(({ className, ...props }, ref) => (
  <input
    {...props}
    className={clx(
      "border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
    type="file"
  />
));

export default InputFile;

// Vendored from shadcn/ui (github.com/shadcn-ui/ui), MIT.
import { cn } from "cn";
import { Loader2Icon } from "lucide-react";

const Spinner = ({ className, ...props }: React.ComponentProps<"svg">) => (
  <Loader2Icon
    data-slot="spinner"
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the role sits on the icon itself, and there is no <output> spelling of an <svg>
    role="status"
    aria-label="Loading"
    className={cn("size-4 animate-spin", className)}
    {...props}
  />
);

export { Spinner };

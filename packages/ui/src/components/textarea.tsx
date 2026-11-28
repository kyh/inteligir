// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).
import * as React from "react";

import { fieldClasses } from "@repo/ui/components/input";
import { cn } from "@repo/ui/lib/cn";

const Textarea = ({ className, ...props }: React.ComponentProps<"textarea">) => (
  <textarea
    data-slot="textarea"
    className={cn(
      fieldClasses,
      "field-sizing-content min-h-[76px] max-h-[216px] resize-none py-[7px]",
      className,
    )}
    {...props}
  />
);

export { Textarea };

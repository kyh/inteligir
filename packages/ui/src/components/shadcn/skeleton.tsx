import * as React from "react";

import { clx } from "../../utils/clx";

const Skeleton = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={clx(
      "animate-pulse rounded-md bg-stone-900/10 dark:bg-stone-50/10",
      className,
    )}
    {...props}
  />
);

export { Skeleton };

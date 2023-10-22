import type { FC } from "react";
import { clx } from "@inteligir/ui";

export const Code: FC<React.HTMLProps<HTMLElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <code
      {...props}
      className={clx(
        "rounded-md bg-[#25292e] px-[5px] py-[1px] text-sm text-white",
        className,
      )}
    >
      {children}
    </code>
  );
};

"use client";

import { Tooltip } from "./tooltip";
import { cn } from "../lib/cn";
import { CheckCircle2Icon, CopyIcon } from "../icons";
import { Slot } from "@radix-ui/react-slot";
import copy from "copy-to-clipboard";
import React, { useState } from "react";

type CopyProps = {
  content: string;
  asChild?: boolean;
};

const Copy = React.forwardRef<
  HTMLButtonElement,
  React.HTMLAttributes<HTMLButtonElement> & CopyProps
>(({ children, className, content, asChild = false, ...props }, ref) => {
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("Copy");

  const copyToClipboard = () => {
    setDone(true);
    copy(content);

    setTimeout(() => {
      setDone(false);
    }, 2000);
  };

  React.useEffect(() => {
    if (done) {
      setText("Copied");
      return;
    }

    setTimeout(() => {
      setText("Copy");
    }, 500);
  }, [done]);

  const Component = asChild ? Slot : "button";

  return (
    <Tooltip content={text} open={done || open} onOpenChange={setOpen}>
      <Component
        ref={ref}
        aria-label="Copy code snippet"
        type="button"
        className={cn("h-fit w-fit text-ui-code-icon", className)}
        onClick={copyToClipboard}
        {...props}
      >
        {children ? children : done ? <CheckCircle2Icon className="w-5 h-5" /> : <CopyIcon className="w-5 h-5" />}
      </Component>
    </Tooltip>
  );
});
Copy.displayName = "Copy";

export { Copy };

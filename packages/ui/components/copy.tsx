/* eslint-disable no-nested-ternary -- expected */
"use client";

import { Slot } from "@radix-ui/react-slot";
import copy from "copy-to-clipboard";
import React, { forwardRef, useState } from "react";
import { CheckCircle2Icon, CopyIcon } from "../icons";
import { cn } from "../lib/cn";
import { Tooltip } from "./tooltip";

type CopyProps = {
  content: string;
  asChild?: boolean;
};

const Copy = forwardRef<
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
    <Tooltip content={text} onOpenChange={setOpen} open={done || open}>
      <Component
        aria-label="Copy code snippet"
        className={cn("h-fit w-fit text-ui-code-icon", className)}
        onClick={copyToClipboard}
        ref={ref}
        type="button"
        {...props}
      >
        {children ? (
          children
        ) : done ? (
          <CheckCircle2Icon className="h-5 w-5" />
        ) : (
          <CopyIcon className="h-5 w-5" />
        )}
      </Component>
    </Tooltip>
  );
});
Copy.displayName = "Copy";

export { Copy };

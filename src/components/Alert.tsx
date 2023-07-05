"use client";

import { useMemo, useState } from "react";
import { ComponentProps, deriveClassed } from "@tw-classed/react";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  InfoIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react";
import { classed } from "~/lib/utils";
import { Button } from "~/components/Button";
import If from "~/components/If";

const icons = {
  success: <CheckCircleIcon className="h-5 w-5 rounded-full text-green-700" />,
  error: <AlertCircleIcon className="h-5 w-5 rounded-full text-red-700" />,
  warn: <ShieldAlertIcon className="h-5 w-5 rounded-full text-yellow-700" />,
  info: <InfoIcon className="h-5 w-5 rounded-full text-blue-700" />,
};

const BaseAlert = classed("div", {
  base: "p-4 rounded relative",
  variants: {
    type: {
      success: `bg-green-50 dark:bg-green-500/10 dark:text-green-500 text-green-900`,
      info: `bg-blue-50 dark:bg-blue-500/10 dark:text-blue-500 text-blue-900`,
      error: `bg-red-50 dark:bg-red-500/10 dark:text-red-500 text-red-900`,
      warn: `bg-yellow-50 dark:bg-yellow-500/5 dark:text-yellow-500 text-yellow-800`,
    },
  },
  defaultVariants: {
    type: "info",
  },
});

type AlertProps = ComponentProps<typeof BaseAlert> & {
  heading?: React.ReactNode;
  showClose?: boolean;
};

export const Alert = deriveClassed<typeof BaseAlert, AlertProps>(function Alert(
  { children, showClose, heading, ...props },
  ref
) {
  const [visible, setVisible] = useState(true);
  const Icon = useMemo(
    () => (props.type ? icons[props.type] : null),
    [props.type]
  );

  if (!visible) {
    return null;
  }

  return (
    <BaseAlert ref={ref} {...props}>
      <div className="flex">
        <div className="mt-0.5 shrink-0">{Icon}</div>
        <div className="ml-3">
          {heading && <h3 className="mb-2 text-sm font-medium">{heading}</h3>}
          <div className="text-sm">{children}</div>
        </div>
      </div>
      <If condition={showClose ?? false}>
        <Button
          className="absolute right-0 top-0"
          variant="plain"
          onClick={() => setVisible(false)}
          startIcon={<XIcon />}
          iconSize={20}
        />
      </If>
    </BaseAlert>
  );
});

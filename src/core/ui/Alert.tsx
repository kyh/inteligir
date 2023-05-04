"use client";

import { createContext, useContext, useMemo, useState } from "react";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  ShieldExclamationIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { cva } from "cva";
import Heading from "~/core/ui/Heading";
import IconButton from "~/core/ui/IconButton";
import If from "~/core/ui/If";

type AlertType = "success" | "error" | "warn" | "info";

const icons = {
  success: (className: string) => <CheckCircleIcon className={className} />,
  error: (className: string) => <ExclamationCircleIcon className={className} />,
  warn: (className: string) => <ShieldExclamationIcon className={className} />,
  info: (className: string) => <InformationCircleIcon className={className} />,
};

const AlertContext = createContext<Maybe<AlertType>>(undefined);
const alertClassNameBuilder = getClassNameBuilder();
const alertIconClassNameBuilder = getIconClassNameBuilder();

const Alert: React.FCC<{
  type: "success" | "error" | "warn" | "info";
  useCloseButton?: boolean;
  className?: string;
}> & {
  Heading: typeof AlertHeading;
} = ({ children, type, useCloseButton, className }) => {
  const [visible, setVisible] = useState(true);

  if (!visible) {
    return null;
  }

  const alertClassName = alertClassNameBuilder({ type });

  return (
    <div className={clsx(alertClassName, className)}>
      <AlertContext.Provider value={type}>
        <span className="flex items-center space-x-2">
          <span>{children}</span>
        </span>

        <If condition={useCloseButton ?? false}>
          <IconButton
            className="dark:hover:bg-transparent"
            onClick={() => setVisible(false)}
          >
            <XMarkIcon className="h-6" />
          </IconButton>
        </If>
      </AlertContext.Provider>
    </div>
  );
};

function AlertHeading({ children }: React.PropsWithChildren) {
  const type = useContext(AlertContext);
  const className = alertIconClassNameBuilder({ type });

  const Icon = useMemo(
    () => (type ? icons[type](className) : null),
    [type, className]
  );

  return (
    <div className="mb-2 flex items-center space-x-2">
      <span>{Icon}</span>

      <Heading type={6}>
        <span className="text-base font-semibold">{children}</span>
      </Heading>
    </div>
  );
}

Alert.Heading = AlertHeading;

function getClassNameBuilder() {
  return cva(
    [
      `p-4 rounded relative flex
        items-center justify-between text-black-300 rounded-lg text-sm`,
    ],
    {
      variants: {
        type: {
          success: `bg-green-50 dark:bg-green-500/10 dark:text-green-500 text-green-900`,
          info: `bg-blue-50 dark:bg-blue-500/10 dark:text-blue-500 text-blue-900`,
          error: `bg-red-50 dark:bg-red-500/10 dark:text-red-500 text-red-900`,
          warn: `bg-yellow-50 dark:bg-yellow-500/5 dark:text-yellow-500 text-yellow-800`,
        },
      },
      defaultVariants: {
        type: `info`,
      },
    }
  );
}

function getIconClassNameBuilder() {
  return cva([`rounded-full h-5`], {
    variants: {
      type: {
        success: `text-green-700`,
        info: `text-blue-700`,
        error: `text-red-700`,
        warn: `text-yellow-700`,
      },
    },
    defaultVariants: {
      type: `info`,
    },
  });
}

export default Alert;

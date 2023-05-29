"use client";

import { createContext, useContext, useMemo, useState } from "react";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  ShieldExclamationIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { classed, ComponentProps, deriveClassed } from "@tw-classed/react";
import Heading from "~/components/Heading";
import IconButton from "~/components/IconButton";
import If from "~/components/If";

type AlertType = "success" | "error" | "warn" | "info";

const icons = {
  success: <CheckCircleIcon className="h-5 rounded-full text-green-700" />,
  error: <ExclamationCircleIcon className="h-5 rounded-full text-red-700" />,
  warn: <ShieldExclamationIcon className="h-5 rounded-full text-yellow-700" />,
  info: <InformationCircleIcon className="h-5 rounded-full text-blue-700" />,
};

const AlertContext = createContext<Maybe<AlertType>>(undefined);

const BaseAlert = classed("div", {
  base: "p-4 rounded relative flex items-center justify-between text-black-300 rounded-lg text-sm",
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

export type AlertProps = ComponentProps<typeof BaseAlert> & {
  showClose?: boolean;
};

const DerivedBaseAlert = deriveClassed<typeof BaseAlert, AlertProps>(
  function DerivedBaseAlert({ children, showClose, ...props }, ref) {
    const [visible, setVisible] = useState(true);

    if (!visible) {
      return null;
    }

    return (
      <BaseAlert ref={ref} {...props}>
        <AlertContext.Provider value={props.type}>
          <span className="flex items-center space-x-2">
            <span>{children}</span>
          </span>
          <If condition={showClose ?? false}>
            <IconButton
              className="dark:hover:bg-transparent"
              onClick={() => setVisible(false)}
            >
              <XMarkIcon className="h-6" />
            </IconButton>
          </If>
        </AlertContext.Provider>
      </BaseAlert>
    );
  }
);

const AlertHeading = ({ children }: React.PropsWithChildren) => {
  const type = useContext(AlertContext);
  const Icon = useMemo(() => (type ? icons[type] : null), [type]);

  return (
    <div className="mb-2 flex items-center space-x-2">
      <span>{Icon}</span>
      <Heading type={6}>
        <span className="text-base font-semibold">{children}</span>
      </Heading>
    </div>
  );
};

type AlertComponentType = typeof DerivedBaseAlert & {
  Heading: typeof AlertHeading;
};

export const Alert = DerivedBaseAlert as AlertComponentType;

Alert.Heading = AlertHeading;

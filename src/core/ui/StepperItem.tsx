import { Fragment } from "react";
import { Tab } from "@headlessui/react";
import clsx from "clsx";

function StepperItem({
  step,
  onSelect,
  className,
  children,
  disabled,
}: React.PropsWithChildren<{
  step: number;
  className?: string;
  disabled?: boolean;
  onSelect?: () => void;
}>) {
  return (
    <>
      <Tab as={Fragment}>
        {({ selected }) => {
          return (
            <button
              disabled={disabled}
              className={clsx(
                `StepperStep`,
                {
                  StepperStepSelected: selected,
                  StepperStepClickable: onSelect,
                },
                className
              )}
              onClick={onSelect}
            >
              <div className="StepperStepCircle">{step}</div>

              <div>
                <span className="text-sm font-bold">{children}</span>
              </div>
            </button>
          );
        }}
      </Tab>

      <StepperDivider />
    </>
  );
}

export default StepperItem;

function StepperDivider() {
  return <div className="StepperDivider" />;
}

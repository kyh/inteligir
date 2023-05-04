import { RadioGroup as HeadlessRadioGroup } from "@headlessui/react";
import clsx from "clsx";
import If from "~/core/ui/If";

export interface RadioItemModel {
  label: string;
  description?: string;

  [key: string]: unknown;
}

function RadioGroup<Value = unknown>(
  props: React.PropsWithChildren<{
    className?: string;
    value: Maybe<Value>;
    setValue: (value: Value) => void;
  }>
) {
  return (
    <HeadlessRadioGroup
      className={props.className}
      value={props.value ?? null}
      onChange={props.setValue}
    >
      <div className="w-full space-y-2.5">{props.children}</div>
    </HeadlessRadioGroup>
  );
}

function RadioOption<Item extends RadioItemModel>({
  item,
  className,
  ...props
}: React.PropsWithChildren<
  {
    item: Item;
  } & React.InputHTMLAttributes<unknown>
>) {
  return (
    <HeadlessRadioGroup.Option
      {...props}
      value={item}
      className={({ active, checked }) =>
        clsx(
          className,
          `relative flex cursor-pointer rounded-lg border border-gray-200
        px-5 py-4 shadow-sm transition-all duration-100
        focus:outline-none dark:border-black-400`,
          {
            [`hover:border-gray-300 hover:bg-gray-50
        active:bg-gray-200 dark:bg-black-200
        dark:hover:bg-black-300 dark:active:bg-black-100`]: !active,
            ["bg-gray-100 bg-primary-500/10 ring-2 ring-primary-500" +
            " dark:bg-black-300"]: checked,
          }
        )
      }
    >
      {({ checked }) => (
        <>
          <div className="flex w-full items-center justify-between">
            <div className="flex w-full items-center space-x-6">
              <div className="flex-shrink-0">
                <If condition={checked} fallback={<UncheckIcon />}>
                  <CheckIcon className="h-6 w-6 rounded-full bg-primary-500 fill-transparent" />
                </If>
              </div>

              <div className="flex-auto text-sm">
                <HeadlessRadioGroup.Label
                  as="p"
                  className={clsx(
                    `text-sm font-semibold text-current dark:text-white`,
                    {
                      "text-primary-900": checked,
                    }
                  )}
                >
                  {item.label}
                </HeadlessRadioGroup.Label>

                <If condition={item.description}>
                  <HeadlessRadioGroup.Description
                    as="span"
                    className={clsx(`inline text-sm`, {
                      "text-primary-800 dark:text-gray-300": checked,
                      "text-gray-500 dark:text-gray-400": !checked,
                    })}
                  >
                    {item.description}
                  </HeadlessRadioGroup.Description>
                </If>
              </div>

              <If condition={props.children}>{props.children}</If>
            </div>
          </div>
        </>
      )}
    </HeadlessRadioGroup.Option>
  );
}

export default RadioGroup;

RadioGroup.Option = RadioOption;

function CheckIcon(props: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <circle cx={12} cy={12} r={12} fill="#fff" opacity="0.2" />
      <path
        d="M7 13l3 3 7-7"
        stroke="#fff"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UncheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6">
      <circle cx={12} cy={12} r={12} fill="currentColor" opacity="0.2" />;
    </svg>
  );
}

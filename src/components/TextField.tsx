"use client";

import React, { forwardRef } from "react";
import { Transition } from "@headlessui/react";
import clsx from "clsx";
import Label from "./Label";

type Props = React.InputHTMLAttributes<unknown>;

const Hint: React.FC<React.PropsWithChildren> = ({ children }) => {
  return <span className="text-sm text-gray-500">{children}</span>;
};

const Input = forwardRef<React.ElementRef<"input">, Props>(
  function TextFieldInputComponent(
    { className, children, defaultValue, ...props },
    ref
  ) {
    return (
      <input
        {...props}
        className={clsx(
          "block w-full rounded-md border-0 bg-white/5 py-1.5 text-white shadow-sm ring-1 ring-inset ring-white/10 transition focus:ring-2 focus:ring-inset focus:ring-primary-500 sm:text-sm sm:leading-6",
          className
        )}
        ref={ref}
      />
    );
  }
);

type TextFieldComponent = React.FC<
  React.PropsWithChildren<{
    className?: string;
  }>
> & {
  Label: typeof Label;
  Hint: typeof Hint;
  Input: typeof Input;
  Error: typeof ErrorMessage;
};

const TextField: TextFieldComponent = ({ children, className }) => {
  return (
    <div className={clsx(`flex flex-col space-y-1`, className)}>{children}</div>
  );
};

const ErrorMessage: React.FC<
  { error: Maybe<string> } & React.HTMLAttributes<unknown>
> = ({ error, ...props }) => {
  const shouldDisplay = !!error;

  return (
    <Transition
      show={shouldDisplay}
      appear={shouldDisplay}
      enter="ease-out duration-200"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="ease-in duration-50"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <Hint>
        <span {...props} className="py-0.5 text-red-700 dark:text-red-500">
          {error}
        </span>
      </Hint>
    </Transition>
  );
};

TextField.Hint = Hint;
TextField.Label = Label;
TextField.Input = Input;
TextField.Error = ErrorMessage;

export default TextField;

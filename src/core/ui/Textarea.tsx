"use client";

import { forwardRef, useCallback } from "react";
import clsx from "clsx";

const Textarea = forwardRef<
  React.ElementRef<"textarea">,
  React.TextareaHTMLAttributes<unknown> & {
    autoResize?: boolean;
  }
>(function TextareaComponent({ className, ...props }, ref) {
  const onInput = useAutoResize(props.onInput);

  return (
    <textarea
      ref={ref}
      {...props}
      onInput={props.autoResize ? onInput : props.onInput}
      className={clsx(
        `relative flex h-10 min-h-[60px] w-full flex-auto resize-none
         items-center rounded-md border border-gray-200 bg-transparent bg-white
         px-2 py-2 font-medium text-gray-800 shadow-sm outline-none ring-primary-200 ring-offset-1
         transition-all hover:border-gray-300 hover:bg-gray-50 focus:border-transparent focus:outline-none
         focus:ring-2 active:ring-2 dark:border-black-200 dark:bg-black-400 dark:text-gray-200
         dark:hover:border-black-100 dark:focus:bg-black-400 dark:focus:ring-primary-500/70
         dark:focus:ring-offset-black-500 lg:text-sm`,
        className,
        {
          [`cursor-not-allowed bg-gray-100 hover:bg-gray-100 dark:bg-black-400`]:
            props.disabled,
        }
      )}
    />
  );
});

export default Textarea;

function useAutoResize(onInput?: React.FormEventHandler<HTMLTextAreaElement>) {
  const callback: React.FormEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      const target = event.currentTarget;

      target.style.height = "";
      target.style.height = target.scrollHeight + "px";

      if (onInput) {
        onInput(event);
      }
    },
    [onInput]
  );

  return callback;
}

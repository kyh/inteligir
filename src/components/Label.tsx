import { createElement } from "react";
import clsx from "clsx";

type Props = React.LabelHTMLAttributes<unknown> & {
  as?: string;
};

const Label: React.FCC<Props> = ({ children, className, as, ...props }) => {
  const tag = as ?? `label`;

  return createElement(
    tag,
    {
      className: clsx(
        `w-full text-sm font-medium text-gray-500 dark:text-gray-400 [&>*]:mt-[0.35rem]`,
        className
      ),
      ...props,
    },
    children
  );
};

export default Label;

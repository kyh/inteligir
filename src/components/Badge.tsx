import clsx from "clsx";
import { cva } from "cva";

type Color = `normal` | "success" | "warn" | "error" | "info" | "custom";
type Size = `normal` | `small`;

const classNameBuilder = getClassNameBuilder();

const Badge: React.FCC<{
  color?: Color;
  size?: Size;
  className?: string;
}> = ({ children, color, size, ...props }) => {
  const className = classNameBuilder({
    color,
    size,
  });

  return <div className={clsx(className, props.className)}>{children}</div>;
};

function getClassNameBuilder() {
  return cva([`flex space-x-2 items-center font-medium`], {
    variants: {
      color: {
        normal: `text-gray-500 bg-gray-100 dark:text-gray-300 dark:bg-black-300`,
        success: `bg-green-50 dark:bg-green-500/10 text-green-700`,
        warn: `bg-yellow-50 dark:bg-yellow-100/10 text-yellow-800`,
        error: `bg-red-50 dark:bg-red-500/10 text-red-800`,
        info: `bg-blue-50 dark:bg-blue-500/10 text-blue-800`,
        custom: "",
      },
      size: {
        normal: `rounded-lg px-3 py-2 text-sm`,
        small: `rounded px-2 py-1 text-xs`,
        custom: "",
      },
    },
    defaultVariants: {
      color: `normal`,
      size: `normal`,
    },
  });
}

export default Badge;

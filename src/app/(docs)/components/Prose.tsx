import clsx from "clsx";

type ProseProps = {
  as?: React.ElementType;
  className?: string;
  children: React.ReactNode;
};

export function Prose({
  as: Component = "div",
  className,
  ...props
}: ProseProps) {
  return (
    <Component
      className={clsx(className, "prose dark:prose-invert")}
      {...props}
    />
  );
}

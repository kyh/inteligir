import { cn } from "~/lib/utils/cn";

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
      className={cn(className, "prose dark:prose-invert")}
      {...props}
    />
  );
}

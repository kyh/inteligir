import { cn } from "~/lib/cn";

export const HorizontalLine: React.FC<{ className?: string }> = ({
  className,
}) => {
  return <hr className={cn("my-8 border-gray-100", className)} />;
};

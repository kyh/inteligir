import { cn } from "~/lib/utils/cn";

const SubHeading: React.FCC<{
  className?: string;
}> = ({ children, className }) => {
  return (
    <h2
      className={cn(
        `font-heading text-lg font-normal text-zinc-500 dark:text-zinc-400`,
        className
      )}
    >
      {children}
    </h2>
  );
};

export default SubHeading;

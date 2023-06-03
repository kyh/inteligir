import { cn } from "~/lib/utils/cn";

const NavigationContainer: React.FCC<{
  className?: string;
}> = ({ children, className }) => {
  return (
    <div className={cn(`border-b border-zinc-400`, className)}>{children}</div>
  );
};

export default NavigationContainer;

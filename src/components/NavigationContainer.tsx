import clsx from "clsx";

const NavigationContainer: React.FCC<{
  className?: string;
}> = ({ children, className }) => {
  return (
    <div className={clsx(`border-b border-zinc-400`, className)}>
      {children}
    </div>
  );
};

export default NavigationContainer;

import clsx from "clsx";

const NavigationContainer: React.FCC<{
  className?: string;
}> = ({ children, className }) => {
  return (
    <div
      className={clsx(
        `border-b border-gray-50 dark:border-black-400 dark:border-black-400`,
        className
      )}
    >
      {children}
    </div>
  );
};

export default NavigationContainer;

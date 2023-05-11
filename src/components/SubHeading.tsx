import clsx from "clsx";

const SubHeading: React.FCC<{
  className?: string;
}> = ({ children, className }) => {
  return (
    <h2
      className={clsx(
        `font-heading text-lg font-normal text-gray-500 dark:text-gray-400`,
        className
      )}
    >
      {children}
    </h2>
  );
};

export default SubHeading;

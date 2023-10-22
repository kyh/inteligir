import { clx } from "@inteligir/ui";

type NavigationContainerProps = {
  className?: string;
  children: React.ReactNode;
};

export const NavigationContainer = ({
  children,
  className,
}: NavigationContainerProps) => {
  return (
    <div
      className={clx(
        `dark:border-dark-800 dark:border-dark-800 border-b border-gray-50`,
        className,
      )}
    >
      {children}
    </div>
  );
};

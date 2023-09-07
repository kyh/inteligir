export const Section: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return <div className="mx-auto max-w-7xl py-12 px-6 md:px-8">{children}</div>;
};

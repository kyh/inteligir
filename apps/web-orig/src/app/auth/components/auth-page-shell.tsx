import { Logo } from "ui/components/logo";

const AuthPageShell = ({
  children,
}: React.PropsWithChildren<{
  language?: string;
}>) => {
  return (
    <div
      className={
        "flex h-screen flex-col items-center justify-center space-y-4" +
        " dark:lg:bg-background md:space-y-8 lg:space-y-16 lg:bg-gray-50" +
        " duration-1000 animate-in fade-in slide-in-from-top-8"
      }
    >
      <Logo />

      <div className="dark:bg-background dark:shadow-primary/30 dark:md:border-dark-800 flex w-full max-w-sm flex-col items-center space-y-4 rounded-xl border-transparent bg-white px-2 py-1 dark:shadow-[0_0_1200px_0] md:w-8/12 md:border md:px-8 md:py-6 md:shadow-xl lg:w-5/12 lg:px-6 xl:w-4/12 2xl:w-3/12">
        {children}
      </div>
    </div>
  );
};

export default AuthPageShell;

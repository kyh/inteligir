import type { PropsWithChildren } from "react";
import { cn } from "~/lib/utils";
import If from "~/components/If";
import { Logo } from "~/components/Logo";
import Spinner from "~/components/Spinner";

const PageLoadingIndicator = ({
  children,
  fullPage,
  displayLogo,
  className,
}: PropsWithChildren<{
  className?: string;
  fullPage?: boolean;
  displayLogo?: boolean;
}>) => {
  const useFullPage = fullPage ?? true;
  const shouldDisplayLogo = displayLogo ?? true;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center space-y-6",
        className,
        {
          [`fixed left-0 top-0 z-[100] h-screen w-screen bg-white dark:bg-zinc-500`]:
            useFullPage,
        }
      )}
    >
      <If condition={shouldDisplayLogo}>
        <div className="my-2">
          <Logo />
        </div>
      </If>

      <div className="text-emerald-500">
        <Spinner className="h-12 w-12" />
      </div>

      <div className="text-sm font-medium">{children}</div>
    </div>
  );
};

export default PageLoadingIndicator;

import Link from "next/link";
import loadAuthPageData from "~/lib/server/loaders/load-auth-page-data";
import { Logo } from "~/components/Logo";
import { Toaster } from "~/components/Toaster";

export const dynamic = "force-dynamic";

const AuthLayout = async ({ children }: React.PropsWithChildren) => {
  await loadAuthPageData();

  return (
    <>
      <Toaster position="top-center" />
      <div className="flex h-screen flex-col items-center justify-center space-y-4 md:space-y-8">
        <div className="flex w-full max-w-sm flex-col items-center space-y-4 rounded-xl border-transparent bg-zinc-950 px-2 py-1 dark:shadow-[0_0_1200px_0] dark:shadow-emerald-400/20 md:w-8/12 md:border md:border-white/10 md:px-8 md:py-6 md:shadow-xl lg:w-5/12 lg:px-6 xl:w-4/12 2xl:w-3/12">
          <Link href="/">
            <Logo />
          </Link>
          {children}
        </div>
      </div>
    </>
  );
};

export default AuthLayout;

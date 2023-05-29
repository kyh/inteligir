import Link from "next/link";
import { Logo } from "~/components/Logo";

function AuthPageShell({ children }: React.PropsWithChildren) {
  return (
    <div className="flex h-screen flex-col items-center justify-center space-y-4 md:space-y-8">
      <div className="flex w-full max-w-sm flex-col items-center space-y-4 rounded-xl border-transparent bg-white px-2 py-1 dark:bg-black-500 dark:shadow-[0_0_1200px_0] dark:shadow-primary-400/20 md:w-8/12 md:border md:px-8 md:py-6 md:shadow-xl dark:md:border-black-300 lg:w-5/12 lg:px-6 xl:w-4/12 2xl:w-3/12">
        <Link href="/">
          <Logo />
        </Link>
        {children}
      </div>
    </div>
  );
}

export default AuthPageShell;

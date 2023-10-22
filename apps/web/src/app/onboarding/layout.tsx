import { Logo } from "@inteligir/ui";
import Link from "next/link";

const OnboardingLayout = ({ children }: React.PropsWithChildren) => {
  return (
    <div className="dark:bg-background flex flex-1 flex-col">
      <div className="dark:divide-dark-700 flex divide-x divide-gray-100">
        <div
          className={
            "flex h-screen w-full flex-1 flex-col items-center" +
            " mx-auto justify-center lg:w-6/12 xl:max-w-3xl"
          }
        >
          <div className="absolute top-12 xl:top-24">
            <Link href="/onboarding">
              <Logo />
            </Link>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
};

export default OnboardingLayout;

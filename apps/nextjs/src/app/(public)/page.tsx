import { cookies } from "next/headers";
import { Steps } from "./components/steps";
import { LogoCloud } from "./components/logo-cloud";
import { Hero } from "./components/hero";
import { WaitlistForm } from "./components/waitlist-form";

const Page = () => {
  const email = cookies().get("registered_waitlist")?.value;

  return (
    <>
      <Hero>
        <WaitlistForm defaultEmail={email} />
        {email ? (
          <div className="absolute mt-2 text-xs text-green-800 animate-in fade-in">
            You are on the waitlist
          </div>
        ) : null}
      </Hero>
      <LogoCloud />
      <Steps />
    </>
  );
};

export default Page;

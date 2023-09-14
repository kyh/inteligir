import { Head } from "~/components/ui/head";
import { Steps } from "./components/steps";
import { LogoCloud } from "./components/logo-cloud";
import { Hero } from "./components/hero";
import { WaitlistForm } from "./components/waitlist-form";
import { cookies } from "next/headers";

export default async function LandingPage() {
  const email = cookies().get("registered_waitlist")?.value;

  return (
    <>
      <Head
        title="Demorepo - a modern tool"
        description="A modern tool to help your business collaborate and grow"
        image="https://framerusercontent.com/screenshots/U10Ma2ZnGwFCA5tjS4wsy53KbmE.png"
      />
      <Hero>
        <WaitlistForm defaultEmail={email} />
      </Hero>
      <LogoCloud />
      <Steps />
    </>
  );
}

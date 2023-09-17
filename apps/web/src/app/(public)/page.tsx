import { Head } from "ui/components/head";
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
        title="Inteligir - Build a data-informed team"
        description="Break silos with comprehensive metrics reports and actionable insights, all on autopilot, so that you can make data-informed decisions."
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

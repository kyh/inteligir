import { About } from "./components/About";
import { GetStarted } from "./components/GetStarted";
import { Hero } from "./components/Hero";
import { PrimaryButton } from "./components/HomeButton";
import { Review } from "./components/Review";

export default function Home() {
  return (
    <main className="site-container mx-auto text-center">
      <Hero
        title="Personalized AI assistants"
        subtitle="built for teams"
        description={
          <>
            A multiplayer, privacy-first, hyper-relevant AI assistant <br />{" "}
            that fits effortlessly in your organization workflow
          </>
        }
        action={<PrimaryButton>Request Early Access &rarr;</PrimaryButton>}
      />
      <About />
      <Review />
      <GetStarted />
    </main>
  );
}

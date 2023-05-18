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
            A multi-platform, privacy-first, and hyper-relevant AI bot <br />{" "}
            that fits effortlessly into your workflow
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

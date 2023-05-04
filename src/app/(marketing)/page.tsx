import { About } from "./components/About";
import { GetStarted } from "./components/GetStarted";
import { Hero } from "./components/Hero";
import { PrimaryButton } from "./components/HomeButton";
import { Review } from "./components/Review";
import { Steps } from "./components/Steps";
import { Try } from "./components/Try";

export default function Home() {
  return (
    <main className="site-container mx-auto text-center">
      <Hero>
        <div className="mt-8 grid items-start justify-center">
          <PrimaryButton>Request Early Access &rarr;</PrimaryButton>
        </div>
      </Hero>
      <About />
      <Steps />
      <Try />
      <Review />
      <GetStarted />
    </main>
  );
}

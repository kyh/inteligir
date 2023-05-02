import { Hero } from "./components/Hero";
import { PrimaryButton } from "./components/HomeButton";
import { About } from "./components/About";
import { Steps } from "./components/Steps";
import { Try } from "./components/Try";
import { Review } from "./components/Review";
import { GetStarted } from "./components/GetStarted";

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

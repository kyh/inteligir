import { Hero } from "./components-2/Hero";
import { PrimaryButton } from "./components-2/HomeButton";
import { About } from "./components-2/About";
import { Steps } from "./components-2/Steps";
import { Try } from "./components-2/Try";
import { Review } from "./components-2/Review";
import { GetStarted } from "./components-2/GetStarted";

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

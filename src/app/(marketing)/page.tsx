import { About } from "./components/About";
import { GetStarted } from "./components/GetStarted";
import { Hero } from "./components/Hero";
import { Review } from "./components/Review";

export default function Home() {
  return (
    <main className="site-container mx-auto text-center">
      <Hero />
      <About />
      <Review />
      <GetStarted />
    </main>
  );
}

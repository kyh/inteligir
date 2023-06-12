import { About } from "./components/About";
import { Hero } from "./components/Hero";

export default function Home() {
  return (
    <main className="site-container mx-auto text-center">
      <Hero />
      <About />
    </main>
  );
}

import { About } from "./components/About";
import { Hero } from "./components/Hero";

const Home = () => {
  return (
    <main className="site-container mx-auto text-center">
      <Hero />
      <About />
    </main>
  );
};

export default Home;

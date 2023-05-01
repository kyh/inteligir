const Hero: React.FCC = ({ children }) => {
  return (
    <h1
      className="my-2 text-3xl font-medium
        tracking-tight dark:text-white
        sm:my-6 md:leading-none lg:text-4xl"
    >
      {children}
    </h1>
  );
};

export default Hero;

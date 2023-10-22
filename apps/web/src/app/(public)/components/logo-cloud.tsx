export const LogoCloud = () => {
  return (
    <section>
      <div className="container max-w-6xl py-12">
        <div className="grid grid-cols-1 items-center py-12 md:grid-cols-2 lg:grid-cols-4 lg:gap-24">
          <div className="col-span-full mx-auto lg:col-span-1 lg:mr-auto lg:max-w-none">
            <p className="text-xs lg:leading-5">
              Companies of all sizes trust Inteligir to deliver their insights
            </p>
          </div>
          <div className="mt-12 md:col-span-3 lg:mt-0">
            <div className="flex flex-wrap justify-between">
              <img alt="logo" className="h-8" src="/logos/airbnb.svg" />
              <img alt="logo" className="h-8" src="/logos/basecamp.svg" />
              <img alt="logo" className="h-8" src="/logos/dribbble.svg" />
              <img
                alt="logo"
                className="hidden h-8 sm:block"
                src="/logos/spacex.svg"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

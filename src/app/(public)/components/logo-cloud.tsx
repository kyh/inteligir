export const LogoCloud = () => {
  return (
    <section>
      <div className="mx-auto px-8 max-w-6xl py-12">
        <div className="items-center grid grid-cols-1 lg:gap-24 lg:grid-cols-4 md:grid-cols-2 py-12">
          <div className="mx-auto col-span-full lg:col-span-1 lg:max-w-none lg:mr-auto">
            <p className="text-xs lg:leading-5">
              Companies of all sizes trust Inteligir to deliver their insights
            </p>
          </div>
          <div className="mt-12 lg:mt-0 md:col-span-3">
            <div className="flex justify-between flex-wrap">
              <img alt="logo" className="h-8" src="/logos/airbnb.svg" />
              <img alt="logo" className="h-8" src="/logos/basecamp.svg" />
              <img alt="logo" className="h-8" src="/logos/dribbble.svg" />
              <img
                alt="logo"
                className="h-8 hidden sm:block"
                src="/logos/spacex.svg"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

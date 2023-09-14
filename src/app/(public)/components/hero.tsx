export const Hero = ({ children }: { children: React.ReactNode }) => {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-x-0 justify-center w-32 ml-auto rounded-lg opacity-50 bg-gradient-to-r from-brand-50 via-brand-200 to-brand-600 h-42 lg:-top-64 lg:w-96 lg:h-96 blur-3xl"></div>
      <div className="relative px-8 py-24 mx-auto max-w-6xl lg:py-56">
        <div>
          <h1 className="pb-2 text-4xl font-normal tracking-tight text-transparent bg-gradient-to-r from-brand-50 via-brand-300 to-brand-600 bg-clip-text font-display sm:text-6xl">
            Build a data-informed team
            <span className="lg:block">with weekly metrics reports</span>
          </h1>
          <p className="max-w-xl mt-4 text-brand-300">
            Break silos with comprehensive metrics reports and actionable
            insights, all on autopilot, so that you can make data-informed
            decisions
          </p>
          <div className="mt-12">{children}</div>
        </div>

        <div className="grid flex-col justify-between gap-2 mt-12 gird-cols-1 lg:grid-cols-3 md:grid-cols-2 w-lg">
          <div className="h-full p-2 bg-gradient-to-t from-white/20 ring-1 ring-white/10 rounded-3xl lg:mt-24">
            <div className="flex flex-col justify-between h-full p-4 overflow-hidden shadow-massive ring-1 ring-white/10 rounded-2xl bg-brand-900">
              <div>
                <img src="/screenshots/widget6.svg" />
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="text-sm text-brand-300 font-display">
                  How engaged are the power users of my product?
                </p>
                <p className="text-md text-white">
                  The share of power users has been increasing this month (+12%
                  change d/d).
                </p>
              </div>
            </div>
          </div>

          <div className="h-full p-2 bg-gradient-to-t from-white/20 ring-1 ring-white/10 rounded-3xl">
            <div className="flex flex-col justify-between h-full p-4 overflow-hidden shadow-massive ring-1 ring-white/10 rounded-2xl bg-brand-900">
              <div>
                <img src="/screenshots/widget5.svg" />
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="text-sm text-brand-300 font-display">
                  How is short and long-term retention trending with each new
                  cohort?
                </p>
                <p className="text-md text-white">
                  The current cohort is doing much better than the cohort one
                  quarter ago (+20% retention).
                </p>
              </div>
            </div>
          </div>

          <div className="h-full p-2 bg-gradient-to-t from-white/20 ring-1 ring-white/10 rounded-3xl lg:-mt-24">
            <div className="flex flex-col justify-between h-full p-4 overflow-hidden shadow-massive ring-1 ring-white/10 rounded-2xl bg-brand-900">
              <div>
                <img src="/screenshots/widget4.svg" />
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="text-sm text-brand-300 font-display">
                  Which feature usage leads to the highest user retention?
                </p>
                <p className="text-md text-white">
                  Users who share a post within their first week are more likely
                  to retain (+25% than overall).
                </p>
              </div>
            </div>
          </div>

          <div className="h-full p-2 bg-gradient-to-t from-white/20 ring-1 ring-white/10 rounded-3xl lg:mt-24">
            <div className="flex flex-col justify-between h-full p-4 overflow-hidden shadow-massive ring-1 ring-white/10 rounded-2xl bg-brand-900">
              <div>
                <img src="/screenshots/widget3.svg" />
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="text-sm text-brand-300 font-display">
                  Which slow-moving trends in new user growth are concerning?
                </p>
                <p className="text-md text-white">
                  Retention of customers acquired via Facebook ads is trending
                  down for 16 weeks now.
                </p>
              </div>
            </div>
          </div>

          <div className="h-full p-2 bg-gradient-to-t from-white/20 ring-1 ring-white/10 rounded-3xl">
            <div className="flex flex-col justify-between h-full p-4 overflow-hidden shadow-massive ring-1 ring-white/10 rounded-2xl bg-brand-900">
              <div>
                <img src="/screenshots/widget2.svg" />
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="text-sm text-brand-300 font-display">
                  What’s my growth forecast? Am I likely to hit my growth goal?
                </p>
                <p className="text-md text-white">
                  Grow at 10% w/w to hit the May Goal, currently expected to be
                  missed by 1M.
                </p>
              </div>
            </div>
          </div>

          <div className="p-2 bg-gradient-to-t from-white/20 ring-1 ring-white/10 rounded-3xl lg:-mt-24">
            <div className="flex flex-col justify-between h-full p-4 overflow-hidden shadow-massive ring-1 ring-white/10 rounded-2xl bg-brand-900">
              <div>
                <img src="/screenshots/widget1.svg" />
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="text-sm text-brand-300 font-display">
                  What opportunities are there to optimize my acquisition
                  funnel?
                </p>
                <p className="text-md text-white">
                  Raising conversion rate of Brazil Android users to overall avg
                  would lead to $150K increase in ARR.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export const Hero = ({ children }: { children: React.ReactNode }) => {
  return (
    <section className="relative overflow-hidden">
      <div className="h-42 absolute inset-x-0 ml-auto w-32 justify-center rounded-lg bg-gradient-to-r from-slate-50 to-slate-600 opacity-50 blur-3xl lg:-top-64 lg:h-96 lg:w-96" />
      <div className="container relative max-w-6xl py-24 lg:py-56">
        <div>
          <h1 className="font-display bg-gradient-to-r from-slate-50 to-slate-600 bg-clip-text pb-2 text-4xl font-normal tracking-tight text-transparent sm:text-6xl">
            Data insight discovery
            <span className="lg:block">on autopilot</span>
          </h1>
          <p className="text-ui-fg-subtle mt-4 max-w-xl">
            Generate comprehensive metrics reports with actionable insights, all
            on autopilot, so that you can make data-informed decisions
          </p>
          <div className="mt-12">{children}</div>
        </div>

        <div className="gird-cols-1 w-lg mt-12 grid flex-col justify-between gap-2 md:grid-cols-2 lg:grid-cols-3">
          <div className="h-full rounded-3xl bg-gradient-to-t from-white/5 p-2 ring-1 ring-white/10 lg:mt-24">
            <div className="bg-ui-bg-component flex h-full flex-col justify-between overflow-hidden rounded-2xl p-4 ring-1 ring-white/10">
              <div>
                <img src="/screenshots/widget6.svg" />
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="font-display text-ui-fg-subtle text-sm">
                  How engaged are the power users of my product?
                </p>
                <p className="text-ui-fg-base text-base">
                  The share of power users has been increasing this month (+12%
                  change d/d).
                </p>
              </div>
            </div>
          </div>

          <div className="h-full rounded-3xl bg-gradient-to-t from-white/5 p-2 ring-1 ring-white/10">
            <div className="bg-ui-bg-component flex h-full flex-col justify-between overflow-hidden rounded-2xl p-4 ring-1 ring-white/10">
              <div>
                <img src="/screenshots/widget5.svg" />
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="font-display text-ui-fg-subtle text-sm">
                  How is short and long-term retention trending with each new
                  cohort?
                </p>
                <p className="text-ui-fg-base text-base">
                  The current cohort is doing much better than the cohort one
                  quarter ago (+20% retention).
                </p>
              </div>
            </div>
          </div>

          <div className="h-full rounded-3xl bg-gradient-to-t from-white/5 p-2 ring-1 ring-white/10 lg:-mt-24">
            <div className="bg-ui-bg-component flex h-full flex-col justify-between overflow-hidden rounded-2xl p-4 ring-1 ring-white/10">
              <div>
                <img src="/screenshots/widget4.svg" />
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="font-display text-ui-fg-subtle text-sm">
                  Which feature usage leads to the highest user retention?
                </p>
                <p className="text-ui-fg-base text-base">
                  Users who share a post within their first week are more likely
                  to retain (+25% than overall).
                </p>
              </div>
            </div>
          </div>

          <div className="h-full rounded-3xl bg-gradient-to-t from-white/5 p-2 ring-1 ring-white/10 lg:mt-24">
            <div className="bg-ui-bg-component flex h-full flex-col justify-between overflow-hidden rounded-2xl p-4 ring-1 ring-white/10">
              <div>
                <img src="/screenshots/widget3.svg" />
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="font-display text-ui-fg-subtle text-sm">
                  Which slow-moving trends in new user growth are concerning?
                </p>
                <p className="text-ui-fg-base text-base">
                  Retention of customers acquired via Facebook ads is trending
                  down for 16 weeks now.
                </p>
              </div>
            </div>
          </div>

          <div className="h-full rounded-3xl bg-gradient-to-t from-white/5 p-2 ring-1 ring-white/10">
            <div className="bg-ui-bg-component flex h-full flex-col justify-between overflow-hidden rounded-2xl p-4 ring-1 ring-white/10">
              <div>
                <img src="/screenshots/widget2.svg" />
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="font-display text-ui-fg-subtle text-sm">
                  What’s my growth forecast? Am I likely to hit my growth goal?
                </p>
                <p className="text-ui-fg-base text-base">
                  Grow at 10% w/w to hit the May Goal, currently expected to be
                  missed by 1M.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-gradient-to-t from-white/5 p-2 ring-1 ring-white/10 lg:-mt-24">
            <div className="bg-ui-bg-component flex h-full flex-col justify-between overflow-hidden rounded-2xl p-4 ring-1 ring-white/10">
              <div>
                <img src="/screenshots/widget1.svg" />
              </div>
              <div className="flex flex-col gap-2 p-4">
                <p className="font-display text-ui-fg-subtle text-sm">
                  What opportunities are there to optimize my acquisition
                  funnel?
                </p>
                <p className="text-ui-fg-base text-base">
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

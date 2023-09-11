"use client";

import Head from "./Head";
import Header from "./Header";

export const Hero = () => {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-x-0 justify-center w-32 ml-auto rounded-lg opacity-50 bg-gradient-to-r from-brand-50 via-brand-200 to-brand-600 h-42 lg:-top-64 lg:w-96 lg:h-96 blur-3xl"></div>
      <div className="relative px-8 py-24 mx-auto md:px-12 lg:px-32 max-w-7xl lg:py-56">
        <div>
          <h1 className="pb-2 text-4xl font-normal tracking-tight text-transparent bg-gradient-to-r from-brand-50 via-brand-300 to-brand-600 bg-clip-text font-display sm:text-6xl">
            Build a data-informed team
            <span className="lg:block">with weekly metrics reports</span>
          </h1>
          <p className="max-w-xl mt-4 text-brand-300">
            Inteligir generates comprehensive weekly metrics reports alongside
            actionable insights so that you can make data-informed decisions.
          </p>
          <div className="relative flex flex-col max-w-xl gap-2 mt-12 sm:flex-row">
            <a
              href="https://lexingtonthemes.lemonsqueezy.com/checkout/buy/f0a11cac-e5c4-4cee-9a11-631749fd6647"
              className="flex items-center justify-center h-10 px-4 py-2 text-sm text-white transition-all rounded-lg hover:to-brand-600 bg-gradient-to-b from-brand-300 via-brand-400 to-brand-500"
            >
              Buy brand
            </a>
            <a
              href="/"
              className="rounded-lg px-4 py-2 text-sm transition-all flex items-center justify-center text-white bg-gradient-to-b from-white/[.105] to-white/[.15] hover:to-white/[.25] h-10 ring-1 ring-inset ring-white/10"
            >
              See all pages
            </a>
          </div>
        </div>

        <div className="grid flex-col justify-between gap-2 mt-4 gird-cols-1 lg:grid-cols-3 md:grid-cols-2 w-lg">
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

const LogoCloud = () => {
  return (
    <section>
      <div className="mx-auto px-8 lg:px-36 max-w-7xl md:px-12 py-12">
        <div className="items-center grid grid-cols-1 lg:gap-24 lg:grid-cols-4 md:grid-cols-2 py-12">
          <div className="mx-auto col-span-full lg:col-span-1 lg:max-w-none lg:mr-auto">
            <p className="text-xs">Some of the companies generating reports</p>
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

const Feature = () => {
  return (
    <section className="relative overflow-hidden">
      <div className="h-[0.080rem] bg-gradient-to-r from-brand-950 max-w-3xl mx-auto via-brand-300 to-brand-950"></div>
      <div className="px-8 py-12 mx-auto md:px-12 lg:px-32 max-w-7xl lg:py-24">
        <div className="max-w-2xl mx-auto text-center">
          <p className="bg-gradient-to-r from-brand-50 via-brand-300 to-brand-600 bg-clip-text text-transparent text-4xl font-normal font-display tracking-tight pb-2 sm:text-5xl">
            Empowering <span className="lg:block">learning experiences</span>
          </p>
          <p className="text-brand-300 mt-4 max-w-sm mx-auto">
            Discover the features that make our platform your ultimate learning
            companion
          </p>
        </div>
        <ul
          className="grid grid-cols-1 gap-2 mt-2 list-none md:grid-cols-3 mx-auto ring-white/10 ring-1 p-2 bg-gradient-to-t from-white/20 rounded-3xl"
          role="list"
        >
          <li className="p-8 ring-1 ring-white/10 rounded-2xl lg:p-10 shadow-massive bg-brand-900/80 h-full">
            <span className="ring-1 ring-white/10 rounded-full bg-white/5 h-10 w-10 items-center inline-flex text-white mx-auto justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="icon icon-tabler icon-tabler-route"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                strokeWidth="2"
                stroke="currentColor"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                <path d="M6 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path>
                <path d="M18 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path>
                <path d="M12 19h4.5a3.5 3.5 0 0 0 0 -7h-8a3.5 3.5 0 0 1 0 -7h3.5"></path>
              </svg>
            </span>
            <p className="text-lg mt-12 font-display text-white lg:text-xl">
              Personalized learning paths
            </p>
            <p className="mt-2 text-sm text-brand-300">
              Embark on a tailored educational journey, with courses curated to
              match your interests, goals, and learning pace.
            </p>
          </li>
          <li className="p-8 ring-1 ring-white/10 rounded-2xl lg:p-10 shadow-massive bg-brand-900/80 h-full">
            <span className="ring-1 ring-white/10 rounded-full bg-white/5 h-10 w-10 items-center inline-flex text-white mx-auto justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="icon icon-tabler icon-tabler-milkshake"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                strokeWidth="1.25"
                stroke="currentColor"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                <path d="M17 10a5 5 0 0 0 -10 0"></path>
                <path d="M6 10m0 1a1 1 0 0 1 1 -1h10a1 1 0 0 1 1 1v1a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1z"></path>
                <path d="M7 13l1.81 7.243a1 1 0 0 0 .97 .757h4.44a1 1 0 0 0 .97 -.757l1.81 -7.243"></path>
                <path d="M12 5v-2"></path>
              </svg>
            </span>
            <p className="text-lg mt-12 font-display text-white lg:text-xl">
              Interactive discussions
            </p>
            <p className="mt-2 text-sm text-brand-300">
              Engage in vibrant discussions with fellow learners and educators,
              fostering a collaborative learning environment.
            </p>
          </li>
          <li className="p-8 ring-1 ring-white/10 rounded-2xl lg:p-10 shadow-massive bg-brand-900/80 h-full">
            <span className="ring-1 ring-white/10 rounded-full bg-white/5 h-10 w-10 items-center inline-flex text-white mx-auto justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="icon icon-tabler icon-tabler-box-padding"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                strokeWidth="1.25"
                stroke="currentColor"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                <path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"></path>
                <path d="M8 16v.01"></path>
                <path d="M8 12v.01"></path>
                <path d="M8 8v.01"></path>
                <path d="M16 16v.01"></path>
                <path d="M16 12v.01"></path>
                <path d="M16 8v.01"></path>
                <path d="M12 8v.01"></path>
                <path d="M12 16v.01"></path>
              </svg>
            </span>
            <p className="text-lg mt-12 font-display text-white lg:text-xl">
              Rich multimedia content
            </p>
            <p className="mt-2 text-sm text-brand-300">
              Dive into a variety of learning materials, from video lectures to
              interactive quizzes, ensuring an engaging experience.
            </p>
          </li>

          <li className="p-8 ring-1 ring-white/10 rounded-2xl lg:p-10 shadow-massive bg-brand-900/80 h-full">
            <span className="ring-1 ring-white/10 rounded-full bg-white/5 h-10 w-10 items-center inline-flex text-white mx-auto justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="icon icon-tabler icon-tabler-current-location-off"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                strokeWidth="1.25"
                stroke="currentColor"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                <path d="M14.685 10.661c-.3 -.6 -.795 -1.086 -1.402 -1.374m-3.397 .584a3 3 0 1 0 4.24 4.245"></path>
                <path d="M6.357 6.33a8 8 0 1 0 11.301 11.326m1.642 -2.378a8 8 0 0 0 -10.597 -10.569"></path>
                <path d="M12 2v2"></path>
                <path d="M12 20v2"></path>
                <path d="M20 12h2"></path>
                <path d="M2 12h2"></path>
                <path d="M3 3l18 18"></path>
              </svg>
            </span>
            <p className="text-lg mt-12 font-display text-white lg:text-xl">
              Anytime, anywhere access
            </p>
            <p className="mt-2 text-sm text-brand-300">
              Enjoy the flexibility of learning on your schedule, accessing
              courses and resources seamlessly across devices.
            </p>
          </li>
          <li className="p-8 ring-1 ring-white/10 rounded-2xl lg:p-10 shadow-massive bg-brand-900/80 h-full">
            <span className="ring-1 ring-white/10 rounded-full bg-white/5 h-10 w-10 items-center inline-flex text-white mx-auto justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="icon icon-tabler icon-tabler-progress"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                strokeWidth="1.25"
                stroke="currentColor"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                <path d="M10 20.777a8.942 8.942 0 0 1 -2.48 -.969"></path>
                <path d="M14 3.223a9.003 9.003 0 0 1 0 17.554"></path>
                <path d="M4.579 17.093a8.961 8.961 0 0 1 -1.227 -2.592"></path>
                <path d="M3.124 10.5c.16 -.95 .468 -1.85 .9 -2.675l.169 -.305"></path>
                <path d="M6.907 4.579a8.954 8.954 0 0 1 3.093 -1.356"></path>
              </svg>
            </span>
            <p className="text-lg mt-12 font-display text-white lg:text-xl">
              Progress tracking
            </p>
            <p className="mt-2 text-sm text-brand-300">
              Monitor your learning milestones and accomplishments, motivating
              you to stay on track and celebrate your achievements.
            </p>
          </li>

          <li className="p-8 ring-1 ring-white/10 rounded-2xl lg:p-10 shadow-massive bg-brand-900/80 h-full">
            <span className="ring-1 ring-white/10 rounded-full bg-white/5 h-10 w-10 items-center inline-flex text-white mx-auto justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="icon icon-tabler icon-tabler-school"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                strokeWidth="1.25"
                stroke="currentColor"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                <path d="M22 9l-10 -4l-10 4l10 4l10 -4v6"></path>
                <path d="M6 10.6v5.4a6 3 0 0 0 12 0v-5.4"></path>
              </svg>
            </span>
            <p className="text-lg mt-12 font-display text-white lg:text-xl">
              Expert instructors
            </p>
            <p className="mt-2 text-sm text-brand-300">
              Learn from accomplished experts and industry professionals,
              gaining insights from their real-world experience.
            </p>
          </li>
        </ul>
      </div>
    </section>
  );
};

export function Home() {
  return (
    <>
      <Head
        title="Demorepo - a modern tool"
        description="A modern tool to help your business collaborate and grow"
        image="https://framerusercontent.com/screenshots/U10Ma2ZnGwFCA5tjS4wsy53KbmE.png"
      />
      <Header />
      <Hero />
      <LogoCloud />
      <Feature />
    </>
  );
}

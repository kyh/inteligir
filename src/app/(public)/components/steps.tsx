export const Steps = () => {
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

        <div
          //   x-data="{
          //     tabSelected: 1,
          //     tabId: $id('tabs'),
          //     tabButtonClicked(tabButton){
          //         this.tabSelected = tabButton.id.replace(this.tabId + '-', '');
          //         this.tabRepositionMarker(tabButton);
          //     },
          //     tabRepositionMarker(tabButton){
          //         this.$refs.tabMarker.style.width=tabButton.offsetWidth + 'px';
          //         this.$refs.tabMarker.style.height=tabButton.offsetHeight + 'px';
          //         this.$refs.tabMarker.style.left=tabButton.offsetLeft + 'px';
          //     },
          //     tabContentActive(tabContent){
          //         return this.tabSelected == tabContent.id.replace(this.tabId + '-content-', '');
          //     }
          // }"
          //   x-init="tabRepositionMarker($refs.tabButtons.firstElementChild);"
          className="relative w-full"
        >
          <div
            // x-ref="tabButtons"
            className="relative flex flex-col justify-center w-full gap-6 mt-12 lg:bg-white border-gray-300 select-none sm:inline-grid rounded-t-3xl lg:flex-none lg:items-center sm:grid-cols-3"
          >
            <button
              // :id="$id(tabId)"
              // @click="tabButtonClicked($el);"
              type="button"
              // :className="{ 'bg-gray-100 text-gray-700' : tabButtonActive($el) }"
              className="relative flex flex-col justify-center w-full pb-8 text-left transition-all cursor-pointer lg:z-20 lg:p-8"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-5 h-5 icon icon-tabler text-brand-500 icon-tabler-device-cctv-off"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                  stroke="currentColor"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                  <path d="M7 7h-3a1 1 0 0 1 -1 -1v-2c0 -.275 .11 -.523 .29 -.704m3.71 -.296h13a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-9"></path>
                  <path d="M10.36 10.35a4 4 0 1 0 5.285 5.3"></path>
                  <path
                    d="M19 7v7c0 .321 -.022 .637 -.064 .947m-1.095 2.913a7 7 0 0 1 -12.841 -3.86l0 -7"
                    opacity="0.5"
                  ></path>
                  <path d="M12 14h.01"></path>
                  <path d="M3 3l18 18"></path>
                </svg>
                <p className="text-base font-medium text-brand-900">
                  Encrypted
                </p>
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Use blockchain technology to create decentralized autonomous
                organizations and manage.
              </p>
            </button>
            <button
              // :id="$id(tabId)"
              // @click="tabButtonClicked($el);"
              // type="button"
              // :className="{ 'bg-gray-100 text-gray-700' : tabButtonActive($el) }"
              className="relative flex flex-col justify-center w-full pb-8 text-left transition-all cursor-pointer lg:z-20 lg:p-8"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-5 h-5 icon icon-tabler text-brand-500 icon-tabler-cloud-lock-open"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                  stroke="currentColor"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                  <path
                    opacity="0.5"
                    d="M19 18a3.5 3.5 0 0 0 0 -7h-1c.397 -1.768 -.285 -3.593 -1.788 -4.787c-1.503 -1.193 -3.6 -1.575 -5.5 -1s-3.315 2.019 -3.712 3.787c-2.199 -.088 -4.155 1.326 -4.666 3.373c-.512 2.047 .564 4.154 2.566 5.027"
                  ></path>
                  <path d="M8 15m0 1a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1z"></path>
                  <path d="M10 15v-2a2 2 0 0 1 3.736 -1"></path>
                </svg>
                <p className="text-lg font-medium text-brand-900">Privacy</p>
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Trade cryptocurrencies and tokens on a decentralized exchange
                for added security and anonymity.
              </p>
            </button>
            <button
              // :id="$id(tabId)"
              // @click="tabButtonClicked($el);"
              type="button"
              // :className="{ 'bg-gray-100 text-gray-700' : tabButtonActive($el) }"
              className="relative flex flex-col justify-center w-full pb-8 text-left transition-all cursor-pointer lg:z-20 lg:p-8"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-5 h-5 icon icon-tabler text-brand-500 icon-tabler-archive"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                  stroke="currentColor"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                  <path d="M3 4m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"></path>
                  <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10"></path>
                  <path opacity="0.5" d="M10 12l4 0"></path>
                </svg>
                <p className="text-lg font-medium text-brand-900">Storage</p>
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Trade cryptocurrencies and tokens on a decentralized exchange
                for added security and anonymity.
              </p>
            </button>
            <div className="absolute left-0 z-10 hidden w-1/2 h-full duration-300 ease-out md:block">
              <div className="w-12 ml-8 h-full border-b-2 border-brand-500"></div>
            </div>
          </div>
          <div className="relative items-center justify-center hidden w-full border-t -mt-1 shadow-sm overflow-hidden content md:rounded-b-3xl md:block">
            <div
              // :id="$id(tabId + '-content')"
              // x-show="tabContentActive($el)"
              className="relative"
            >
              <div className="w-full overflow-hidden">
                <img alt="" src="/assets/chart1.svg" className="w-full" />
              </div>
            </div>

            <div
              // :id="$id(tabId + '-content')"
              // x-show="tabContentActive($el)"
              className="relative"
              // x-cloak
            >
              <div className="w-full overflow-hidden">
                <img alt="" src="/assets/chart2.svg" className="w-full" />
              </div>
            </div>

            <div
              // :id="$id(tabId + '-content')"
              // x-show="tabContentActive($el)"
              className="relative"
              // x-cloak
            >
              <div className="w-full overflow-hidden">
                <img alt="" src="/assets/chart3.svg" className="w-full" />
              </div>
            </div>
          </div>
        </div>

        {/* <ul
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
        </ul> */}
      </div>
    </section>
  );
};

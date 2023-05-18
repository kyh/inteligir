export const PrimaryButton = ({
  children,
  ...props
}: {
  children: React.ReactNode;
}) => (
  <div className="group relative text-xs">
    <div className="absolute inset-0 animate-tilt rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 opacity-75 blur transition duration-1000 group-hover:opacity-100 group-hover:duration-200" />
    <button
      className="relative flex items-center rounded-full bg-black-700 bg-gradient-to-t from-gray-900 px-7 py-2.5 text-emerald-400 transition duration-300 group-hover:text-zinc-100"
      {...props}
    >
      {children}
    </button>
  </div>
);

export const SecondaryButton = ({
  children,
  ...props
}: {
  children: React.ReactNode;
}) => (
  <button
    className="group relative mt-5 inline-flex h-12 w-52 items-center overflow-hidden rounded-full shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
    {...props}
  >
    <span className="absolute inset-px z-10 grid place-items-center rounded-full bg-black-700 bg-gradient-to-t from-gray-900 text-xs font-medium text-emerald-400 transition duration-200 hover:text-zinc-100">
      {children}
    </span>
    <span
      aria-hidden
      className="absolute inset-0 z-0 scale-x-[2.0] blur before:absolute before:inset-0 before:top-1/2 before:aspect-square before:animate-disco before:bg-gradient-conic before:from-gray-900  before:via-gray-900 before:to-emerald-600"
    />
  </button>
);

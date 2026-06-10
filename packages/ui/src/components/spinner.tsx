export const Spinner = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    {...props}
  >
    <path
      d="M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z"
      stroke="currentColor"
      strokeWidth="1.125"
      strokeLinecap="round"
      pathLength="100"
      style={{
        strokeDasharray: "15 85",
        animation: "spinner-move 2s linear infinite, spinner-dash 4s ease-in-out infinite",
      }}
    />
  </svg>
);

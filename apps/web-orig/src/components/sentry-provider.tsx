import useSentry from "@/lib/hooks/use-sentry";

const SentryBrowserWrapper: React.FCC = ({ children }) => {
  useSentry();

  return <>{children}</>;
};

export default SentryBrowserWrapper;

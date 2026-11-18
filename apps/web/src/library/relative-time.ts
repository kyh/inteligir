import { useEffect, useState } from "react";

interface RelativeTimeOptions {
  inSentence?: boolean;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export const relativeTimeLabel = (atMs: number, nowMs: number, options?: RelativeTimeOptions) => {
  const elapsed = Math.max(0, nowMs - atMs);

  if (elapsed < MINUTE_MS) {
    return options?.inSentence === true ? "just now" : "Just now";
  }

  if (elapsed < HOUR_MS) {
    return `${String(Math.floor(elapsed / MINUTE_MS))}m ago`;
  }

  if (elapsed < DAY_MS) {
    return `${String(Math.floor(elapsed / HOUR_MS))}h ago`;
  }

  if (elapsed < WEEK_MS) {
    return `${String(Math.floor(elapsed / DAY_MS))}d ago`;
  }

  return new Date(atMs).toLocaleDateString();
};

const CLOCK_TICK_MS = 60_000;

export const useNow = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
    }, CLOCK_TICK_MS);

    return () => {
      clearInterval(tick);
    };
  }, []);

  return now;
};

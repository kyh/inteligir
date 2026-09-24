// keyed on growth, not on a row count: a streamed reply grows one row in place, which moves no count.

import { useEffect, useRef } from "react";
import type { RefObject, UIEventHandler } from "react";

// within this many pixels of the end still reads as "at the newest line"
const PINNED_SLACK_PX = 24;

interface FollowBottom {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
}

// follows the content only while the reader sits at the bottom, so scrolling up to read holds still
export const useFollowBottom = (): FollowBottom => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (scroller === null || content === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (pinned.current) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
    observer.observe(scroller);
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, []);

  const onScroll: UIEventHandler<HTMLDivElement> = (event) => {
    const { clientHeight, scrollHeight, scrollTop } = event.currentTarget;
    pinned.current = scrollHeight - scrollTop - clientHeight < PINNED_SLACK_PX;
  };

  return { contentRef, onScroll, scrollRef };
};

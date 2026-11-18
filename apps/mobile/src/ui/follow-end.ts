// A scroll view that keeps to its end as what it holds grows, as a conversation does while the
// agent replies, and lets go while the reader scrolls away. Following is the reader's to change:
// their drag, fling or tap on the status bar stops it, and coming to rest at the end or a send
// takes it up again, since an offset read as the content grows says the end moved, not that the
// reader did.

import { useRef } from "react";
import type { RefObject } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from "react-native";

// how far short of the end a scroll may rest and still be at it: about a line, since a fling
// seldom stops on the last point
const NEAR_END = 24;

export interface ScrollMetrics {
  readonly contentHeight: number;
  readonly offset: number;
  readonly viewportHeight: number;
}

// a bottom inset rests the end past the content, and content shorter than the view is all at it
export const atEnd = ({ contentHeight, offset, viewportHeight }: ScrollMetrics): boolean =>
  offset + viewportHeight >= contentHeight - NEAR_END;

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

const metricsOf = ({ nativeEvent }: ScrollEvent): ScrollMetrics => ({
  contentHeight: nativeEvent.contentSize.height,
  offset: nativeEvent.contentOffset.y,
  viewportHeight: nativeEvent.layoutMeasurement.height,
});

export interface FollowEnd {
  // the scroll view's own props, spread onto it
  readonly props: {
    readonly ref: RefObject<ScrollView | null>;
    readonly onContentSizeChange: () => void;
    readonly onLayout: () => void;
    readonly onMomentumScrollBegin: () => void;
    readonly onMomentumScrollEnd: (event: ScrollEvent) => void;
    readonly onScrollBeginDrag: () => void;
    readonly onScrollEndDrag: (event: ScrollEvent) => void;
    readonly onScrollToTop: () => void;
  };
  // back to the end, following again
  readonly follow: () => void;
}

export const useFollowEnd = (): FollowEnd => {
  const view = useRef<ScrollView>(null);
  // it opens on the end
  const following = useRef(true);
  // a jump, since a growth that lands mid-animation would aim it at an end already gone
  const keep = (): void => {
    if (following.current) {
      view.current?.scrollToEnd({ animated: false });
    }
  };
  const letGo = (): void => {
    following.current = false;
  };
  const rest = (event: ScrollEvent): void => {
    following.current = atEnd(metricsOf(event));
  };
  return {
    follow: () => {
      following.current = true;
      view.current?.scrollToEnd({ animated: true });
    },
    props: {
      onContentSizeChange: keep,
      onLayout: keep,
      onMomentumScrollBegin: letGo,
      onMomentumScrollEnd: rest,
      onScrollBeginDrag: letGo,
      onScrollEndDrag: rest,
      onScrollToTop: letGo,
      ref: view,
    },
  };
};

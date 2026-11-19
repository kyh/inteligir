import { useRef } from "react";
import type { RefObject } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from "react-native";

const NEAR_END = 24;

export interface ScrollMetrics {
  readonly contentHeight: number;
  readonly offset: number;
  readonly viewportHeight: number;
}

export const atEnd = ({ contentHeight, offset, viewportHeight }: ScrollMetrics) =>
  offset + viewportHeight >= contentHeight - NEAR_END;

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

const metricsOf = ({ nativeEvent }: ScrollEvent) =>
  ({
    contentHeight: nativeEvent.contentSize.height,
    offset: nativeEvent.contentOffset.y,
    viewportHeight: nativeEvent.layoutMeasurement.height,
  }) satisfies ScrollMetrics;

interface FollowEnd {
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
  readonly follow: () => void;
}

export const useFollowEnd = () => {
  const view = useRef<ScrollView>(null);
  const following = useRef(true);

  const keep = () => {
    if (following.current) {
      view.current?.scrollToEnd({ animated: false });
    }
  };

  const letGo = () => {
    following.current = false;
  };

  const rest = (event: ScrollEvent) => {
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
  } satisfies FollowEnd;
};

"use client";

import React, { useCallback, useContext, useEffect, useState } from "react";

import { useCookieStorage } from "@/hooks/useCookieStorage";
import { RightPanelType } from "@/hooks/useResizablePanel";
import { cn } from "@/lib/utils";

export type Layout = { leftSize?: number; rightSize?: number };

type PanelsContextProps = {
  hiddenLeft: boolean;
  hiddenRight: boolean;
  leftSize: number;
  rightPanelType: RightPanelType;
  rightSize: number;
  serverPersistenceId: string;
  setLeftSize: React.Dispatch<React.SetStateAction<number>>;
  setRightPanelType: React.Dispatch<React.SetStateAction<RightPanelType>>;
  setRightSize: React.Dispatch<React.SetStateAction<number>>;
  onLayout: (layout: Layout) => void;
  onRightPanelTypeChange?: (type: RightPanelType) => void;
};

export const PanelsContext = React.createContext<Partial<PanelsContextProps>>({});

type ResizablePanelGroupProps = {
  initLeftSize: number;
  initRightSize: number;
  serverPersistenceId: string;
  serverPersistenceRightPanelType: string;
  className?: string;
  hiddenLeft?: boolean;
  hiddenRight?: boolean;
  onLayout?: (layout: Layout) => void;
  onRightPanelTypeChange?: (type: RightPanelType) => void;
};

export const ResizablePanelGroup = React.memo(
  ({ children, className, ...props }: React.PropsWithChildren<ResizablePanelGroupProps>) => {
    const {
      hiddenLeft,
      hiddenRight,
      initLeftSize,
      initRightSize,
      serverPersistenceId,
      serverPersistenceRightPanelType,
      onLayout,
      onRightPanelTypeChange,
    } = props;

    const [layout] = useCookieStorage<Layout>(serverPersistenceId, {
      leftSize: initLeftSize,
      rightSize: initRightSize,
    });

    const [rightPanelTypeLocal] = useCookieStorage<RightPanelType>(
      serverPersistenceRightPanelType,
      RightPanelType.comment,
    );

    // TODO:The layout flickers on a small screen when cookies not exit.
    // It's a bit difficult to fix, but it's the best outcome given the circumstances.
    const [leftSize, setLeftSize] = React.useState(layout.leftSize ?? initLeftSize);
    const [rightSize, setRightSize] = React.useState(
      layout.rightSize ?? (hiddenRight ? 0 : initRightSize),
    );

    const [rightPanelTypeState, setRightPanelType] =
      React.useState<RightPanelType>(rightPanelTypeLocal);

    return (
      <PanelsContext.Provider
        value={{
          hiddenLeft,
          hiddenRight,
          leftSize,
          rightPanelType: rightPanelTypeState,
          rightSize,
          serverPersistenceId,
          setLeftSize,
          setRightPanelType,
          setRightSize,
          onLayout,
          onRightPanelTypeChange,
        }}
      >
        <div className={cn("flex flex-1", className)}>{children}</div>
      </PanelsContext.Provider>
    );
  },
);

type ResizablePanelProps = {
  maxSize?: number;
  minSize?: number;
};

export const ResizableLeftPanel = React.memo(
  ({ children, maxSize, minSize }: React.PropsWithChildren<ResizablePanelProps>) => {
    const context = React.useContext(PanelsContext);

    if (!context) {
      throw new Error(
        `The \`ResizableLeftPanel\` component must be used inside the <ResizablePanelGroup> component's context.`,
      );
    }

    const { hiddenLeft, leftSize = 0, rightSize, setLeftSize, onLayout } = context;

    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
      if (hiddenLeft) {
        setLeftSize?.(0);
        onLayout?.({ leftSize: 0, rightSize: rightSize ?? 0 });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hiddenLeft]);

    return (
      <div
        className={cn("flex h-dvh overflow-hidden", !isDragging && "transition-[width]")}
        style={{ width: leftSize }}
      >
        <div className="relative flex flex-1 bg-muted/50">
          {children}

          <ResizableHandle
            isDragging={isDragging}
            isLeft
            maxSize={maxSize}
            minSize={minSize}
            setIsDragging={setIsDragging}
          />
        </div>
      </div>
    );
  },
);

type ResizableHandleProps = {
  isDragging: boolean;
  setIsDragging: React.Dispatch<React.SetStateAction<boolean>>;
  className?: string;
  isLeft?: boolean;
  maxSize?: number;
  minSize?: number;
};
const ResizableHandle = ({
  className,
  isDragging,
  isLeft,
  maxSize,
  minSize,
  setIsDragging,
}: ResizableHandleProps) => {
  const context = useContext(PanelsContext);

  if (!context) {
    throw new Error(
      `The \`ResizableHandle\` component must be used inside the <ResizablePanelGroup> component's context.`,
    );
  }

  const { leftSize, rightSize, setLeftSize, setRightSize, onLayout } = context;
  const [initialMouseX, setInitialMouseX] = useState(0);
  const [initialPanelSize, setInitialPanelSize] = useState(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging?.(true);
      setInitialMouseX(e.clientX);
      setInitialPanelSize(isLeft ? leftSize! : rightSize!);

      document.body.style.userSelect = "none";
      document.body.style.pointerEvents = "none";
      document.body.style.cursor = "col-resize";
    },
    [isLeft, leftSize, rightSize, setIsDragging],
  );

  const onMouseUp = useCallback(() => {
    setIsDragging?.(false);

    document.body.style.userSelect = "";
    document.body.style.pointerEvents = "";
    document.body.style.cursor = "";
    onLayout?.({ leftSize: leftSize ?? 0, rightSize: rightSize ?? 0 });
  }, [leftSize, onLayout, rightSize, setIsDragging]);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        const deltaX = e.clientX - initialMouseX;
        let newSize: number;

        if (isLeft) {
          newSize = initialPanelSize + deltaX;

          // recheck if the new size is within the limit
          if (newSize < (minSize ?? 0)) {
            newSize = minSize ?? 0;
          } else if (maxSize !== undefined && newSize > maxSize) {
            newSize = maxSize;
          }

          setLeftSize?.(newSize);
        } else {
          newSize = initialPanelSize - deltaX;

          // recheck if the new size is within the limit
          if (newSize < (minSize ?? 0)) {
            newSize = minSize ?? 0;
          } else if (maxSize !== undefined && newSize > maxSize) {
            newSize = maxSize;
          }

          setRightSize?.(newSize);
        }
      }
    },
    [
      isDragging,
      initialMouseX,
      isLeft,
      initialPanelSize,
      minSize,
      maxSize,
      setLeftSize,
      setRightSize,
    ],
  );

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    } else {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging, onMouseMove, onMouseUp]);

  return (
    <div
      className={cn(
        "group absolute top-0 z-30 h-full w-[4px] cursor-col-resize",
        isLeft ? "right-0" : "left-0",
        className,
      )}
      onMouseDown={onMouseDown}
    >
      <div
        className={cn(
          "h-full w-[2px] opacity-0 transition-all duration-150 group-hover:bg-primary/60 group-hover:opacity-100",
          isLeft ? "ml-auto" : "mr-auto",
          isDragging && "bg-primary/60 opacity-100",
        )}
      />
    </div>
  );
};

type ResizableMidPanelProps = {
  className?: string;
};

export const ResizableMidPanel = React.memo(
  ({ children, className }: React.PropsWithChildren<ResizableMidPanelProps>) => {
    const context = React.useContext(PanelsContext);

    if (!context) {
      throw new Error(
        `The \`ResizableMidPanel\` component must be used inside the <ResizablePanelGroup> component's context.`,
      );
    }

    return <div className={cn("flex-1", className)}>{children}</div>;
  },
);

export const ResizableRightPanel = React.memo(
  ({ children, maxSize, minSize }: React.PropsWithChildren<ResizablePanelProps>) => {
    const context = React.useContext(PanelsContext);

    if (!context) {
      throw new Error(
        `The \`ResizableRightPanel\` component must be used inside the <ResizablePanelGroup> component's context.`,
      );
    }

    const { hiddenRight, leftSize, rightSize = 0, setRightSize, onLayout } = context;
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
      if (hiddenRight) {
        setRightSize?.(0);
        onLayout?.({ leftSize: leftSize ?? 0, rightSize: 0 });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hiddenRight]);

    return (
      <div
        className={cn("relative flex h-full overflow-hidden", !isDragging && "transition-[width]")}
        style={{ width: rightSize }}
      >
        <ResizableHandle
          isDragging={isDragging}
          maxSize={maxSize}
          minSize={minSize}
          setIsDragging={setIsDragging}
        />

        <div className="flex-1">{children}</div>
      </div>
    );
  },
);

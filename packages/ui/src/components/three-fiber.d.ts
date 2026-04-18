/* React Three Fiber extend() adds Line2 as intrinsic element "line2" */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      line2: {
        children?: React.ReactNode;
      };
    }
  }
}

export {};

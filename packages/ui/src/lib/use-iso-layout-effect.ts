import { useEffect, useLayoutEffect } from "react";

// React warns when a layout effect runs during a server render, and a Worker-rendered site consumes this package
export const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

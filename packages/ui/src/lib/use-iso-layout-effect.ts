import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` in a browser, `useEffect` anywhere else. React warns when a
 * layout effect runs during a server render, and this package is consumed by a
 * Worker-rendered site as well as the desktop renderer — so the choice has to
 * be made per environment rather than per component.
 */
export const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

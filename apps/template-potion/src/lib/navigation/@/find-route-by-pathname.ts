import type React from 'react';

import type { routes } from '@/lib/navigation/routes';

export type RouteMap = Partial<Record<keyof typeof routes, RouteMapItem>>;

export type RouteMapItem = {
  component: React.FC | string;
  path: string;
};

const matchDynamicRoute = (routePattern: string, currentPath: string) => {
  const routeSegments = routePattern.split('/').filter(Boolean); // Remove empty segments
  const pathSegments = currentPath.split('/').filter(Boolean); // Remove empty segments

  if (routeSegments.length !== pathSegments.length) {
    return false;
  }

  return routeSegments.every((segment, index) => {
    return segment.includes(':') || segment === pathSegments[index];
  });
};

export const findRouteByPathname = (routeMap: RouteMap, pathname: string) => {
  for (const [key, { path }] of Object.entries(routeMap)) {
    if (matchDynamicRoute(path, pathname)) {
      return routeMap[key];
    }
  }

  return routeMap.home; // Fallback to home if no route matches
};

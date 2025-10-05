'use client';

import type { AuthUser } from '@/server/auth/getAuthUser';

import { createAtomStore } from 'jotai-x';

import { routes } from '@/lib/navigation/routes';
import { atomWithStorage } from '@/lib/storage/atomWithStorage';

export const { AppProvider, useAppSet, useAppState, useAppStore, useAppValue } =
  createAtomStore(
    {
      app: atomWithStorage('app', {
        // app: atomWithCookie('app', {
        lastPage: routes.home(),
      }),
      // Only for development
      devCookie: atomWithStorage('devCookie', {}),
      // devCookie: atomWithCookie('devCookie', {}),
      isDynamic: false,
      isStatic: true,
      layout: atomWithStorage('layout', {}),
      // layout: atomWithCookie('layout', {}),
      rightPanel: atomWithStorage(
        // rightPanel: atomWithCookie(
        'rightPanel',
        'comments' as 'comments' | 'versions'
      ),
      user: null as AuthUser | null,
    },
    {
      effect: AppProviderEffect,
      name: 'app',
    }
  );

export function AppProviderEffect() {
  return null;
}

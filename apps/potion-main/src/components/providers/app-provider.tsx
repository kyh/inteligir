'use client';

import { createAtomStore } from 'jotai-x';
import { atomWithStorage } from '@/lib/storage/atomWithStorage';
import type { AuthUser } from '@/server/auth/getAuthUser';

export const { AppProvider, useAppSet, useAppState, useAppStore, useAppValue } =
  createAtomStore(
    {
      app: atomWithStorage('app', {
        // app: atomWithCookie('app', {
        lastPage: '/',
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

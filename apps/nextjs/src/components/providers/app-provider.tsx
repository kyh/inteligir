'use client';

import { createAtomStore } from 'jotai-x';
import { atomWithStorage } from '@/lib/storage/atomWithStorage';

type AuthUser = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
} | null;

export const { AppProvider, useAppSet, useAppState, useAppStore, useAppValue } =
  createAtomStore(
    {
      app: atomWithStorage('app', {
        lastPage: '/',
      }),
      devCookie: atomWithStorage('devCookie', {}),
      isDynamic: false,
      isStatic: true,
      layout: atomWithStorage('layout', {}),
      rightPanel: atomWithStorage(
        'rightPanel',
        'comments' as 'comments' | 'versions'
      ),
      user: null as AuthUser,
    },
    {
      effect: AppProviderEffect,
      name: 'app',
    }
  );

export function AppProviderEffect() {
  return null;
}

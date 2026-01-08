'use client';

import { createPlatePlugin } from 'platejs/react';

import { FloatingToolbarButtons } from '@/components/editor/ui/floating-toolbar-buttons-app';
import { FloatingToolbar } from '@/registry/ui/floating-toolbar';

export const FloatingToolbarKit = [
  createPlatePlugin({
    key: 'floating-toolbar',
    render: {
      afterEditable: () => (
        <FloatingToolbar>
          <FloatingToolbarButtons />
        </FloatingToolbar>
      ),
    },
  }),
];

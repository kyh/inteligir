'use client';

import { PlaceholderPlugin } from '@platejs/media/react';

import { PlaceholderElement } from '@/components/editor/ui/media-placeholder-node-app';
import { MediaKit as RegistryMediaKit } from '@/registry/components/editor/plugins/media-kit';
import { MediaUploadToast } from '@/registry/ui/media-upload-toast';

export const MediaKit = [
  ...RegistryMediaKit,
  PlaceholderPlugin.configure({
    render: {
      afterEditable: MediaUploadToast,
      node: PlaceholderElement,
    },
  }),
];

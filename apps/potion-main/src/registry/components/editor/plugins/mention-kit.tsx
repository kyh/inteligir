'use client';

import { MentionInputPlugin, MentionPlugin } from '@platejs/mention/react';
import { KEYS } from 'platejs';
import type { MyMentionElement } from '@/registry/components/editor/plate-types';
import {
  MentionElement,
  MentionInputElement,
} from '@/registry/ui/mention-node';

export const MentionKit = [
  MentionPlugin.configure({
    options: {
      triggerPreviousCharPattern: /^$|^[\s"']$/,
    },
  })
    .withComponent(MentionElement)
    .overrideEditor(({ api: { isSelectable } }) => ({
      api: {
        isSelectable(element) {
          if (element.type === KEYS.mention) {
            const mentionElement = element as unknown as MyMentionElement;

            const isDocument = mentionElement.key!.startsWith('/');

            return !!isDocument;
          }

          return isSelectable(element);
        },
      },
    })),
  MentionInputPlugin.withComponent(MentionInputElement),
];

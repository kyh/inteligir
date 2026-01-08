import type { Value } from 'platejs';

import { useTParams } from '@/hooks/use-navigation';
import { aiValue } from '@/registry/examples/values/ai-value';
import { blockMenuValue } from '@/registry/examples/values/block-menu-value';
import { calloutValue } from '@/registry/examples/values/callout-value';
import { copilotValue } from '@/registry/examples/values/copilot-value';
import { equationValue } from '@/registry/examples/values/equation-value';
import { floatingToolbarValue } from '@/registry/examples/values/floating-toolbar-value';
import { linkValue } from '@/registry/examples/values/link-value';
import { mediaToolbarValue } from '@/registry/examples/values/media-toolbar-value';
import { mentionValue } from '@/registry/examples/values/mention-value';
import { slashMenuValue } from '@/registry/examples/values/slash-menu-value';
import { tocValue } from '@/registry/examples/values/toc-value';
import { uploadValue } from '@/registry/examples/values/upload-value';

export type TemplateDocument = {
  id: string;
  icon: string | null;
  title: string | null;
  value: Value;
};

const templates: Record<string, TemplateDocument> = {
  link: {
    id: 'link',
    icon: '🔗',
    title: 'Link',
    value: linkValue,
  },
  mention: {
    id: 'mention',
    icon: '👤',
    title: 'Mention',
    value: mentionValue,
  },
  playground: {
    id: 'playground',
    icon: '🌳',
    title: 'Playground',
    value: [
      ...tocValue,
      ...aiValue,
      ...copilotValue,
      ...calloutValue,
      ...equationValue,
      ...uploadValue,
      ...slashMenuValue,
      ...blockMenuValue,
      ...floatingToolbarValue,
      ...mediaToolbarValue,
    ],
  },
  ai: {
    id: 'ai',
    icon: '🧠',
    title: 'AI',
    value: aiValue,
  },
  copilot: {
    id: 'copilot',
    icon: '🤖',
    title: 'Copilot',
    value: copilotValue,
  },
  callout: {
    id: 'callout',
    icon: '📢',
    title: 'Callout',
    value: calloutValue,
  },
  equation: {
    id: 'equation',
    icon: '🧮',
    title: 'Equation',
    value: equationValue,
  },
  upload: {
    id: 'upload',
    icon: '📤',
    title: 'Upload',
    value: uploadValue,
  },
  'slash-menu': {
    id: 'slash-menu',
    icon: '/',
    title: 'Slash Menu',
    value: slashMenuValue,
  },
  'block-menu': {
    id: 'block-menu',
    icon: '📋',
    title: 'Block Menu',
    value: blockMenuValue,
  },
  'floating-toolbar': {
    id: 'floating-toolbar',
    icon: '🧰',
    title: 'Floating Toolbar',
    value: floatingToolbarValue,
  },
  'media-toolbar': {
    id: 'media-toolbar',
    icon: '🎮',
    title: 'Media Toolbar',
    value: mediaToolbarValue,
  },
  'table-of-contents': {
    id: 'table-of-contents',
    icon: '📚',
    title: 'Table of Contents',
    value: tocValue,
  },
};

export const templateList = Object.values(templates);

export const getTemplateDocument = (documentId: string) =>
  templates[documentId];

export const useTemplateDocument = () => {
  const { documentId } = useTParams<'/dashboard/[slug]/[documentId]'>();

  return getTemplateDocument(documentId);
};

export const isTemplateDocument = (documentId: string) =>
  !!templates[documentId];

'use client';

import * as React from 'react';

import { Link } from 'lucide-react';
import { useEditorPlugin } from 'platejs/react';

import { linkPlugin } from '@/registry/components/editor/plugins/link-kit';

import { ToolbarButton } from './toolbar';

export function LinkToolbarButton(
  props: React.ComponentProps<typeof ToolbarButton>
) {
  const { api } = useEditorPlugin(linkPlugin);

  return (
    <ToolbarButton
      onClick={() => api.a.show()}
      data-plate-focus
      tooltip="Link"
      {...props}
    >
      <Link />
    </ToolbarButton>
  );
}

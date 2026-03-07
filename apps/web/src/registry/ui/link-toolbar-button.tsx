'use client';

import { Link } from 'lucide-react';
import { useEditorPlugin } from 'platejs/react';
import * as React from 'react';

import { linkPlugin } from '@/registry/components/editor/plugins/link-kit';

import { ToolbarButton } from './toolbar';

export function LinkToolbarButton(
  props: React.ComponentProps<typeof ToolbarButton>
) {
  const { api } = useEditorPlugin(linkPlugin);

  return (
    <ToolbarButton
      data-plate-focus
      onClick={() => api.a.show()}
      tooltip="Link"
      {...props}
    >
      <Link />
    </ToolbarButton>
  );
}

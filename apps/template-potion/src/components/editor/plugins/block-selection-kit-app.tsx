'use client';

import { BlockSelectionPlugin } from '@platejs/selection/react';
import { getPluginTypes, KEYS } from 'platejs';

import { BlockSelection } from '@/registry/ui/block-selection';

export const BlockSelectionKit = [
  BlockSelectionPlugin.configure(({ editor }) => ({
    options: {
      areaOptions: {
        boundaries: '#scroll_container',
        container: '#scroll_container',
        selectables: '#scroll_container .slate-selectable',
      },
      enableContextMenu: true,
      isSelectable: (element) => {
        return !getPluginTypes(editor, [
          KEYS.column,
          KEYS.codeLine,
          KEYS.td,
        ]).includes(element.type);
      },
    },
    render: {
      belowRootNodes: (props) => {
        if (!props.attributes.className?.includes('slate-selectable'))
          return null;

        return <BlockSelection {...(props as any)} />;
      },
    },
  })),
];

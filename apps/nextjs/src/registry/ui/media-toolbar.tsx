'use client';

import { showCaption } from '@platejs/caption/react';
import {
  openImagePreview,
  useMediaController,
  useMediaControllerDropDownMenu,
  useMediaControllerState,
} from '@platejs/media/react';
import { BlockMenuPlugin } from '@platejs/selection/react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  CaptionsIcon,
  CircleArrowDownIcon,
  MoreHorizontalIcon,
  MoveUpRightIcon,
  ZoomInIcon,
} from 'lucide-react';
import type { TMediaElement, TTextAlignProps } from 'platejs';
import { KEYS } from 'platejs';
import { useEditorRef, useElement } from 'platejs/react';
import * as React from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { downloadFile } from '@/registry/lib/download-file';

import {
  DropdownMenu,
  DropdownMenuContent,
  type DropdownMenuProps,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  useOpenState,
} from './dropdown-menu';
import { Toolbar, ToolbarButton, toolbarButtonVariants } from './toolbar';

export function MediaToolbar({
  className,
  ...props
}: React.ComponentProps<typeof Toolbar>) {
  return (
    <Toolbar
      className={cn(
        'group-data-[readonly=true]/editor:hidden',
        'top-1 right-1 opacity-0 group-hover/media:opacity-100',
        'group-has-data-[resizing=true]/media:opacity-0 group-has-data-[state=open]/media:opacity-100 group-data-[state=open]/context-menu:opacity-0'
      )}
      variant="media"
      {...props}
    >
      <MediaToolbarButtons />
    </Toolbar>
  );
}

const alignItems = [
  {
    icon: AlignLeft,
    value: 'left',
  },
  {
    icon: AlignCenter,
    value: 'center',
  },
  {
    icon: AlignRight,
    value: 'right',
  },
];

function MediaToolbarButtons() {
  const editor = useEditorRef();
  const element = useElement<TMediaElement>();
  const state = useMediaControllerState();
  const { MediaControllerDropDownMenuProps: mediaToolbarDropDownMenuProps } =
    useMediaController(state);

  const handleDownload = () => {
    toast.promise(downloadFile(element.url, element.id || 'file'), {
      error: 'Download failed. Please try again.',
      loading: 'Downloading...',
    });
  };

  return (
    <>
      <MediaAlignButton {...mediaToolbarDropDownMenuProps} />
      <ToolbarButton
        onClick={() => showCaption(editor, element)}
        size="none"
        tooltip="Caption"
        variant="media"
      >
        <CaptionsIcon />
      </ToolbarButton>
      {element.type === KEYS.img && (
        <ToolbarButton
          onClick={() => {
            openImagePreview(editor, element);
          }}
          size="none"
          tooltip="Expand"
          variant="media"
        >
          <ZoomInIcon />
        </ToolbarButton>
      )}

      {element.type === KEYS.img && (
        <ToolbarButton
          onClick={handleDownload}
          size="none"
          tooltip="Download"
          variant="media"
        >
          <CircleArrowDownIcon />
        </ToolbarButton>
      )}

      {element.type !== KEYS.img && (
        <ToolbarButton
          onClick={() => {
            window.open(element.url, '_blank');
          }}
          size="none"
          tooltip="Original"
          variant="media"
        >
          <MoveUpRightIcon />
        </ToolbarButton>
      )}

      <ToolbarButton
        onClick={(e) => {
          editor
            .getApi(BlockMenuPlugin)
            .blockMenu.showContextMenu(element.id as string, {
              x: e.clientX,
              y: e.clientY,
            });
        }}
        size="none"
        tooltip="More actions"
        variant="media"
      >
        <MoreHorizontalIcon />
      </ToolbarButton>
    </>
  );
}

function MediaAlignButton({
  children,
  ...props
}: {
  setAlignOpen: React.Dispatch<React.SetStateAction<boolean>>;
} & DropdownMenuProps) {
  const editor = useEditorRef();
  const element = useElement<TMediaElement & TTextAlignProps>();
  const openState = useOpenState();

  const value = element.align ?? 'left';

  const IconValue =
    alignItems.find((item) => item.value === value)?.icon ?? AlignLeft;

  useMediaControllerDropDownMenu({
    openState,
    setAlignOpen: props.setAlignOpen,
  });

  return (
    <DropdownMenu modal={false} {...openState} {...props}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton
          data-state={openState.open ? 'open' : 'closed'}
          size="none"
          tooltip="Align"
          variant="media"
        >
          <IconValue className="size-4" />
        </ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="min-w-0 rounded-md border-none bg-black/60 p-0 shadow-none"
        portal={false}
      >
        <DropdownMenuRadioGroup
          className="flex hover:bg-transparent"
          onValueChange={(value) => {
            editor.tf.setNodes({ align: value as any }, { at: element });
          }}
          value={value}
        >
          {alignItems.map(({ icon: Icon, value: itemValue }) => (
            <DropdownMenuRadioItem
              className={cn(
                toolbarButtonVariants({
                  size: 'none',
                  variant: 'media',
                }),
                'size-[26px] opacity-60 hover:opacity-100 data-[state=checked]:bg-black/5 data-[state=checked]:opacity-100'
              )}
              hideIcon
              key={itemValue}
              value={itemValue}
            >
              <Icon className="size-4" />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

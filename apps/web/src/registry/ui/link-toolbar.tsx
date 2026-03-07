'use client';

import { unwrapLink, upsertLink, validateUrl } from '@platejs/link';
import { CursorOverlayPlugin } from '@platejs/selection/react';
import { FileTextIcon, LinkIcon, Trash2Icon } from 'lucide-react';
import { NodeApi, type TText } from 'platejs';
import {
  type PlateEditor,
  useEditorPlugin,
  useEditorRef,
  useEditorSelector,
  usePluginOption,
} from 'platejs/react';
import React, { useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { MyLinkElement } from '@/registry/components/editor/plate-types';

import {
  linkPlugin,
  useActiveLink,
} from '@/registry/components/editor/plugins/link-kit';

import { Button } from './button';
import { Command, CommandInput, CommandItem, CommandList } from './command';
import { getCursorOverlayElement } from './cursor-overlay';
import { Input, inputVariants } from './input';
import { mockRecentDocuments } from './link-node';
import { Popover, PopoverAnchor, PopoverContent } from './popover';

const onUpsertLink = (editor: PlateEditor, url: string) => {
  upsertLink(editor, { skipValidation: true, url });
  editor.setOption(linkPlugin, 'mode', null);
  editor.tf.focus();
};

export function LinkFloatingToolbar() {
  const mode = usePluginOption(linkPlugin, 'mode');

  const anchorElement = usePluginOption(linkPlugin, 'anchorElement');
  const { editor, setOption } = useEditorPlugin(linkPlugin);

  const aboveLink = useEditorSelector((editor) => {
    if (editor.api.isExpanded()) return;

    return editor.api.above<MyLinkElement>({
      match: (n) => n.type === linkPlugin.key,
    })?.[0];
  }, []);

  const aboveUrl = editor.api.above<MyLinkElement>()?.[0].url ?? '';

  const [initialUrl, setInitialUrl] = React.useState(aboveUrl);

  useEffect(() => {
    setInitialUrl(aboveUrl);
  }, [aboveUrl]);

  const open = mode === 'insert' || mode === 'edit' || mode === 'cursor';

  useEffect(() => {
    if (aboveLink) {
      setTimeout(() => {
        setOption('activeId', aboveLink.id);
        setOption('mode', 'cursor');
        setOption('anchorElement', editor.api.toDOMNode(aboveLink)!);
      }, 0);

      return;
    }
    if (mode === 'cursor' && !aboveLink) {
      setOption('activeId', null);
      setOption('mode', null);
      setOption('anchorElement', null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aboveLink]);

  if (!open) return null;

  return (
    <Popover
      modal={false}
      onOpenChange={(isOpen) => {
        setOption('mode', isOpen ? 'insert' : null);
      }}
      open={open}
    >
      <PopoverAnchor
        virtualRef={{
          current: anchorElement!,
        }}
      />

      <PopoverContent
        align="center"
        onEscapeKeyDown={() => editor.tf.focus()}
        onOpenAutoFocus={(e) => {
          if (mode === 'cursor') return e.preventDefault();
        }}
        side="bottom"
      >
        {mode === 'insert' ? (
          <InsertLinkCommand initialUrl={initialUrl} />
        ) : (
          <EditLinkCommand
            autoFocus={mode !== 'cursor'}
            initialUrl={initialUrl}
            setInitialUrl={setInitialUrl}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

const InsertLinkCommand = ({ initialUrl }: { initialUrl: string }) => {
  const [query, setQuery] = React.useState(initialUrl);

  const { editor } = useEditorPlugin(linkPlugin);

  const recentDocuments = React.useMemo(
    () => mockRecentDocuments.slice(0, 5),
    []
  );

  const searchDocuments = React.useMemo(
    () =>
      mockRecentDocuments.filter((doc) =>
        doc.title?.toLowerCase().includes(query.toLowerCase())
      ),
    [query]
  );

  const count = searchDocuments.length;

  return (
    <Command shouldFilter={false}>
      <CommandInput
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing)
            return onUpsertLink(editor, query);
        }}
        onValueChange={(value) => setQuery(value)}
        placeholder="Paste link or search pages"
        value={query}
      />

      {count > 1 && (
        <span className="mx-2 font-medium text-gray-500 text-sm">Recents</span>
      )}
      <CommandList>
        {query.length === 0 &&
          recentDocuments.map((document) => (
            <InternalLinkCommandItem document={document} key={document.id} />
          ))}

        {query.length > 0 && (
          <>
            {searchDocuments.slice(0, 5).map((document) => (
              <InternalLinkCommandItem document={document} key={document.id} />
            ))}

            <OutsideLinkCommandItem query={query} />
          </>
        )}
      </CommandList>
    </Command>
  );
};

const EditLinkCommand = ({
  autoFocus,
  initialUrl,
  setInitialUrl,
}: {
  initialUrl: string;
  setInitialUrl: (url: string) => void;
  autoFocus?: boolean;
}) => {
  const [searching, setSearching] = React.useState(false);
  const [query, setQuery] = React.useState<string>('');
  const [text, setText] = React.useState<string>('');

  const mode = usePluginOption(linkPlugin, 'mode');

  const { editor, setOption } = useEditorPlugin(linkPlugin);
  const activeLinkId = usePluginOption(linkPlugin, 'activeId');

  const editingLinkEntry = useActiveLink();

  // Sync text from editor node - valid Effect (external editor state that user can then modify)
  useEffect(() => {
    if (editingLinkEntry) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- valid: syncing from external editor state
      setText(NodeApi.string(editingLinkEntry[0]));
    }
  }, [editingLinkEntry]);

  const document = mockRecentDocuments.find(
    (template) => template.id === initialUrl.slice(1)
  );

  const searchDocuments = React.useMemo(
    () =>
      mockRecentDocuments.filter((doc) =>
        doc.title?.toLowerCase().includes(query.toLowerCase())
      ),
    [query]
  );

  const onEditLink = (url: string) => {
    upsertLink(editor, {
      skipValidation: true,
      url,
    });

    setInitialUrl(url);
    setQuery('');
    setSearching(false);
    setOption('mode', 'cursor');
    setOption('anchorElement', editor.api.toDOMNode(editingLinkEntry![0])!);
    editor.tf.focus();
  };

  const updateLinkSelection = () => {
    editor.tf.select(
      editor.api.node({
        at: [],
        mode: 'lowest',
        match: (n) => n.type === linkPlugin.key && n.id === activeLinkId,
      })![0]
    );

    setTimeout(() => {
      editor.getApi(CursorOverlayPlugin).cursorOverlay.addCursor('selection', {
        selection: editor.selection,
      });

      setOption('anchorElement', getCursorOverlayElement() as any);
    }, 0);
  };

  const onTitleChange = (newTitle: string) => {
    setText(newTitle);

    if (newTitle.length === 0) return;

    const firstText = editingLinkEntry![0].children[0];

    const newLink = { ...firstText, text: newTitle };

    editor.tf.replaceNodes<TText>(newLink, {
      at: editingLinkEntry![1],
      children: true,
    });

    updateLinkSelection();
  };

  return (
    <>
      <div className="mt-2 px-3 font-medium text-muted-foreground text-xs">
        Page or URL
      </div>

      {searching ? (
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing)
                return onEditLink(query);
            }}
            onValueChange={(value) => setQuery(value)}
            placeholder="Paste link or search pages"
            value={query}
            wrapClassName="mt-0"
          />
          {query.length > 0 && (
            <CommandList>
              {searchDocuments.slice(0, 5).map((document) => (
                <InternalLinkCommandItem
                  document={document}
                  key={document.id}
                  onSelect={() => onEditLink(`/${document.id}`)}
                />
              ))}

              <OutsideLinkCommandItem query={query} />
            </CommandList>
          )}
        </Command>
      ) : (
        <div className="px-3 py-1.5">
          <button
            className={cn(
              inputVariants(),
              'flex w-full cursor-pointer items-center hover:bg-muted'
            )}
            onClick={() => {
              setSearching(true);

              const isInternal = initialUrl.startsWith('/');

              if (!isInternal) {
                setQuery(initialUrl);
              }
            }}
            type="button"
          >
            {document ? (
              <>
                {document.icon ? (
                  <span className="mr-1">{document.icon}</span>
                ) : (
                  <FileTextIcon className="size-3.5" />
                )}
                <span>{document.title}</span>
              </>
            ) : (
              <>
                <LinkIcon className="mt-px mr-1 size-3.5 shrink-0" />
                <span className="h-6 max-w-[200px] truncate text-sm leading-6">
                  {initialUrl}
                </span>
              </>
            )}
          </button>
        </div>
      )}

      {query.length === 0 && (
        <div className="my-2 px-3">
          <div className="mb-1.5 font-medium text-muted-foreground text-xs">
            Link title
          </div>

          <Input
            autoFocus={!searching && autoFocus}
            onChange={(e) => onTitleChange(e.target.value)}
            onFocus={() => {
              if (mode === 'cursor') {
                setOption('mode', 'edit');
                updateLinkSelection();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();

                editor.tf.select(editingLinkEntry![0], { focus: true });
                setOption(
                  'anchorElement',
                  editor.api.toDOMNode(editingLinkEntry![0])!
                );
                setOption('mode', 'cursor');
              }
            }}
            value={text}
          />

          <Button
            className="mt-4 w-full"
            onClick={() => {
              unwrapLink(editor);
              setOption('mode', null);
              editor.tf.focus();
            }}
            variant="outline"
          >
            <Trash2Icon />
            Remove link
          </Button>
        </div>
      )}
    </>
  );
};

const OutsideLinkCommandItem = ({ query }: { query: string }) => {
  const editor = useEditorRef();

  return (
    <CommandItem
      className="h-fit py-1"
      onSelect={() => onUpsertLink(editor, query)}
    >
      <LinkIcon className="mr-2 size-3.5 shrink-0" />
      <div className="flex flex-col">
        <span className="truncate font-medium text-sm">{query}</span>
        <span className="text-gray-500 text-xs">
          {validateUrl(editor, query)
            ? 'Link to web page'
            : 'Type a complete URL to link'}
        </span>
      </div>
    </CommandItem>
  );
};

const InternalLinkCommandItem = ({
  document,
  onSelect,
}: {
  document: any;
  onSelect?: () => void;
}) => {
  const editor = useEditorRef();

  return (
    <CommandItem
      autoFocus
      className="flex items-center gap-2"
      onSelect={() => {
        if (onSelect) return onSelect();

        onUpsertLink(editor, `/${document.id}`);
      }}
    >
      {document.icon ? (
        <span>{document.icon}</span>
      ) : (
        <FileTextIcon className="size-3.5" />
      )}
      <span>{document.title}</span>
    </CommandItem>
  );
};

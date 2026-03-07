'use client';

import {
  AIChatPlugin,
  AIPlugin,
  useEditorChat,
  useLastAssistantMessage,
} from '@platejs/ai/react';
import { BlockSelectionPlugin, useIsSelecting } from '@platejs/selection/react';
import { getTransientSuggestionKey } from '@platejs/suggestion';
import {
  AlbumIcon,
  ArrowUpIcon,
  BadgeHelpIcon,
  CheckIcon,
  CornerUpLeftIcon,
  FeatherIcon,
  LanguagesIcon,
  ListEnd,
  ListMinusIcon,
  ListPlusIcon,
  PenLineIcon,
  Wand,
  X,
} from 'lucide-react';
import { isHotkey, KEYS, NodeApi, type NodeEntry } from 'platejs';
import {
  type PlateEditor,
  useEditorPlugin,
  useEditorRef,
  useHotkeys,
  usePluginOption,
} from 'platejs/react';
import React, { useEffect } from 'react';

import { cn } from '@/lib/utils';

import { AIChatEditor } from './ai-chat-editor';
import { Button } from './button';
import {
  type Action,
  ComboboxContent,
  ComboboxInput,
  ComboboxList,
  filterMenuGroups,
  filterMenuItems,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuTrigger,
  useComboboxValueState,
  useMenuStore,
} from './menu';
import { TextareaAutosize } from './textarea';

export function AIMenu() {
  const { api, editor } = useEditorPlugin(AIChatPlugin);
  const open = usePluginOption(AIChatPlugin, 'open');
  const mode = usePluginOption(AIChatPlugin, 'mode');
  const isSelecting = useIsSelecting();
  const streaming = usePluginOption(AIChatPlugin, 'streaming');

  const [input, setInput] = React.useState('');
  const toolName = usePluginOption(AIChatPlugin, 'toolName');
  const chat = usePluginOption(AIChatPlugin, 'chat');

  const { messages, status } = chat;
  const isLoading = status === 'streaming' || status === 'submitted';

  const content = useLastAssistantMessage()?.parts.find(
    (part) => part.type === 'text'
  )?.text;

  const { show, store } = useMenuStore();

  useEffect(() => {
    if (streaming) {
      const anchor = api.aiChat.node({ anchor: true });
      setTimeout(() => {
        const anchorDom = editor.api.toDOMNode(anchor![0])!;
        store.setAnchorElement(anchorDom);
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  useEditorChat({
    chat,
    onOpenBlockSelection: (blocks: NodeEntry[]) => {
      show(editor.api.toDOMNode(blocks.at(-1)![0])!);
    },
    onOpenChange: (open) => {
      if (!open) {
        store.hideAll();
        setInput('');
      }
    },
    onOpenCursor: () => {
      const [ancestor] = editor.api.block({ highest: true })!;

      if (!editor.api.isAt({ end: true }) && !editor.api.isEmpty(ancestor)) {
        editor
          .getApi(BlockSelectionPlugin)
          .blockSelection.set(ancestor.id as string);
      }

      show(editor.api.toDOMNode(ancestor)!);
    },
    onOpenSelection: () => {
      show(editor.api.toDOMNode(editor.api.blocks().at(-1)![0])!);
    },
  });

  useHotkeys('escape', () => {
    if (isLoading) {
      api.aiChat.stop();
    } else {
      api.aiChat.hide();
    }
  });

  React.useLayoutEffect(() => {
    if (toolName === 'edit' && mode === 'chat' && status === 'ready') {
      let anchorNode = editor.api.node({
        at: [],
        reverse: true,
        match: (n) => !!n[KEYS.suggestion] && !!n[getTransientSuggestionKey()],
      });

      if (!anchorNode) {
        anchorNode = editor
          .getApi(BlockSelectionPlugin)
          .blockSelection.getNodes({ selectionFallback: true, sort: true })
          .at(-1);
      }
      if (!anchorNode) return;

      // BUG
      setTimeout(() => {
        const block = editor.api.block({ at: anchorNode[1] });
        const domNode = editor.api.toDOMNode(block![0]!)!;
        store.setAnchorElement(domNode);
      }, 0);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (status === 'ready') {
      setInput('');
    }
  }, [status]);

  if (toolName === 'comment' && status === 'ready') return null;

  return (
    <Menu open={open} placement="bottom-start" store={store}>
      <MenuContent
        flip={false}
        onClickOutside={() => {
          api.aiChat.hide();
        }}
        variant="ai"
        wrapperProps={{
          // FIXME: It is best to set it to 100.
          // But it will cause a horizontal scrollbar to appear.
          // A method should be found to disable translate-x.
          className: 'w-[98%]!',
        }}
      >
        <ComboboxContent variant="ai">
          {mode === 'chat' &&
            isSelecting &&
            content &&
            toolName === 'generate' && <AIChatEditor content={content} />}

          <div className="flex gap-1.5 px-3 text-sm">
            {isLoading ? (
              <div className="flex grow select-none items-center gap-2 py-2 text-muted-foreground">
                {messages.length > 1 ? 'Editing' : 'Thinking'}

                <LoadingIcon />
              </div>
            ) : (
              <AIMenuCombobox input={input} setInput={setInput} />
            )}

            <Button
              className="no-focus-ring mt-1 shrink-0"
              disabled={!isLoading && input.trim().length === 0}
              onClick={() => {
                if (isLoading) {
                  api.aiChat.stop();
                } else {
                  void api.aiChat.submit(input);
                  setInput('');
                }
              }}
              size="iconSm"
              variant="ghost"
            >
              {isLoading ? <StopIcon /> : <SubmitIcon />}
            </Button>
          </div>
        </ComboboxContent>

        {!isLoading && (
          <ComboboxList
            className={cn('[&_.menu-item-icon]:text-purple-700')}
            variant="ai"
          >
            <AIMenuItems input={input} setInput={setInput} store={store} />
          </ComboboxList>
        )}
      </MenuContent>
    </Menu>
  );
}

type EditorChatState =
  | 'cursorCommand'
  | 'cursorSuggestion'
  | 'selectionCommand'
  | 'selectionSuggestion';

const GROUP = {
  LANGUAGES: 'group_languages',
  SELECTION_LANGUAGES: 'group_selection_languages',
} as const;

const aiChatItems = {
  accept: {
    icon: <CheckIcon />,
    label: 'Accept',
    value: 'accept',
    onSelect: ({ aiEditor, editor }) => {
      const { mode, toolName } = editor.getOptions(AIChatPlugin);

      if (mode === 'chat' && toolName === 'generate') {
        return editor
          .getTransforms(AIChatPlugin)
          .aiChat.replaceSelection(aiEditor);
      }

      editor.getTransforms(AIChatPlugin).aiChat.accept();
      editor.tf.focus({ edge: 'end' });
    },
  },
  continueWrite: {
    icon: <PenLineIcon />,
    label: 'Continue writing',
    value: 'continueWrite',
    onSelect: ({ editor, input }) => {
      const ancestorNode = editor.api.block({ highest: true });

      if (!ancestorNode) return;

      const isEmpty = NodeApi.string(ancestorNode[0]).trim().length === 0;

      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        mode: 'insert',
        prompt: isEmpty
          ? `<Document>
{editor}
</Document>
Start writing a new paragraph AFTER <Document> ONLY ONE SENTENCE`
          : 'Continue writing AFTER <Block> ONLY ONE SENTENCE. DONT REPEAT THE TEXT.',
        toolName: 'generate',
      });
    },
  },
  discard: {
    icon: <X />,
    label: 'Discard',
    shortcut: 'Escape',
    value: 'discard',
    onSelect: ({ editor }) => {
      editor.getTransforms(AIPlugin).ai.undo();
      editor.getApi(AIChatPlugin).aiChat.hide();
    },
  },
  explain: {
    icon: <BadgeHelpIcon />,
    label: 'Explain',
    value: 'explain',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt: {
          default: 'Explain {editor}',
          selecting: 'Explain',
        },
        toolName: 'generate',
      });
    },
  },
  fixSpelling: {
    icon: <CheckIcon />,
    label: 'Fix spelling & grammar',
    value: 'fixSpelling',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt: 'Fix spelling and grammar',
        toolName: 'edit',
      });
    },
  },
  [GROUP.LANGUAGES]: {
    component: TranslateMenuItems,
    filterItems: true,
    icon: <LanguagesIcon className="text-green-800" />,
    items: [
      { label: 'English', value: 'translate_english' },
      { label: 'Korean', value: 'translate_korean' },
      {
        label: 'Chinese, Simplified',
        value: 'translate_chinese_simplified',
      },
      {
        label: 'Chinese, Traditional',
        value: 'translate_chinese_traditional',
      },
      { label: 'Japanese', value: 'translate_japanese' },
      { label: 'Spanish', value: 'translate_spanish' },
      { label: 'Russian', value: 'translate_russian' },
      { label: 'French', value: 'translate_french' },
      { label: 'Portuguese', value: 'translate_portuguese' },
      { label: 'German', value: 'translate_german' },
      { label: 'Italian', value: 'translate_italian' },
      { label: 'Dutch', value: 'translate_dutch' },
      { label: 'Indonesian', value: 'translate_indonesian' },
      { label: 'Filipino', value: 'translate_filipino' },
      { label: 'Vietnamese', value: 'translate_vietnamese' },
      { label: 'Turkish', value: 'translate_turkish' },
      { label: 'Arabic', value: 'translate_arabic' },
    ],
    label: 'Languages',
    value: GROUP.LANGUAGES,
  },
  [GROUP.SELECTION_LANGUAGES]: {
    component: TranslateMenuItems,
    filterItems: true,
    icon: <LanguagesIcon className="text-green-800" />,
    items: [
      { label: 'English', value: 'translate_english' },
      { label: 'Korean', value: 'translate_korean' },
      {
        label: 'Chinese, Simplified',
        value: 'translate_chinese_simplified',
      },
      {
        label: 'Chinese, Traditional',
        value: 'translate_chinese_traditional',
      },
      { label: 'Japanese', value: 'translate_japanese' },
      { label: 'Spanish', value: 'translate_spanish' },
      { label: 'Russian', value: 'translate_russian' },
      { label: 'French', value: 'translate_french' },
      { label: 'Portuguese', value: 'translate_portuguese' },
      { label: 'German', value: 'translate_german' },
      { label: 'Italian', value: 'translate_italian' },
      { label: 'Dutch', value: 'translate_dutch' },
      { label: 'Indonesian', value: 'translate_indonesian' },
      { label: 'Filipino', value: 'translate_filipino' },
      { label: 'Vietnamese', value: 'translate_vietnamese' },
      { label: 'Turkish', value: 'translate_turkish' },
      { label: 'Arabic', value: 'translate_arabic' },
    ],
    label: 'Languages',
    value: GROUP.LANGUAGES,
  },
  improveWriting: {
    icon: <Wand />,
    label: 'Improve writing',
    value: 'improveWriting',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt: 'Improve the writing',
        toolName: 'edit',
      });
    },
  },
  insertBelow: {
    icon: <ListEnd />,
    label: 'Insert below',
    value: 'insertBelow',
    onSelect: ({ aiEditor, editor }) => {
      void editor
        .getTransforms(AIChatPlugin)
        .aiChat.insertBelow(aiEditor, { format: 'none' });
    },
  },
  makeLonger: {
    icon: <ListPlusIcon />,
    label: 'Make longer',
    value: 'makeLonger',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt: 'Make longer',
        toolName: 'edit',
      });
    },
  },
  makeShorter: {
    icon: <ListMinusIcon />,
    label: 'Make shorter',
    value: 'makeShorter',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt: 'Make shorter',
        toolName: 'edit',
      });
    },
  },
  simplifyLanguage: {
    icon: <FeatherIcon />,
    label: 'Simplify language',
    value: 'simplifyLanguage',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt: 'Simplify the language',
        toolName: 'edit',
      });
    },
  },
  summarize: {
    icon: <AlbumIcon />,
    label: 'Add a summary',
    value: 'summarize',
    onSelect: ({ editor, input }) => {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        mode: 'insert',
        prompt: {
          default: 'Summarize {editor}',
          selecting: 'Summarize',
        },
        toolName: 'generate',
      });
    },
  },
  tryAgain: {
    icon: <CornerUpLeftIcon />,
    label: 'Try again',
    value: 'tryAgain',
    onSelect: ({ editor, store }) => {
      void editor.getApi(AIChatPlugin).aiChat.reload();

      setTimeout(() => {
        const anchor = editor
          .getApi(BlockSelectionPlugin)
          .blockSelection.getNodes({ selectionFallback: true, sort: true })
          .at(-1)!;
        const anchorDom = editor.api.toDOMNode(anchor[0])!;
        store.setAnchorElement(anchorDom);
      }, 0);
    },
  },
} satisfies Record<
  string,
  {
    icon: React.ReactNode;
    label: string;
    value: string;
    component?: React.ComponentType<{ menuState: EditorChatState }>;
    filterItems?: boolean;
    items?: { label: string; value: string }[];
    shortcut?: string;
    onSelect?: ({
      aiEditor,
      editor,
      input,
      store,
    }: {
      aiEditor: PlateEditor;
      editor: PlateEditor;
      input: string;
      store: any;
    }) => void;
  }
>;

const menuStateItems = {
  cursorCommand: [
    {
      items: [
        aiChatItems.continueWrite,
        aiChatItems.summarize,
        aiChatItems.explain,
      ],
    },
  ],
  cursorSuggestion: [
    {
      items: [aiChatItems.accept, aiChatItems.discard, aiChatItems.tryAgain],
    },
  ],
  selectionCommand: [
    {
      items: [
        aiChatItems.improveWriting,
        aiChatItems.makeLonger,
        aiChatItems.makeShorter,
        aiChatItems.fixSpelling,
        aiChatItems.simplifyLanguage,
      ],
    },
    {
      items: [aiChatItems[GROUP.SELECTION_LANGUAGES]],
    },
  ],
  selectionSuggestion: [
    {
      items: [
        aiChatItems.accept,
        aiChatItems.discard,
        aiChatItems.insertBelow,
        aiChatItems.tryAgain,
      ],
    },
  ],
};

function AIMenuItems({
  input,
  setInput,
  store,
}: {
  input: string;
  store: any;
  setInput: (value: string) => void;
}) {
  const editor = useEditorRef();
  const [searchValue] = useComboboxValueState();
  const { messages } = usePluginOption(AIChatPlugin, 'chat');
  const aiEditor = usePluginOption(AIChatPlugin, 'aiEditor')!;
  const isSelecting = useIsSelecting();

  const menuState = React.useMemo(() => {
    if (messages && messages.length > 0) {
      return isSelecting ? 'selectionSuggestion' : 'cursorSuggestion';
    }

    return isSelecting ? 'selectionCommand' : 'cursorCommand';
  }, [isSelecting, messages]);

  const menuGroups = React.useMemo(() => {
    const items = menuStateItems[menuState] || [];

    return filterMenuGroups(items, searchValue) || items;
  }, [menuState, searchValue]);

  return (
    <>
      {menuGroups.map((group, index) => (
        <MenuGroup key={index} label={group.label}>
          {group.items?.map((item: Action) => {
            const menuItem = aiChatItems[item.value!];

            if (menuItem.component) {
              const ItemComponent = menuItem.component;

              return (
                <ItemComponent
                  input={input}
                  key={item.value}
                  menuState={menuState}
                />
              );
            }

            return (
              <MenuItem
                icon={menuItem.icon}
                key={item.value}
                label={menuItem.label}
                onClick={() => {
                  menuItem.onSelect?.({ aiEditor, editor, input, store });
                  setInput('');
                }}
                shortcutEnter
              />
            );
          })}
        </MenuGroup>
      ))}
    </>
  );
}

function TranslateMenuItems({
  input,
  menuState,
}: {
  input: string;
  menuState: EditorChatState;
}) {
  const editor = useEditorRef();
  const [searchValue] = useComboboxValueState();

  const menuItems = React.useMemo(
    () => filterMenuItems(aiChatItems[GROUP.LANGUAGES], searchValue),
    [searchValue]
  );

  const handleTranslate = (value: string) => {
    if (menuState === 'cursorCommand') {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        mode: 'insert',
        prompt: `Translate to ${value} the "Block" content`,
        toolName: 'edit',
      });

      return;
    }
    if (menuState === 'selectionCommand') {
      void editor.getApi(AIChatPlugin).aiChat.submit(input, {
        prompt: `Translate to ${value}`,
        toolName: 'edit',
      });

      return;
    }
  };

  const content = (
    <>
      {menuItems.map((item) => (
        <MenuItem
          icon={item.icon}
          key={item.value}
          label={item.label}
          onClick={() => handleTranslate(item.label!)}
          shortcutEnter
        />
      ))}
    </>
  );

  if (searchValue)
    return (
      <MenuGroup label={aiChatItems[GROUP.LANGUAGES].label}>
        {content}
      </MenuGroup>
    );

  return (
    <Menu
      trigger={
        <MenuTrigger
          icon={aiChatItems[GROUP.LANGUAGES].icon}
          label={aiChatItems[GROUP.LANGUAGES].label}
        />
      }
    >
      <MenuContent variant="aiSub">
        <MenuGroup>{content}</MenuGroup>
      </MenuContent>
    </Menu>
  );
}

function AIMenuCombobox({
  input,
  setInput,
}: {
  input: string;
  setInput: (value: string) => void;
}) {
  const { api } = useEditorPlugin(AIChatPlugin);
  const [, setValue] = useComboboxValueState();

  useEffect(() => {
    setValue(input ?? '');
  }, [input, setValue]);

  return (
    <ComboboxInput autoFocus autoSelect="always">
      <TextareaAutosize
        className="grow"
        data-plate-focus
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (isHotkey('backspace')(e) && input?.length === 0) {
            e.preventDefault();
            api.aiChat.hide();
          }
          if (isHotkey('enter')(e) && !e.shiftKey) {
            e.preventDefault();

            if (input && input.length > 0) {
              void api.aiChat.submit(input);
            }
          }
        }}
        placeholder="Ask AI anything..."
        variant="ai"
      />
    </ComboboxInput>
  );
}

function StopIcon() {
  return (
    <svg
      height="20"
      viewBox="0 0 20 20"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="10" cy="10" fill="black" r="10" />
      <rect fill="white" height="6" rx="1" width="6" x="7" y="7" />
    </svg>
  );
}

function SubmitIcon() {
  return (
    <div
      className={cn(
        'flex size-5 items-center justify-center rounded-full bg-brand'
      )}
    >
      <ArrowUpIcon className="size-3! stroke-[3px] text-background" />
    </div>
  );
}

function LoadingIcon() {
  return (
    <div className="flex gap-0.5">
      {['#eab308', '#ea580c', '#6EB6F2'].map((color, index) => (
        <div
          className="size-1 animate-ai-bounce rounded-full"
          key={color}
          style={{
            animationDelay: `${index * 0.1}s`,
            backgroundColor: color,
          }}
        />
      ))}
    </div>
  );
}

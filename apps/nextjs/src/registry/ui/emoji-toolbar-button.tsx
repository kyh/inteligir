'use client';
/* eslint-disable react-hooks/refs */

import {
  type Emoji,
  type EmojiCategoryList,
  type EmojiIconList,
  EmojiSettings,
  type GridRow,
} from '@platejs/emoji';

import type {
  IEmojiFloatingLibrary,
  UseEmojiPickerType,
} from '@platejs/emoji/react';
import {
  AppleIcon,
  ClockIcon,
  CompassIcon,
  DeleteIcon,
  FlagIcon,
  LeafIcon,
  LightbulbIcon,
  MusicIcon,
  SearchIcon,
  SmileIcon,
  StarIcon,
  XIcon,
} from 'lucide-react';
import { Popover } from 'radix-ui';
import React, { memo, type ReactNode, useCallback } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/registry/ui/button';

export function EmojiPopover({
  children,
  control,
  isOpen,
  setIsOpen,
}: {
  children: ReactNode;
  control: ReactNode;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}) {
  return (
    <Popover.Root onOpenChange={setIsOpen} open={isOpen}>
      <Popover.Trigger asChild>{control}</Popover.Trigger>

      <Popover.Portal>
        <Popover.Content className="z-100">{children}</Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function EmojiPicker({
  clearSearch,
  emoji,
  emojiLibrary,
  focusedCategory,
  hasFound,
  i18n,
  icons = {
    categories: emojiCategoryIcons,
    search: emojiSearchIcons,
  },
  isSearching,
  refs,
  searchResult,
  searchValue,
  setSearch,
  settings = EmojiSettings,
  visibleCategories,
  handleCategoryClick,
  onMouseOver,
  onSelectEmoji,
}: Omit<UseEmojiPickerType, 'icons'> & {
  icons?: EmojiIconList<React.ReactElement>;
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl bg-popover text-popover-foreground',
        'h-[23rem] w-80 border shadow-md'
      )}
    >
      <EmojiPickerNavigation
        emojiLibrary={emojiLibrary}
        focusedCategory={focusedCategory}
        i18n={i18n}
        icons={icons}
        onClick={handleCategoryClick}
      />
      <EmojiPickerSearchBar
        i18n={i18n}
        searchValue={searchValue}
        setSearch={setSearch}
      >
        <EmojiPickerSearchAndClear
          clearSearch={clearSearch}
          i18n={i18n}
          searchValue={searchValue}
        />
      </EmojiPickerSearchBar>
      <EmojiPickerContent
        emojiLibrary={emojiLibrary}
        i18n={i18n}
        isSearching={isSearching}
        onMouseOver={onMouseOver}
        onSelectEmoji={onSelectEmoji}
        refs={refs}
        searchResult={searchResult}
        settings={settings}
        visibleCategories={visibleCategories}
      />
      <EmojiPickerPreview
        emoji={emoji}
        hasFound={hasFound}
        i18n={i18n}
        isSearching={isSearching}
      />
    </div>
  );
}

const EmojiButton = memo(
  ({
    emoji,
    index,
    onMouseOver,
    onSelect,
  }: {
    emoji: Emoji;
    index: number;
    onMouseOver: (emoji?: Emoji) => void;
    onSelect: (emoji: Emoji) => void;
  }) => (
    <button
      aria-label={emoji.skins[0].native}
      className="group relative flex size-9 cursor-pointer items-center justify-center border-none bg-transparent text-2xl leading-none"
      data-index={index}
      onClick={() => onSelect(emoji)}
      onMouseEnter={() => onMouseOver(emoji)}
      onMouseLeave={() => onMouseOver()}
      tabIndex={-1}
      type="button"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100"
      />
      <span
        className="relative"
        data-emoji-set="native"
        style={{
          fontFamily:
            '"Apple Color Emoji", "Segoe UI Emoji", NotoColorEmoji, "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", EmojiSymbols',
        }}
      >
        {emoji.skins[0].native}
      </span>
    </button>
  )
);

const RowOfButtons = memo(
  ({
    emojiLibrary,
    row,
    onMouseOver,
    onSelectEmoji,
  }: {
    row: GridRow;
  } & Pick<
    UseEmojiPickerType,
    'emojiLibrary' | 'onMouseOver' | 'onSelectEmoji'
  >) => (
    <div className="flex" data-index={row.id} key={row.id}>
      {row.elements.map((emojiId, index) => (
        <EmojiButton
          emoji={emojiLibrary.getEmoji(emojiId)}
          index={index}
          key={emojiId}
          onMouseOver={onMouseOver}
          onSelect={onSelectEmoji}
        />
      ))}
    </div>
  )
);

function EmojiPickerContent({
  emojiLibrary,
  i18n,
  isSearching = false,
  refs,
  searchResult,
  settings = EmojiSettings,
  visibleCategories,
  onMouseOver,
  onSelectEmoji,
}: Pick<
  UseEmojiPickerType,
  | 'emojiLibrary'
  | 'i18n'
  | 'isSearching'
  | 'onMouseOver'
  | 'onSelectEmoji'
  | 'refs'
  | 'searchResult'
  | 'settings'
  | 'visibleCategories'
>) {
  const getRowWidth = settings.perLine.value * settings.buttonSize.value;

  const isCategoryVisible = useCallback(
    (categoryId: any) =>
      visibleCategories.has(categoryId)
        ? visibleCategories.get(categoryId)
        : false,
    [visibleCategories]
  );

  const EmojiList = useCallback(
    () =>
      emojiLibrary
        .getGrid()
        .sections()
        .map(({ id: categoryId }) => {
          const section = emojiLibrary.getGrid().section(categoryId);
          const { buttonSize } = settings;

          return (
            <div
              data-id={categoryId}
              key={categoryId}
              ref={section.root}
              style={{ width: getRowWidth }}
            >
              <div className="-top-px sticky z-1 bg-popover/90 p-1 py-2 font-semibold text-sm backdrop-blur-xs">
                {i18n.categories[categoryId]}
              </div>
              <div
                className="relative flex flex-wrap"
                style={{ height: section.getRows().length * buttonSize.value }}
              >
                {isCategoryVisible(categoryId) &&
                  section
                    .getRows()
                    .map((row: GridRow) => (
                      <RowOfButtons
                        emojiLibrary={emojiLibrary}
                        key={row.id}
                        onMouseOver={onMouseOver}
                        onSelectEmoji={onSelectEmoji}
                        row={row}
                      />
                    ))}
              </div>
            </div>
          );
        }),
    [
      emojiLibrary,
      getRowWidth,
      i18n.categories,
      isCategoryVisible,
      onSelectEmoji,
      onMouseOver,
      settings,
    ]
  );

  const SearchList = useCallback(
    () => (
      <div data-id="search" style={{ width: getRowWidth }}>
        <div className="-top-px sticky z-1 bg-popover/90 p-1 py-2 font-semibold text-card-foreground text-sm backdrop-blur-xs">
          {i18n.searchResult}
        </div>
        <div className="relative flex flex-wrap">
          {searchResult.map((emoji: Emoji, index: number) => (
            <EmojiButton
              emoji={emojiLibrary.getEmoji(emoji.id)}
              index={index}
              key={emoji.id}
              onMouseOver={onMouseOver}
              onSelect={onSelectEmoji}
            />
          ))}
        </div>
      </div>
    ),
    [
      emojiLibrary,
      getRowWidth,
      i18n.searchResult,
      searchResult,
      onSelectEmoji,
      onMouseOver,
    ]
  );

  return (
    <div
      className={cn(
        'h-full min-h-[50%] overflow-y-auto overflow-x-hidden px-2',
        '[&::-webkit-scrollbar]:w-4',
        '[&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-button]:size-0',
        ':hover:[&::-webkit-scrollbar-thumb]:bg-[#f3f4f6]',
        '[&::-webkit-scrollbar-thumb]:min-h-[65px] [&::-webkit-scrollbar-thumb]:rounded-2xl [&::-webkit-scrollbar-thumb]:border-4 [&::-webkit-scrollbar-thumb]:border-white',
        '[&::-webkit-scrollbar-track]:border-0'
      )}
      data-id="scroll"
      ref={refs.current.contentRoot}
    >
      <div className="h-full" ref={refs.current.content}>
        {isSearching ? SearchList() : EmojiList()}
      </div>
    </div>
  );
}

function EmojiPickerSearchBar({
  children,
  i18n,
  searchValue,
  setSearch,
}: {
  children: ReactNode;
} & Pick<UseEmojiPickerType, 'i18n' | 'searchValue' | 'setSearch'>) {
  return (
    <div className="flex items-center px-2">
      <div className="relative flex grow items-center">
        <input
          aria-label="Search"
          autoComplete="off"
          className="block w-full appearance-none rounded-full border-0 bg-muted px-10 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus-visible:outline-hidden"
          onChange={(event) => setSearch(event.target.value)}
          placeholder={i18n.search}
          type="text"
          value={searchValue}
        />
        {children}
      </div>
    </div>
  );
}

function EmojiPickerSearchAndClear({
  clearSearch,
  i18n,
  searchValue,
}: Pick<UseEmojiPickerType, 'clearSearch' | 'i18n' | 'searchValue'>) {
  return (
    <div className="flex items-center">
      <div
        className={cn(
          '-translate-y-1/2 absolute top-1/2 left-3 z-10 flex size-5 items-center justify-center'
        )}
      >
        <SearchIcon className="size-4" />
      </div>
      {searchValue && (
        <Button
          aria-label="Clear"
          className={cn(
            '-translate-y-1/2 absolute top-1/2 right-1 flex size-8 cursor-pointer items-center justify-center border-none bg-transparent'
          )}
          onClick={clearSearch}
          size="icon"
          title={i18n.clear}
          type="button"
          variant="ghost"
        >
          <DeleteIcon className="size-4" />
        </Button>
      )}
    </div>
  );
}

function EmojiPreview({ emoji }: Pick<UseEmojiPickerType, 'emoji'>) {
  return (
    <div className="flex h-20 items-center border-muted border-t p-2">
      <div
        className="flex items-center justify-center text-2xl"
        style={{
          fontFamily:
            '"Apple Color Emoji", "Segoe UI Emoji", NotoColorEmoji, "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", EmojiSymbols',
        }}
      >
        {emoji?.skins[0].native}
      </div>
      <div className="overflow-hidden pl-2">
        <div className="truncate text-sm">{emoji?.name}</div>
        <div className="truncate text-xs">{`:${emoji?.id}:`}</div>
      </div>
    </div>
  );
}

function NoEmoji({ i18n }: Pick<UseEmojiPickerType, 'i18n'>) {
  return (
    <div className="flex h-20 items-center border-muted border-t p-2">
      <div className="flex items-center justify-center text-2xl">😢</div>
      <div className="overflow-hidden pl-2">
        <div className="truncate font-semibold text-primary text-sm">
          {i18n.searchNoResultsTitle}
        </div>
        <div className="truncate text-xs">{i18n.searchNoResultsSubtitle}</div>
      </div>
    </div>
  );
}

function PickAnEmoji({ i18n }: Pick<UseEmojiPickerType, 'i18n'>) {
  return (
    <div className="flex h-20 items-center border-muted border-t p-2">
      <div className="flex items-center justify-center text-2xl">☝️</div>
      <div className="overflow-hidden pl-2">
        <div className="truncate font-semibold text-sm">{i18n.pick}</div>
      </div>
    </div>
  );
}

function EmojiPickerPreview({
  emoji,
  hasFound = true,
  i18n,
  isSearching = false,
  ...props
}: Pick<UseEmojiPickerType, 'emoji' | 'hasFound' | 'i18n' | 'isSearching'>) {
  const showPickEmoji = !emoji && !(isSearching && !hasFound);
  const showNoEmoji = isSearching && !hasFound;
  const showPreview = emoji;

  return (
    <>
      {showPreview && <EmojiPreview emoji={emoji} {...props} />}
      {showPickEmoji && <PickAnEmoji i18n={i18n} {...props} />}
      {showNoEmoji && <NoEmoji i18n={i18n} {...props} />}
    </>
  );
}

const getBarProperty = (
  emojiLibrary: IEmojiFloatingLibrary,
  focusedCategory?: EmojiCategoryList
) => {
  let width = 0;
  let position = 0;

  if (focusedCategory) {
    width = 100 / emojiLibrary.getGrid().size;
    position = focusedCategory
      ? emojiLibrary.indexOf(focusedCategory) * 100
      : 0;
  }

  return { position, width };
};

function EmojiPickerNavigation({
  emojiLibrary,
  focusedCategory,
  i18n,
  icons,
  onClick,
}: {
  onClick: (id: EmojiCategoryList) => void;
} & Pick<
  UseEmojiPickerType,
  'emojiLibrary' | 'focusedCategory' | 'i18n' | 'icons'
>) {
  const { position, width } = getBarProperty(emojiLibrary, focusedCategory);

  return (
    <nav
      className="mb-2.5 border-0 border-b border-b-border border-solid p-3"
      id="emoji-nav"
    >
      <div className="relative flex items-center">
        {emojiLibrary
          .getGrid()
          .sections()
          .map(({ id }) => (
            <Button
              aria-label={i18n.categories[id]}
              className={cn(
                'size-6 grow fill-current text-muted-foreground hover:bg-transparent hover:text-foreground',
                id === focusedCategory &&
                  'pointer-events-none fill-current text-primary'
              )}
              key={id}
              onClick={() => onClick(id)}
              size="icon"
              title={i18n.categories[id]}
              type="button"
              variant="ghost"
            >
              <span className="size-5">{icons.categories[id].outline}</span>
            </Button>
          ))}
        <div
          className="-bottom-3 absolute left-0 h-0.5 w-full rounded-t-lg bg-primary opacity-100 transition-transform duration-200"
          style={{
            transform: `translateX(${position}%)`,
            visibility: `${focusedCategory ? 'visible' : 'hidden'}`,
            width: `${width}%`,
          }}
        />
      </div>
    </nav>
  );
}

export const emojiCategoryIcons: Record<
  EmojiCategoryList,
  { outline: React.ReactElement; solid: React.ReactElement }
> = {
  activity: {
    outline: (
      <svg
        className="size-full"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2.1 13.4A10.1 10.1 0 0 0 13.4 2.1" />
        <path d="m5 4.9 14 14.2" />
        <path d="M21.9 10.6a10.1 10.1 0 0 0-11.3 11.3" />
      </svg>
    ),
    solid: (
      <svg
        className="size-full"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2.1 13.4A10.1 10.1 0 0 0 13.4 2.1" />
        <path d="m5 4.9 14 14.2" />
        <path d="M21.9 10.6a10.1 10.1 0 0 0-11.3 11.3" />
      </svg>
    ),
  },

  custom: {
    outline: <StarIcon className="size-full" />,
    solid: <StarIcon className="size-full" />,
  },

  flags: {
    outline: <FlagIcon className="size-full" />,
    solid: <FlagIcon className="size-full" />,
  },

  foods: {
    outline: <AppleIcon className="size-full" />,
    solid: <AppleIcon className="size-full" />,
  },

  frequent: {
    outline: <ClockIcon className="size-full" />,
    solid: <ClockIcon className="size-full" />,
  },

  nature: {
    outline: <LeafIcon className="size-full" />,
    solid: <LeafIcon className="size-full" />,
  },

  objects: {
    outline: <LightbulbIcon className="size-full" />,
    solid: <LightbulbIcon className="size-full" />,
  },

  people: {
    outline: <SmileIcon className="size-full" />,
    solid: <SmileIcon className="size-full" />,
  },

  places: {
    outline: <CompassIcon className="size-full" />,
    solid: <CompassIcon className="size-full" />,
  },

  symbols: {
    outline: <MusicIcon className="size-full" />,
    solid: <MusicIcon className="size-full" />,
  },
};

const emojiSearchIcons = {
  delete: <XIcon className="size-4 text-current" />,
  loupe: <SearchIcon className="size-4 text-current" />,
};

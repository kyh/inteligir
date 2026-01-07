'use client';

import EmojiPicker, { Theme } from 'emoji-picker-react';
import { useTheme } from 'next-themes';
import { useState } from 'react';

import { useTParams } from '@/hooks/use-navigation';
import { Button } from '@/registry/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/registry/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/registry/ui/tabs';
import { useUpdateDocumentMutation } from '@/trpc/hooks/document-hooks';

import { useAuthGuard } from '../auth/useAuthGuard';

type IconPickerProps = {
  children: React.ReactNode;
  asChild?: boolean;
};

export const DocumentIconPicker = ({ children }: IconPickerProps) => {
  const { resolvedTheme } = useTheme();
  const currentTheme = (resolvedTheme || 'light') as keyof typeof themeMap;
  const themeMap = {
    dark: Theme.DARK,
    light: Theme.LIGHT,
  };
  const theme = themeMap[currentTheme];
  const { documentId: id } = useTParams<'/[documentId]'>();
  const authGuard = useAuthGuard();
  const [open, setOpen] = useState(false);

  const updateDocument = useUpdateDocumentMutation();

  const onChange = (icon: string) => {
    if (!id) return;
    authGuard(() => {
      updateDocument.mutate({
        id,
        icon,
      });
      setOpen(false);
    });
  };

  const onRemove = () => {
    if (!id) return;
    updateDocument.mutate({
      id,
      icon: null,
    });
    setOpen(false);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Tabs defaultValue="emojis">
          <TabsList className="min-w-[350px]">
            <TabsTrigger value="emojis">Emojis</TabsTrigger>

            <Button className="ml-auto" onClick={onRemove} variant="ghost2">
              Remove
            </Button>
          </TabsList>

          <TabsContent value="emojis">
            <EmojiPicker
              className="border-transparent! [&_.epr-category-nav]:hidden"
              height={350}
              onEmojiClick={(data) => onChange(data.emoji)}
              previewConfig={{ showPreview: false }}
              searchPlaceHolder="Filter..."
              theme={theme}
            />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
};

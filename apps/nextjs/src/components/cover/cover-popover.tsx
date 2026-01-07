'use client';

import React, { useState } from 'react';

import { toast } from 'sonner';
import { useFilePicker } from 'use-file-picker';

import { useTParams } from '@/hooks/use-navigation';
import { useUploadFile } from '@/registry/hooks/use-upload-file';
import { Button } from '@/registry/ui/button';
import { Input } from '@/registry/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/registry/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/registry/ui/tabs';
import { useUpdateDocumentMutation } from '@/trpc/hooks/document-hooks';

export const COVER_GRADIENTS = {
  aurora: 'bg-linear-to-br from-green-400 via-teal-500 to-blue-500',
  autumn: 'bg-linear-to-br from-yellow-400 via-orange-500 to-red-500',
  dusk: 'bg-linear-to-br from-purple-500 via-pink-500 to-red-500',
  lavender: 'bg-linear-to-br from-indigo-300 via-purple-300 to-pink-300',
  mint: 'bg-linear-to-br from-green-200 via-teal-300 to-blue-300',
  misty: 'bg-linear-to-br from-gray-300 via-blue-200 to-gray-100',
  ocean: 'bg-linear-to-br from-blue-400 via-teal-500 to-emerald-500',
  peach: 'bg-linear-to-br from-red-200 via-orange-200 to-yellow-200',
  sunset: 'bg-linear-to-br from-orange-400 via-pink-500 to-purple-500',
  twilight: 'bg-linear-to-br from-indigo-500 via-purple-500 to-pink-500',
};

export function CoverPopover({ children }: { children: React.ReactNode }) {
  const { documentId } = useTParams<'/[documentId]'>();
  const updateDocument = useUpdateDocumentMutation();
  const [open, setOpen] = useState(false);

  const onRemove = () => {
    updateDocument.mutate({
      id: documentId!,
      coverImage: '',
    });
  };

  const { isUploading, uploadFile } = useUploadFile({
    onUploadComplete: (file) => {
      updateDocument.mutate({
        id: documentId!,
        coverImage: file.url,
      });
      toast.success('Cover updated');
      setOpen(false);
    },
  });

  const { openFilePicker } = useFilePicker({
    readFilesContent: false,
    accept: ['image/*'],
    multiple: false,
    onFilesSelected: ({ plainFiles }) => {
      const file = plainFiles?.[0];
      if (!file) return;

      void uploadFile(file);
      toast.info('Starting to upload');
    },
  });

  const [embedValue, setEmbedValue] = useState('');

  return (
    <Popover modal={false} onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          className="font-medium text-muted-foreground"
          size="xs"
          variant="outline"
        >
          {children}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[540px]"
        onOpenAutoFocus={(e: React.FocusEvent) => e.preventDefault()}
      >
        <Tabs defaultValue="gallery">
          <TabsList onMouseDown={(e: React.MouseEvent) => e.preventDefault()}>
            <TabsTrigger value="gallery">Gallery</TabsTrigger>
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="link">Link</TabsTrigger>

            <Button className="ml-auto" onClick={onRemove} variant="ghost2">
              Remove
            </Button>
          </TabsList>

          <TabsContent
            className="my-3 space-y-3 px-2 text-center"
            value="gallery"
          >
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(COVER_GRADIENTS).map(([key, value]) => (
                <Button
                  className={`h-20 w-full ${value}`}
                  key={key}
                  onClick={() => {
                    updateDocument.mutate({
                      id: documentId!,
                      coverImage: key,
                    });
                    setOpen(false);
                  }}
                >
                  {key}
                </Button>
              ))}
            </div>
          </TabsContent>

          <TabsContent
            className="my-3 space-y-3 px-2 text-center"
            value="upload"
          >
            <Button
              className="w-full"
              disabled={isUploading}
              onClick={openFilePicker}
              size="md"
              variant="outline"
            >
              Upload file
            </Button>

            <div className="text-muted-foreground text-xs">
              Images wider than 1500 pixels work best
            </div>

            <div className="text-muted-foreground text-xs">
              The maximum size per file is 5MB
            </div>
          </TabsContent>

          <TabsContent className="my-3 space-y-3 px-2 text-center" value="link">
            <Input
              onChange={(e) => setEmbedValue(e.target.value)}
              placeholder="Paste an image link..."
              value={embedValue}
            />

            <Button
              className="mt-2 w-full max-w-[300px]"
              onClick={() => {
                updateDocument.mutate({
                  id: documentId!,
                  coverImage: embedValue,
                });
                setOpen(false);
              }}
              variant="brand"
            >
              Submit
            </Button>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

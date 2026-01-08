'use client';

import { useQuery } from '@tanstack/react-query';

import { Avatar, AvatarFallback, AvatarImage } from '@/registry/ui/avatar';
import { DialogContent, DialogTitle } from '@/registry/ui/dialog';
import { Input } from '@/registry/ui/input';
import { Spinner } from '@/registry/ui/spinner';
import { useTRPC } from '@/trpc/react';

import { Label } from '../ui/label';
import { DeleteAccountButton } from './delete-account-button';

export function SettingsModal() {
  const trpc = useTRPC();
  const { data: userSettings, isLoading } = useQuery(
    trpc.user.getSettings.queryOptions()
  );

  if (isLoading) {
    return <Spinner />;
  }

  return (
    <DialogContent className="px-16 py-9" size="4xl">
      <div className="space-y-8">
        <DialogTitle className="font-semibold text-2xl">My profile</DialogTitle>

        <div className="flex items-center space-x-4">
          <Avatar className="size-16">
            <AvatarImage
              alt="Profile"
              src={userSettings?.image || 'https://github.com/ziadbenameur.png'}
            />
            <AvatarFallback>
              {userSettings?.name?.slice(0, 2).toUpperCase() || 'ZB'}
            </AvatarFallback>
          </Avatar>
          <div className="space-y-2">
            <Label htmlFor="preferred-name">Display name</Label>
            <Input
              className="max-w-xs"
              defaultValue={userSettings?.name || ''}
              id="preferred-name"
              readOnly
            />
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="font-semibold text-xl">Account</h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Email</Label>
                <p className="text-muted-foreground text-sm">
                  {userSettings?.email}
                </p>
              </div>
              {/* <Button variant="outline">Change email</Button> */}
            </div>

            <DeleteAccountButton />
          </div>
        </div>
      </div>
    </DialogContent>
  );
}

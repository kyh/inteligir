import * as React from 'react';

import type { DeepNullable } from 'ts-essentials';

import { useCurrentUser } from '@/components/auth/useCurrentUser';
import { cn } from '@/lib/utils';
import { useMounted } from '@/registry/hooks/use-mounted';
import { Avatar, AvatarFallback, AvatarImage } from '@/registry/ui/avatar';

import { Skeleton } from './ui/skeleton';

export interface UserAvatarProps extends React.ComponentProps<typeof Avatar> {
  avatarClassName?: string;
  isCurrent?: boolean;
  loading?: boolean;
  user?: DeepNullable<{
    image?: string;
    username?: string;
  }>;
}

export function UserAvatar({
  avatarClassName,
  className,
  isCurrent,
  loading,
  size,
  user = {},
  variant,
  ...props
}: UserAvatarProps) {
  const currentUser = useCurrentUser();
  const mounted = useMounted();

  loading = loading || currentUser.isLoading || !mounted;

  if (isCurrent) {
    user = {
      ...currentUser,
      ...user,
    };
  }

  const src = user.image;

  const label = user.username ? `Avatar for ${user.username}` : 'Avatar';

  return (
    <Avatar
      className={avatarClassName}
      key={src}
      size={size}
      variant={variant}
      {...props}
    >
      {loading || !src ? (
        <AvatarFallback variant={variant}>
          <Skeleton className="size-full bg-muted" />
        </AvatarFallback>
      ) : (
        <AvatarImage
          alt={label}
          className={cn('', className)}
          draggable={false}
          referrerPolicy="no-referrer"
          src={src}
        />
      )}
    </Avatar>
  );
}

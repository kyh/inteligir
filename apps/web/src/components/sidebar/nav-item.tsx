"use client";

import { format } from "date-fns";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useCurrentUser } from "@/components/auth/useCurrentUser";
import { useTParams } from "@/hooks/use-navigation";
import { cn } from "@/lib/utils";
import { useMounted } from "@/registry/hooks/use-mounted";
import { Button } from "@/registry/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/registry/ui/dropdown-menu";
import { TooltipTC } from "@/registry/ui/tooltip";
import { useArchiveDocumentMutation } from "@/trpc/hooks/document-hooks";
import { api, useTRPC } from "@/trpc/react";
import { useAuthGuard } from "../auth/useAuthGuard";
import type { IconFC } from "../ui/icon";
import { Icons } from "../ui/icons";
import { Skeleton } from "../ui/skeleton";

type ItemProps = {
  id?: string;
  active?: boolean;
  children?: React.ReactNode;
  className?: string;
  documentIcon?: string | null;
  expanded?: boolean;
  href?: Route;
  icon?: IconFC;
  isSearch?: boolean;
  keyboardShortcut?: string;
  label?: string;
  level?: number;
  loading?: boolean;
  tooltip?: string;
  updatedAt?: Date;
  onClick?: () => void;
  onExpand?: () => void;
};

export function NavItem({
  id,
  active,
  children,
  className,
  documentIcon,
  expanded,
  href,
  icon: Icon,
  keyboardShortcut,
  label,
  level = 0,
  loading,
  tooltip,
  updatedAt,
  onClick,
  onExpand: onExpandProp,
}: ItemProps & React.ComponentProps<"div">) {
  const { slug } = useTParams<"/dashboard/[slug]">();
  const authGuard = useAuthGuard();

  const ChevronIcon = expanded ? Icons.chevronDown : Icons.chevronRight;

  const user = useCurrentUser();

  const router = useRouter();
  const mounted = useMounted();

  const trpc = useTRPC();
  const createDocument = api.document.create.useMutation({
    onSuccess: () => {
      void trpc.document.documents.invalidate();
    },
  });
  const archiveDocument = useArchiveDocumentMutation();

  const onArchive = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    e.stopPropagation();

    if (!id) return;

    const promise = archiveDocument.mutateAsync({ id });

    toast.promise(promise, {
      error: "Failed to archive note!",
      loading: "Moving to trash...",
      success: "Note moved to trash.",
    });
  };

  const onExpand = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.stopPropagation();
    onExpandProp?.();
  };

  const onCreate = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.stopPropagation();

    if (!id) return;

    const promise = createDocument.mutateAsync({ parentDocumentId: id }).then((document) => {
      if (!expanded) {
        onExpandProp?.();
      }

      router.push(`/dashboard/${slug}/${document.id}` as Route);
    });

    toast.promise(promise, {
      error: "Failed to create a new note!",
      loading: "Creating a new note...",
      success: "New Note created.",
    });
  };

  const content = (
    <div
      className={cn(
        "group relative flex min-h-[32px] cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[14px] font-medium tracking-tight text-sidebar-text transition-colors duration-200 hover:bg-sidebar-hover",
        active && "bg-primary/8 text-primary",
        level > 0 &&
          "before:absolute before:left-[14px] before:top-0 before:h-full before:w-px before:bg-border/40",
        className,
      )}
      onClick={onClick}
      role="button"
      style={{ paddingLeft: level > 0 ? `${(level + 1) * 12}px` : undefined }}
    >
      {loading ? (
        <>
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <Skeleton className="h-4 w-3/5" />
        </>
      ) : (
        <>
          {(documentIcon || Icon) && (
            <Button
              className="relative shrink-0 opacity-100"
              onClick={id ? onExpand : undefined}
              size="navAction"
              variant={id ? "navAction" : "none"}
            >
              {documentIcon ? (
                <div className="shrink-0 select-none text-[18px] transition-opacity duration-200 group-hover:opacity-0">
                  {documentIcon}
                </div>
              ) : (
                Icon && (
                  <Icon
                    className={cn(
                      "size-4 shrink-0 text-sidebar-text-muted transition-opacity duration-200",
                      !!id && "group-hover:opacity-0",
                    )}
                  />
                )
              )}
              {!!id && (
                <ChevronIcon className="absolute top-0.5 left-0.5 size-4 shrink-0 text-sidebar-text-muted opacity-40 transition-opacity duration-200 group-hover:opacity-100" />
              )}
            </Button>
          )}

          <span className="min-w-0 flex-1 select-none truncate">{label}</span>

          {keyboardShortcut && (
            <kbd className="ml-auto shrink-0 rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-sidebar-text-muted">
              {keyboardShortcut}
            </kbd>
          )}
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-x-1">
        {mounted && !!id && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  onClick={(e) => e.stopPropagation()}
                  size="navAction"
                  tooltip="Delete"
                  tooltipContentProps={{
                    side: "bottom",
                  }}
                  variant="navAction"
                >
                  <Icons.moreX variant="muted" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={(e) => authGuard(() => onArchive(e))}>
                    <Icons.trash />
                    Move to Trash
                  </DropdownMenuItem>
                </DropdownMenuGroup>

                {user.id && (
                  <div>
                    <DropdownMenuSeparator />
                    <div className="space-y-1 p-2 text-muted-foreground/90 text-xs">
                      <div>Last edited by {user?.name}</div>
                      <div>{updatedAt && format(new Date(updatedAt), "MMM d, yyyy, h:mm a")}</div>
                    </div>
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              onClick={(e) => authGuard(() => onCreate(e))}
              size="navAction"
              tooltip="Add a page inside"
              tooltipContentProps={{
                side: "bottom",
              }}
              variant="navAction"
            >
              <Icons.plus variant="muted" />
            </Button>
          </>
        )}

        {children}
      </div>
    </div>
  );

  const wrappedElement =
    mounted && href ? (
      <Link href={href} target={href.startsWith("http") ? "_blank" : ""}>
        {content}
      </Link>
    ) : (
      content
    );

  if (tooltip && mounted) {
    return (
      <TooltipTC content={tooltip} side="right">
        {wrappedElement}
      </TooltipTC>
    );
  }

  return wrappedElement;
}

export function NavItemSkeleton({ level }: { level?: number }) {
  return (
    <div
      className="flex min-h-[32px] items-center gap-2 px-2 py-1.5"
      style={{
        paddingLeft: level ? `${(level + 1) * 12}px` : undefined,
      }}
    >
      <Skeleton className="size-4 shrink-0" />
      <Skeleton className="h-4 w-[30%]" />
    </div>
  );
}

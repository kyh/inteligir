"use client";

import { useQuery } from "@tanstack/react-query";
import { ClockIcon, FileTextIcon } from "lucide-react";
import Link from "next/link";

import { useAuthUser } from "@/components/auth/useAuthUser";
import { useCurrentUser } from "@/components/auth/useCurrentUser";
import { templateList, type TemplateDocument } from "@/components/editor/utils/useTemplateDocument";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icons } from "@/components/ui/icons";
import { WithSkeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { useTParams } from "@/hooks/use-navigation";
import { useTRPC } from "@/trpc/react";

type Document = {
  id: string;
  title: string | null;
  icon: string | null;
  coverImage?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export function Home() {
  const { slug } = useTParams<"/dashboard/[slug]">();
  const user = useAuthUser();
  const trpc = useTRPC();
  const currentUser = useCurrentUser();

  const { data, isLoading } = useQuery({
    ...trpc.document.documents.queryOptions({
      parentDocumentId: undefined,
    }),
    enabled: !!user,
  });

  let documents: Document[] | undefined = data?.documents;

  if (!user) {
    documents = templateList.map((t: TemplateDocument) => ({
      id: t.id,
      title: t.title,
      icon: t.icon,
      coverImage: null,
    }));
  }
  if (isLoading && !documents) {
    documents = Array.from({ length: 9 }, (_, index) => ({
      id: index.toString(),
      coverImage: null,
      createdAt: new Date(),
      icon: null,
      title: "Loading...",
      updatedAt: new Date(),
    }));
  }
  if (!documents?.length) {
    return (
      <div className="flex h-[450px] items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-center">
          <Icons.document className="size-12 text-muted-foreground/80" />
          <p className="text-muted-foreground text-sm">No documents yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 sm:px-24">
      <h1 className="pt-4 pb-12 text-center font-semibold text-3xl">
        {user?.name ? (
          <>
            Hello, <span className="truncate">{user.name}</span>
          </>
        ) : (
          "Potion Template"
        )}
      </h1>

      <h2 className="mb-4 flex items-center gap-1 whitespace-nowrap font-medium text-muted-foreground text-xs max-sm:justify-center">
        <ClockIcon className="size-3 shrink-0" />
        Recently visited
      </h2>

      <div className="flex flex-wrap gap-4 max-sm:justify-center">
        {documents.map((doc) => (
          <WithSkeleton
            className="size-[144px]"
            isLoading={isLoading}
            key={doc.id}
          >
            <Link href={`/dashboard/${slug}/${doc.id}`}>
              <Card className="h-full overflow-hidden rounded-2xl transition-colors hover:bg-accent/50">
                <div
                  className="relative h-11 bg-muted"
                  style={
                    doc.coverImage
                      ? {
                          backgroundImage: `url(${doc.coverImage})`,
                          backgroundPosition: "center",
                          backgroundSize: "cover",
                        }
                      : undefined
                  }
                >
                  <div className="-bottom-3 absolute left-3">
                    {doc.icon ? (
                      <div className="text-xl">{doc.icon}</div>
                    ) : (
                      <FileTextIcon className="size-6 fill-background text-muted-foreground" />
                    )}
                  </div>
                </div>
                <CardHeader className="px-3">
                  <div className="flex items-center gap-2">
                    <CardTitle className="truncate text-sm">
                      {doc.title || "Untitled"}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="px-3">
                  <div className="flex items-center gap-1.5">
                    {user && currentUser && (
                      <UserAvatar
                        avatarClassName="size-4"
                        user={currentUser}
                      />
                    )}
                    {doc.updatedAt && (
                      <p className="truncate text-muted-foreground text-xs">
                        {new Date(doc.updatedAt).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          </WithSkeleton>
        ))}
      </div>
    </div>
  );
}

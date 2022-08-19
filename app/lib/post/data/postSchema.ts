import type {
  Post as PrismaPost,
  PostContent as PrismaPostContent,
} from "@prisma/client";

export type Post = Partial<PrismaPost> & {
  content: PostContent[];
  createdBy?: { photoURL: string; displayName: string };
  viewCount?: number | null;
  likeCount?: number | null;
  isLiked?: boolean | null;
  commentCount?: number | null;
  comments?: Post[];
  isFollowing?: boolean | null;
  hashtags?: string[];
};

export type PostContent = Partial<PrismaPostContent>;

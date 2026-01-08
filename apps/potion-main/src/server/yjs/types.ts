import type { DocumentModel } from 'generated/prisma/models';

export type CollabContext = {
  document?: CollabDocument;
  readOnly?: boolean;
  userId?: string;
};

export type CollabDocument = Pick<
  DocumentModel,
  | 'contentRich'
  | 'id'
  | 'isArchived'
  | 'isPublished'
  | 'lockPage'
  | 'userId'
  | 'yjsSnapshot'
>;

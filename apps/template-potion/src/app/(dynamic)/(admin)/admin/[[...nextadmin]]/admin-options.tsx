import type { NextAdminOptions } from '@premieroctet/next-admin';

export const adminOptions: NextAdminOptions = {
  externalLinks: [
    {
      label: 'Home',
      url: '/',
    },
  ],
  forceColorScheme: 'light',
  model: {
    Comment: {
      icon: 'ChatBubbleLeftIcon',
    },
    Discussion: {
      icon: 'ChatBubbleLeftRightIcon',
    },
    Document: {
      icon: 'DocumentTextIcon',
      toString: (item) => item.title ?? item.id,
    },
    DocumentVersion: {
      icon: 'DocumentDuplicateIcon',
    },
    File: {
      icon: 'PaperClipIcon',
    },
    OauthAccount: {
      icon: 'KeyIcon',
    },
    Session: {
      icon: 'ClockIcon',
    },
    User: {
      icon: 'UsersIcon',
      list: {
        filters: [
          {
            active: false,
            name: 'is Super Admin',
            value: {
              role: {
                equals: 'SUPERADMIN',
              },
            },
          },
        ],
      },
      title: 'Users',
      toString: (user) => `${user.username} (${user.email})`,
    },
  },
  sidebar: {
    groups: [
      {
        models: ['User', 'OauthAccount', 'Session'],
        title: 'Users',
      },
      {
        models: [
          'Document',
          'File',
          'Discussion',
          'Comment',
          'DocumentVersion',
        ],
        title: 'Documents',
      },
    ],
  },
};

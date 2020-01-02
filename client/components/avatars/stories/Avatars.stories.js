import React from 'react';
import { Avatar, Box } from '@components';
import { withContainer } from '@storyUtils';

export default {
  title: 'Components|Data Display/Avatars',
  component: Avatar,
  decorators: [withContainer],
};

export const variants = () => (
  <>
    <Box mr={2}>
      <Avatar
        alt="Kaiyu Hsu"
        src="https://pbs.twimg.com/profile_images/772149934854320128/vGdhcORV_400x400.jpg"
      />
    </Box>
    <Box mr={2}>
      <Avatar>KH</Avatar>
    </Box>
  </>
);

export const base = () => (
  <Avatar
    alt="Kaiyu Hsu"
    src="https://pbs.twimg.com/profile_images/772149934854320128/vGdhcORV_400x400.jpg"
  />
);

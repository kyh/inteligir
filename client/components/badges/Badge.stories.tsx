import React from 'react';
import MailIcon from '@material-ui/icons/Mail';
import { Badge, IconButton, Box } from '@components';
import { withContainer } from '@storyUtils';

export default {
  title: 'Components|Data Display/Badges',
  component: Badge,
  decorators: [withContainer],
};

export const base = () => (
  <Badge badgeContent={4} color="primary">
    <MailIcon />
  </Badge>
);

export const withButton = () => (
  <IconButton aria-label="4 pending messages">
    <Badge badgeContent={4} color="primary">
      <MailIcon />
    </Badge>
  </IconButton>
);

export const variants = () => (
  <>
    <Box display="flex" justifyContent="space-around">
      <Box mr={5}>
        <Badge badgeContent={4} color="primary">
          <MailIcon />
        </Badge>
      </Box>
      <Box mr={5}>
        <Badge badgeContent={10} color="secondary">
          <MailIcon />
        </Badge>
      </Box>
      <Box mr={5}>
        <Badge color="primary" variant="dot">
          <MailIcon />
        </Badge>
      </Box>
      <Badge color="secondary" variant="dot">
        <MailIcon />
      </Badge>
    </Box>
  </>
);

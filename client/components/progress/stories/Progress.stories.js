import React from 'react';
import { Loading, Progress, Box } from '@components';

export default {
  title: 'Components|Feedback|Progress',
};

export const LoadingComponents = () => (
  <Box>
    <Box mb={3}>
      <Progress />
    </Box>
    <Box display="flex" justify="center">
      <Loading />
    </Box>
  </Box>
);

import React from 'react'
import { Avatar, Box } from '@components'
import { withContainer } from '@storyUtils'

export default {
  title: 'Components|Data Display/Avatars',
  component: Avatar,
  decorators: [withContainer],
}

export const base = () => (
  <Avatar
    alt="Kaiyu Hsu"
    src="https://pbs.twimg.com/profile_images/772149934854320128/vGdhcORV_400x400.jpg"
  />
)

export const variants = () => (
  <>
    <Box mb={2}>
      <Avatar
        alt="Kaiyu Hsu"
        src="https://pbs.twimg.com/profile_images/772149934854320128/vGdhcORV_400x400.jpg"
      />
    </Box>
    <Box>
      <Avatar>KH</Avatar>
    </Box>
  </>
)

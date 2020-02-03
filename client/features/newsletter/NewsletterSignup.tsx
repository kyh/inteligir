import React from 'react'
import { makeStyles } from '@material-ui/core/styles'

import { Box, Header, Text, Button } from '@components'

const useStyles = makeStyles((theme) => ({
  newsletter: {
    textAlign: 'center',
    padding: `${theme.spacing(10)}px ${theme.spacing(3)}px`,
    backgroundColor: theme.brand.background,
  },
  highlight: {
    fontStyle: 'italic',
  },
}))

function NewsletterSignup() {
  const classes = useStyles()

  return (
    <Box className={classes.newsletter}>
      <Box mb={2}>
        <Header>Discover the best and brightest playlists on Inteligir.</Header>
        <Text>
          Sign up to receive our weekly{' '}
          <span className={classes.highlight}>Playlists We Love</span>{' '}
          newsletter.
        </Text>
      </Box>
      <Button variant="outlined" color="primary">
        Subscribe
      </Button>
    </Box>
  )
}

export default NewsletterSignup

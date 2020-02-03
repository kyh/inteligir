import React from 'react'
import { makeStyles } from '@material-ui/core/styles'

import { Box, Header, Text } from '@components'

const useStyles = makeStyles((theme) => ({
  hero: {
    backgroundColor: (props) => props.backgroundColor,
    backgroundImage: (props) => `url("${props.backgroundImage}")`,
    padding: '8% 50% 8% 8%',
    borderRadius: theme.spacing(2),
    backgroundSize: '600px',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: '100%',
  },
}))

function HeroSection({ title, description, renderCta, ...props }) {
  const classes = useStyles(props)

  return (
    <Box component="section" className={classes.hero} mx={2} mt={2} mb={3}>
      <Box mb={4}>
        <Header variant="h2">The best of the web in playlists.</Header>
        <Text>
          Almost all the knowledge is already available on the web. All you need
          is someone to guide you to it.
        </Text>
      </Box>
      {renderCta()}
    </Box>
  )
}

export default HeroSection

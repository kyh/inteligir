import React from 'react'
import { makeStyles } from '@material-ui/core/styles'

import PlaylistCard from './PlaylistCard'
import { Box, Grid, Header } from '@components'

const useStyles = makeStyles(() => ({
  playlistCollection: {},
}))

const PlaylistCollection = ({ collectionTitle = '', playlists }: any) => {
  const classes = useStyles()

  return (
    <Box component="section">
      <Box mb={2}>
        <Header variant="overline">{collectionTitle}</Header>
      </Box>
      <Grid className={classes.playlistCollection} container spacing={3}>
        {playlists.map((playlist: any) => (
          <Grid key={playlist.title} item>
            <PlaylistCard playlist={playlist} height={300} width={200} />
          </Grid>
        ))}
      </Grid>
    </Box>
  )
}

export default PlaylistCollection

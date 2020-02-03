import React from 'react'
import { makeStyles } from '@material-ui/core/styles'

import { Card, CardContent, Header } from '@components'

const useStyles = makeStyles(() => ({
  playlist: {
    display: 'flex',
    width: (props) => props.width || 'auto',
    height: (props) => props.height || 'auto',
  },
  playlistContent: {
    display: 'flex',
  },
  playlistTitle: {
    marginTop: 'auto',
    marginBottom: 0,
  },
}))

function PlaylistCard({ playlist, ...props }) {
  const classes = useStyles(props)

  return (
    <Card className={classes.playlist}>
      <CardContent className={classes.playlistContent}>
        <Header className={classes.playlistTitle}>{playlist.title}</Header>
      </CardContent>
    </Card>
  )
}

export default PlaylistCard

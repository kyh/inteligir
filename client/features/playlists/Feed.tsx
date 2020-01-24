import React from 'react'
import { usePlaylistsQuery } from './playlists.graphql'

export const Feed = () => {
  const { data } = usePlaylistsQuery()
  console.log(data)
  return <section>Feed</section>
}

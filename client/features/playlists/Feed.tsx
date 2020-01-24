import React from 'react'
import { useNewsQuery } from './playlists.graphql'

export const Feed = () => {
  const { data } = useNewsQuery()
  console.log(data)
  return <section>Feed</section>
}

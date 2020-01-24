import React from 'react'
import { withApollo } from '@utils/apollo'
import { Feed } from '@features/playlists/Feed'

const Home = () => {
  return (
    <main>
      <Feed />
      Hello world
    </main>
  )
}

export default withApollo(Home)

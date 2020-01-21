import React from 'react'
import { withApollo } from '@utils/apollo'

function Home() {
  return <main>Hello world</main>
}

export default withApollo(Home)

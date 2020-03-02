import { withApollo } from '@utils/with-apollo'
import Link from 'next/link'
import { useCurrentUserQuery } from '@features/auth/auth.graphql'

const Index = () => {
  const { data } = useCurrentUserQuery()

  if (data) {
    return (
      <div>
        You're signed in as {data?.me?.email}
        <Link href="/about">
          <a>static</a>
        </Link>{' '}
        page.
      </div>
    )
  }

  return <div>...</div>
}

export default withApollo(Index)

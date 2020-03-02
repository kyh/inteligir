import React from 'react'
import NProgress from 'nprogress'
import Router from 'next/router'
import { useApolloClient } from '@apollo/react-hooks'
import { makeStyles } from '@material-ui/core/styles'
import { KeyboardArrowDown } from '@material-ui/icons'

import {
  useCurrentUserQuery,
  useLogoutMutation,
} from '@features/auth/auth.graphql'

import PlaylistSearchInput from '@features/playlists/PlaylistSearchInput'
import { Logo, Link } from '@components'

Router.onRouteChangeStart = () => {
  NProgress.start()
}
Router.onRouteChangeComplete = () => {
  NProgress.done()
}

Router.onRouteChangeError = () => {
  NProgress.done()
}

const useStyles = makeStyles((theme) => ({
  container: {
    padding: `0 ${theme.spacing(3)}px`,
  },
  nav: {
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    height: theme.spacing(9),
    maxWidth: theme.brand.maxWidth,
    margin: '0 auto',
    '& > .nav-section': {
      display: 'flex',
    },
    '& > .left': {
      width: '50%',
      justifyContent: 'flex-start',
    },
    '& > .right': {
      width: '50%',
      justifyContent: 'flex-end',
    },
    '& a, & button': {
      fontWeight: 700,
      marginRight: theme.spacing(3),
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      color: theme.palette.secondary.light,
      '&:hover': {
        color: theme.palette.secondary.dark,
      },
      '&:last-child': {
        marginRight: 0,
      },
    },
  },
}))

function Navigation() {
  const classes = useStyles()
  const client = useApolloClient()
  const [logout] = useLogoutMutation()
  const { loading, error, data } = useCurrentUserQuery()

  const handleLogout = () => {
    logout().then(() => client.resetStore())
  }

  if (loading || error) return null

  return (
    <section className={classes.container}>
      <nav className={classes.nav}>
        <div className="nav-section left">
          <Link href="/playlists">
            Browse
            <KeyboardArrowDown />
          </Link>
          <PlaylistSearchInput />
        </div>
        <div className="nav-section center">
          <Link href="/">
            <Logo />
          </Link>
        </div>
        <div className="nav-section right">
          {data.me ? (
            <Link href="/" onClick={handleLogout}>
              Logout
            </Link>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup">Request an invite</Link>
            </>
          )}
        </div>
      </nav>
    </section>
  )
}

export default Navigation

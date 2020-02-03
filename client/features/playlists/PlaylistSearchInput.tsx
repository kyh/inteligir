import React, { useState } from 'react'
import { makeStyles } from '@material-ui/core/styles'
import { Search } from '@material-ui/icons'

import { InputBase, InputAdornment } from '@components'

const useStyles = makeStyles((theme) => ({
  searchInput: {
    fontSize: '16px',
    background: '#f0f1f2',
    height: '45px',
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(1),
    borderRadius: '4px',
    alignSelf: 'center',
  },
}))

function PlaylistSearchInput() {
  const classes = useStyles()
  const [values, setValues] = useState({
    search: '',
  })

  const handleSearchChange = (prop: string) => (event: any) => {
    setValues({ ...values, [prop]: event.target.value })
  }

  return (
    <InputBase
      className={classes.searchInput}
      id="search"
      type="text"
      placeholder="Search..."
      value={values.search}
      onChange={handleSearchChange('search')}
      endAdornment={
        <InputAdornment position="end">
          <Search color="action" />
        </InputAdornment>
      }
    />
  )
}

export default PlaylistSearchInput

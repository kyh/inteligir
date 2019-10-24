import React from 'react';
import { withStyles } from '@material-ui/core/styles';
import { Search } from '@material-ui/icons';

import { InputBase, InputAdornment } from '@components';

const styles = (theme) => ({
  searchInput: {
    fontSize: '16px',
    background: '#f0f1f2',
    height: '45px',
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(1),
    borderRadius: '4px',
    alignSelf: 'center',
  },
});

function CourseSearchInput({ classes }) {
  const [values, setValues] = React.useState({
    search: '',
  });

  const handleSearchChange = (prop) => (event) => {
    setValues({ ...values, [prop]: event.target.value });
  };

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
  );
}

export default withStyles(styles)(CourseSearchInput);

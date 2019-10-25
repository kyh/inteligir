import React, { useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import SwipeableViews from 'react-swipeable-views';

import { Grid, Header, Tabs, Tab, List, ListItem } from '@components';

import PlaylistCard from './PlaylistCard';

const useStyles = makeStyles(() => ({
  featuredSection: {},
  tabsSection: {},
}));

function FeaturedPlaylistCollection({ featuredPlaylist, tabs }) {
  const classes = useStyles();
  const [currentTabIndex, setTabIndex] = useState(0);

  const handleTabChange = (event, index) => {
    if (typeof event === 'number') return setTabIndex(event);
    return setTabIndex(index);
  };

  const renderPlaylists = (playlist) => {
    return (
      <ListItem
        button
        primaryText={playlist.title}
        secondaryText="Secondary text"
      />
    );
  };

  return (
    <Grid container spacing={3}>
      <Grid className={classes.featuredSection} xs={6} item>
        <Header variant="overline">Featured Playlist</Header>
        <PlaylistCard playlist={featuredPlaylist} height={400} />
      </Grid>
      <Grid className={classes.tabsSection} xs={6} item>
        <Tabs
          value={currentTabIndex}
          onChange={handleTabChange}
          variant="fullWidth"
        >
          {tabs.map((tab) => (
            <Tab label={tab.title} />
          ))}
        </Tabs>
        <SwipeableViews index={currentTabIndex} onChangeIndex={handleTabChange}>
          {tabs.map((tab) => (
            <List dense>{tab.playlists.map(renderPlaylists)}</List>
          ))}
        </SwipeableViews>
      </Grid>
    </Grid>
  );
}

export default FeaturedPlaylistCollection;

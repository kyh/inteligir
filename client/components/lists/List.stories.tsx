import React from 'react';
import { List, ListItem } from '@components';
import FolderIcon from '@material-ui/icons/Folder';

export default {
  title: 'Components|Data Display|List',
};

export const ListComponent = () => (
  <List dense>
    <ListItem
      button
      icon={<FolderIcon />}
      primaryText="Single-line item"
      secondaryText="Secondary text"
    />
    <ListItem
      button
      icon={<FolderIcon />}
      primaryText="Single-line item2"
      secondaryText="Secondary text2"
    />
    <ListItem
      button
      icon={<FolderIcon />}
      primaryText="Single-line item3"
      secondaryText="Secondary text3"
    />
  </List>
);

ListComponent.story = {
  name: 'List component',
};

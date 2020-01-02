import React from 'react';
import { Divider, List, ListItem } from '@components';

export default {
  title: 'Components|Divider',
};

export const DividerComponent = () => (
  <List component="nav">
    <ListItem button primaryText="Inbox" />
    <Divider />
    <ListItem button divider primaryText="Drafts" />
    <ListItem button primaryText="Trash" />
    <Divider light />
    <ListItem button primaryText="Spam" />
  </List>
);

DividerComponent.story = {
  name: 'Divider component',
};

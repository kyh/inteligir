import { State, Store } from '@sambego/storybook-state';
import React from 'react';
import { PopupDialog, AlertDialog, Dialog, List, ListItem, Button } from '@components';

const emails = ['username@gmail.com', 'user02@gmail.com'];

const store = new Store({
  open: false,
});

export default {
  title: 'Components|Data Display|Dialog',
};

export const BasicPopupDialog = () => (
  <State store={store}>
    <Button variant="outlined" color="primary" onClick={() => store.set({ open: true })}>
      Open popup dialog
    </Button>
    <PopupDialog onClose={() => store.set({ open: false })} title="Select account">
      <List>
        {emails.map(email => (
          <ListItem
            button
            primaryText={email}
            onClick={() => store.set({ open: false })}
            key={email}
          />
        ))}
        <ListItem
          button
          primaryText="Add new account"
          onClick={() => store.set({ open: false })}
          key="add-account"
        />
      </List>
    </PopupDialog>
  </State>
);

export const LargeDialog = () => (
  <State store={store}>
    <Button variant="outlined" color="primary" onClick={() => store.set({ open: true })}>
      Open Large dialog
    </Button>
    <Dialog onClose={() => store.set({ open: false })} title="Select account">
      <List>
        {emails.map(email => (
          <ListItem
            button
            primaryText={email}
            onClick={() => store.set({ open: false })}
            key={email}
          />
        ))}
        <ListItem
          button
          primaryText="Add new account"
          onClick={() => store.set({ open: false })}
          key="add-account"
        />
      </List>
    </Dialog>
  </State>
);

export const AlertConfirmationDialog = () => (
  <State store={store}>
    <Button variant="outlined" color="primary" onClick={() => store.set({ open: true })}>
      Open confirmation dialog
    </Button>
    <AlertDialog
      onClose={() => store.set({ open: false })}
      title="Use Google's location service?"
      content="Let Google help apps determine location. This means sending anonymous
          location data to Google, even when no apps are running."
    />
  </State>
);

AlertConfirmationDialog.story = {
  name: 'Alert/Confirmation Dialog',
};

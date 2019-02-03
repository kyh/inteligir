import React from 'react';
import { storiesOf } from '@storybook/react';
import Icon from 'react-icons-kit';
import { logIn } from 'react-icons-kit/feather/logIn';
import { logOut } from 'react-icons-kit/feather/logOut';
import { calendar } from 'react-icons-kit/feather/calendar';
import { InputGroup, Input, Label, InputField, Text } from '../index';

storiesOf('InputGroup', module)
  .add('default', () => (
    <div>
      <Label>Name</Label>
      <InputGroup>
        <Input placeholder="First" />
        <Input placeholder="Last" />
      </InputGroup>
    </div>
  ))
  .add('date input', () => (
    <InputGroup>
      <InputField>
        <Label>Entrance</Label>
        <Icon icon={logIn} color="blue" />
        <Input placeholder="Where from?" />
      </InputField>
      <Text color="gray">–</Text>
      <InputField>
        <Label>Exit</Label>
        <Icon icon={logOut} color="blue" />
        <Input placeholder="Where to?" />
      </InputField>
    </InputGroup>
  ))
  .add('date input alternative', () => (
    <InputGroup>
      <Icon icon={calendar} color="blue" ml={2} />
      <InputField>
        <Label>Where from?</Label>
        <Input placeholder="Where from?" />
      </InputField>
      <Text color="gray">–</Text>
      <InputField>
        <Label>Where to?</Label>
        <Input placeholder="Where to?" />
      </InputField>
    </InputGroup>
  ));

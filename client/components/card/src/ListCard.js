import React from 'react';
import { List } from '@client/components';
import Card from './Card';

const ListCard = (props) => {
  return (
    <Card>
      <Card.Header borderBottom="1px solid" px={4} py={3} fontSize={1} mb={2}>
        {props.title}
      </Card.Header>
      <List fontSize={1}>{props.children}</List>
    </Card>
  );
};

export default ListCard;

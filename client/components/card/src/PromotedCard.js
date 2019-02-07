import React from 'react';
import styled from 'styled-components';
import { Flex } from '@client/components';
import Card from './Card';

const StyledCard = styled(Card)`
  height: 100%;
`;

const PromotedCard = (props) => {
  return (
    <StyledCard>
      <Flex>Promoted</Flex>
    </StyledCard>
  );
};

export default PromotedCard;

import React from 'react';
import styled from 'styled-components';
import theme from '@client/utils/theme';
import Icon from 'react-icons-kit';
import Button from './Button';

const TransparentButton = styled(Button)`
  padding: 0;
  background-color: transparent;
  color: inherit;

  &:hover {
    background-color: transparent;
  }
  & > div {
    display: flex;
  }
`;

const IconButton = ({ icon, size, color, ...props }) => (
  <TransparentButton {...props}>
    <div>
      <Icon icon={icon} size={size} color={color} />
    </div>
  </TransparentButton>
);

IconButton.displayName = 'IconButton';

IconButton.defaultProps = {
  theme,
};

export default IconButton;

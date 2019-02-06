import styled from 'styled-components';
import defaultTheme from '@client/utils/theme';
import Button from './Button';

const RedButton = styled(Button)`
  background-color: ${(props) => props.theme.colors.red};

  &:hover {
    background-color: ${(props) =>
      props.disabled ? null : props.theme.colors.darkRed};
  }
`;

RedButton.defaultProps = {
  theme: defaultTheme,
};

export default RedButton;

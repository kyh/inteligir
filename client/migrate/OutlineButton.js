import styled from 'styled-components';
import defaultTheme from '@client/utils/theme';
import Button from './Button';

const OutlineButton = styled(Button)`
  color: ${(props) => props.theme.colors.blue};
  box-shadow: inset 0 0 0 2px ${(props) => props.theme.colors.blue};
  background-color: transparent;

  &:hover {
    color: ${(props) => (props.disabled ? null : props.theme.colors.darkBlue)};
    box-shadow: inset 0 0 0 2px
      ${(props) => (props.disabled ? null : props.theme.colors.darkBlue)};
    background-color: transparent;
  }
`;

OutlineButton.defaultProps = {
  theme: defaultTheme,
};

OutlineButton.displayName = 'OutlineButton';

export default OutlineButton;

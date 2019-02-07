import styled from 'styled-components';
import defaultTheme from '@client/utils/theme';
import Button from './Button';

const GreenButton = styled(Button)`
  background-color: ${(props) => props.theme.colors.green};

  &:hover {
    background-color: ${(props) =>
      props.disabled ? null : props.theme.colors.darkGreen};
  }
`;

GreenButton.defaultProps = {
  theme: defaultTheme,
};

export default GreenButton;

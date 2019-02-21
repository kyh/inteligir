import styled from 'styled-components';
import { themeGet, width } from 'styled-system';
import defaultTheme from '@client/utils/theme';

const Image = styled.img`
  display: block;
  max-width: 100%;
  height: auto;
`;

Image.displayName = 'Image';

Image.defaultProps = {
  theme: defaultTheme,
};

const image = (props) =>
  props.src ? { backgroundImage: `url(${props.src})` } : null;

const height = (props) => (props.height ? { height: props.height } : null);

Image.Background = styled.div`
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  background-color: ${themeGet('colors.gray')};
  ${image} ${height} ${width};
`;

export default Image;

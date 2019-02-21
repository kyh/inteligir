import styled from 'styled-components';
import {
  textStyle,
  fontSize,
  fontWeight,
  textAlign,
  space,
  color,
  themeGet,
} from 'styled-system';
import defaultTheme from '@client/utils/theme';

const List = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  ${textStyle}
  ${fontSize}
  ${fontWeight}
  ${textAlign}
  ${space}
  ${color}
`;

List.displayName = 'List';

List.propTypes = {
  ...textStyle.propTypes,
  ...fontSize.propTypes,
  ...fontWeight.propTypes,
  ...textAlign.propTypes,
  ...space.propTypes,
  ...color.propTypes,
};

List.defaultProps = {
  theme: defaultTheme,
};

List.ol = List.withComponent('ol');

List.Item = styled.li`
  padding-top: ${themeGet('space.2')}px;
  padding-bottom: ${themeGet('space.2')}px;
  padding-left: ${themeGet('space.4')}px;
  padding-right: ${themeGet('space.4')}px;
`;

export default List;

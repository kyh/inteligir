import styled from 'styled-components';
import {
  textStyle,
  fontSize,
  fontWeight,
  textAlign,
  space,
  color,
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
  padding: ${({ theme }) => theme.space[2]}px ${({ theme }) => theme.space[4]}px;
`;

export default List;

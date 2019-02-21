import styled from 'styled-components';
import {
  space,
  width,
  color,
  alignItems,
  justifyContent,
  flexWrap,
  flexDirection,
} from 'styled-system';
import defaultTheme from '@client/utils/theme';

const Flex = styled.div`
  display: flex;
  ${space} ${width} ${color} ${alignItems} ${justifyContent}
  ${flexDirection}
  ${flexWrap}
`;

Flex.displayName = 'Flex';

Flex.propTypes = {
  ...space.propTypes,
  ...width.propTypes,
  ...color.propTypes,
  ...alignItems.propTypes,
  ...justifyContent.propTypes,
  ...flexWrap.propTypes,
  ...flexDirection.propTypes,
};

Flex.defaultProps = {
  theme: defaultTheme,
};

export default Flex;

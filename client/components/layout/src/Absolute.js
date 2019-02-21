import styled from 'styled-components';
import { top, right, bottom, left, zIndex } from 'styled-system';
import { Box } from '@client/components';

const Absolute = styled(Box)`
  position: absolute;
  ${top} ${bottom} ${left} ${right}
  ${zIndex}
`;

Absolute.displayName = 'Absolute';

Absolute.propTypes = {
  ...top.propTypes,
  ...right.propTypes,
  ...bottom.propTypes,
  ...left.propTypes,
  ...zIndex.propTypes,
};

export default Absolute;

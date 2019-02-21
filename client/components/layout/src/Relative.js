import styled from 'styled-components';
import { top, right, bottom, left, zIndex } from 'styled-system';
import { Box } from '@client/components';

const Relative = styled(Box)`
  position: relative;
  ${top} ${bottom} ${left} ${right}
  ${zIndex}
`;

Relative.displayName = 'Relative';

Relative.propTypes = {
  ...top.propTypes,
  ...right.propTypes,
  ...bottom.propTypes,
  ...left.propTypes,
  ...zIndex.propTypes,
};

export default Relative;

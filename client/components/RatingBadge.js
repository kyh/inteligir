import styled from 'styled-components';
import { fontWeight, borderRadius } from 'styled-system';
import theme from '@client/utils/theme';
import Box from './Box';

const RatingBadge = styled(Box)`
  display: inline-block;
  line-height: 1.5;
  ${fontWeight} ${borderRadius};
`;

RatingBadge.defaultProps = {
  fontWeight: 'bold',
  px: 2,
  color: 'white',
  bg: 'orange',
  borderRadius: 1,
  theme,
};

RatingBadge.propTypes = {
  ...fontWeight.propTypes,
  ...borderRadius.propTypes,
};

export default RatingBadge;

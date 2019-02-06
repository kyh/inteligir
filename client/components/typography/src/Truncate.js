import styled from 'styled-components';
import theme from '@client/utils/theme';
import Text from './Text';

const Truncate = styled(Text)`
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

Truncate.defaultProps = {
  theme,
};

Truncate.displayName = 'Truncate';

export default Truncate;

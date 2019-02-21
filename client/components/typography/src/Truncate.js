import styled from 'styled-components';
import defaultTheme from '@client/utils/theme';
import Text from './Text';

const Truncate = styled(Text)`
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

Truncate.displayName = 'Truncate';

Truncate.defaultProps = {
  theme: defaultTheme,
};

export default Truncate;

import styled from 'styled-components';
import { space } from 'styled-system';
import Link from './Link';

const BlockLink = styled(Link)`
  display: block;
  color: inherit;
  text-decoration: none;
  border: none;
  ${space}
  transition: opacity 0.2s ease;

  &:hover {
    opacity: 0.8;
  }
`;

BlockLink.displayName = 'BlockLink';

export default BlockLink;

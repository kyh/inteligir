import styled from 'styled-components';
import PropTypes from 'prop-types';
import { space } from 'styled-system';
import defaultTheme from '@client/utils/theme';

const maxWidth = (props) =>
  props.maxWidth
    ? { maxWidth: `${props.maxWidth}px` }
    : { maxWidth: props.theme.maxContainerWidth };

const Container = styled.div`
  margin-left: auto;
  margin-right: auto;
  ${maxWidth};
  ${space};
`;

Container.propTypes = {
  maxWidth: PropTypes.number,
};

Container.defaultProps = {
  theme: defaultTheme,
  ...space.propTypes,
};

Container.displayName = 'Container';

export default Container;

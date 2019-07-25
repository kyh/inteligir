import React from 'react';
import { Query } from 'react-apollo';
import gql from 'graphql-tag';
import PropTypes from 'prop-types';
import { perPage } from '@client/utils/constants';

const GET_LISTS = gql`
  query GET_LISTS($skip: Int = 0, $first: Int = ${perPage}) {
    lists(first: $first, skip: $skip, orderBy: createdAt_ASC) {
      id
      title
      description
      imageUrl
    }
  }
`;

const Feed = ({ currentPage, children, ...rest }) => (
  <Query
    query={GET_LISTS}
    variables={{
      skip: currentPage * perPage - perPage,
    }}
    {...rest}
  >
    {(result, params) => children(result, params)}
  </Query>
);

Feed.propTypes = {
  currentPage: PropTypes.number.isRequired,
  children: PropTypes.func.isRequired,
};

export default Feed;
export { GET_LISTS };

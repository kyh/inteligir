import React from 'react';
import { Query } from 'react-apollo';
import gql from 'graphql-tag';
import PropTypes from 'prop-types';
import { perPage } from '@client/utils/constants';

const GET_COURSES = gql`
  query GET_COURSES($skip: Int = 0, $first: Int = ${perPage}) {
    courses(first: $first, skip: $skip, orderBy: createdAt_ASC) {
      id
      title
      description
      thumbnail
    }
  }
`;

const GetCourses = ({ currentPage, children, ...rest }) => (
  <Query
    query={GET_COURSES}
    variables={{
      skip: currentPage * perPage - perPage,
    }}
    {...rest}
  >
    {(result, params) => children(result, params)}
  </Query>
);

GetCourses.propTypes = {
  currentPage: PropTypes.number.isRequired,
  children: PropTypes.func.isRequired,
};

export default GetCourses;
export { GET_COURSES };

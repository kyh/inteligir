import React from 'react';
import { Query } from 'react-apollo';
import gql from 'graphql-tag';
import PropTypes from 'prop-types';

const GET_COURSES = gql`
  query GET_COURSES() {
    courses() {
      id
      title
      description
      thumbnail
    }
  }
`;

const GetCourses = ({ children, ...rest }) => (
  <Query query={GET_COURSES} {...rest}>
    {(result, params) => children(result, params)}
  </Query>
);

GetCourses.propTypes = {
  currentPage: PropTypes.number.isRequired,
  children: PropTypes.func.isRequired,
};

export default GetCourses;
export { GET_COURSES };

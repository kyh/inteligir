import React from 'react';
import PropTypes from 'prop-types';
import gql from 'graphql-tag';
import { Query } from 'react-apollo';

const GET_COURSE = gql`
  query Course($id: ID!) {
    course(where: { id: $id }) {
      id
      description
    }
  }
`;

const GetCourse = ({ courseId, children, ...rest }) => (
  <Query query={GET_COURSE} variables={{ id: courseId }} {...rest}>
    {(result, params) => children(result, params)}
  </Query>
);

GetCourse.propTypes = {
  courseId: PropTypes.number.isRequired,
  children: PropTypes.func.isRequired,
};

export default GetCourse;
export { GET_COURSE };

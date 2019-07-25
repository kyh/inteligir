import React from 'react';
import PropTypes from 'prop-types';
import gql from 'graphql-tag';
import { Mutation } from 'react-apollo';

const CREATE_COURSE = gql`
  mutation CreateCourse($content: String!) {
    createCourse(content: $content) {
      id
      content
    }
  }
`;

function CreateCourse({ children, ...rest }) {
  return (
    <Mutation mutation={CREATE_COURSE} {...rest}>
      {(result, params) => children(result, params)}
    </Mutation>
  );
}

CreateCourse.propTypes = {
  children: PropTypes.func.isRequired,
};

export default CreateCourse;
export { CREATE_COURSE };

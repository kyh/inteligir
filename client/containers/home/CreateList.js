import React from 'react';
import PropTypes from 'prop-types';
import gql from 'graphql-tag';
import { Mutation } from 'react-apollo';

const CREATE_LIST = gql`
  mutation CreateList($content: String!) {
    createList(content: $content) {
      id
      content
    }
  }
`;

function CreateList({ children, ...rest }) {
  return (
    <Mutation mutation={CREATE_LIST} {...rest}>
      {(result, params) => children(result, params)}
    </Mutation>
  );
}

CreateList.propTypes = {
  children: PropTypes.func.isRequired,
};

export default CreateList;
export { CREATE_LIST };

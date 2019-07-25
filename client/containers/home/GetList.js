import React from 'react';
import PropTypes from 'prop-types';
import gql from 'graphql-tag';
import { Query } from 'react-apollo';

const GET_LIST = gql`
  query List($id: ID!) {
    list(where: { id: $id }) {
      id
      description
    }
  }
`;

const GetList = ({ listId, children, ...rest }) => (
  <Query query={GET_LIST} variables={{ id: listId }} {...rest}>
    {(result, params) => children(result, params)}
  </Query>
);

GetList.propTypes = {
  listId: PropTypes.number.isRequired,
  children: PropTypes.func.isRequired,
};

export default GetList;
export { GET_LIST };

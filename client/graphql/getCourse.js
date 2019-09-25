import gql from 'graphql-tag';

const GET_COURSE = gql`
  query Course($id: ID!) {
    course(where: { id: $id }) {
      id
      description
    }
  }
`;

export default GET_COURSE;

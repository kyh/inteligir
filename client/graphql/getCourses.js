import gql from 'graphql-tag';

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

export default GET_COURSES;

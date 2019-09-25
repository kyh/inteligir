import gql from 'graphql-tag';

const CREATE_COURSE = gql`
  mutation CreateCourse($content: String!) {
    createCourse(content: $content) {
      id
      content
    }
  }
`;

export default CREATE_COURSE;

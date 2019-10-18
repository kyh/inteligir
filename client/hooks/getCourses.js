import { useQuery } from '@apollo/react-hooks';
import gql from 'graphql-tag';

export const GET_COURSES = gql`
  query GET_COURSES {
    courses {
      id
      description
    }
  }
`;

export function useGetCourses() {
  return useQuery(GET_COURSES);
}

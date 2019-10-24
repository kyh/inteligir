import { useQuery } from '@apollo/react-hooks';
import gql from 'graphql-tag';

export const GET_PLAYLISTS = gql`
  query GET_PLAYLISTS {
    playlists {
      id
      description
    }
  }
`;

export function useGetPlaylists() {
  return useQuery(GET_PLAYLISTS);
}

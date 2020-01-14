import { useMutation } from '@apollo/react-hooks';
import gql from 'graphql-tag';

export const GET_PLAYLIST = gql`
  query Playlist($id: ID!) {
    playlist(where: { id: $id }) {
      id
      description
    }
  }
`;

export function useGetPlaylist() {
  return useMutation(GET_PLAYLIST);
}

import * as SecureStore from "expo-secure-store";

const ROOM_CODE_KEY = "dispatch_room_code";

export const getRoomCode = () => SecureStore.getItem(ROOM_CODE_KEY);
export const setRoomCode = (v: string) => SecureStore.setItem(ROOM_CODE_KEY, v);

export const clearSession = async () => {
  await SecureStore.deleteItemAsync(ROOM_CODE_KEY);
};

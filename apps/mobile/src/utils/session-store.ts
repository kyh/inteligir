import * as SecureStore from "expo-secure-store";

const MOBILE_TOKEN_KEY = "dispatch_mobile_token";
const DEVICE_ID_KEY = "dispatch_device_id";
const DEVICE_NAME_KEY = "dispatch_device_name";

export const getMobileToken = () => SecureStore.getItem(MOBILE_TOKEN_KEY);
export const setMobileToken = (v: string) => SecureStore.setItem(MOBILE_TOKEN_KEY, v);
export const deleteMobileToken = () => SecureStore.deleteItemAsync(MOBILE_TOKEN_KEY);

export const getDeviceId = () => SecureStore.getItem(DEVICE_ID_KEY);
export const setDeviceId = (v: string) => SecureStore.setItem(DEVICE_ID_KEY, v);

export const getDeviceName = () => SecureStore.getItem(DEVICE_NAME_KEY);
export const setDeviceName = (v: string) => SecureStore.setItem(DEVICE_NAME_KEY, v);

export const clearSession = async () => {
  await deleteMobileToken();
  await SecureStore.deleteItemAsync(DEVICE_ID_KEY);
  await SecureStore.deleteItemAsync(DEVICE_NAME_KEY);
};

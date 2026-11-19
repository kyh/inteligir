export const isImeComposing = (event: { nativeEvent: KeyboardEvent }) =>
  event.nativeEvent.isComposing ||
  // oxlint-disable-next-line typescript/no-deprecated -- Safari ends a composition with a keydown that is not isComposing, whose keyCode is 229, the one sign of it
  event.nativeEvent.keyCode === 229;

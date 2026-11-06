// Every key inside an IME composition belongs to the composer: Enter commits a candidate, the
// arrows pick one, Escape drops it. Safari fires the committing keydown after compositionend, so
// there `isComposing` is already false and only keyCode 229 says so.
export const isImeComposing = (event: { nativeEvent: KeyboardEvent }): boolean =>
  event.nativeEvent.isComposing ||
  // oxlint-disable-next-line typescript/no-deprecated -- Safari ends a composition with a keydown that is not isComposing, whose keyCode is 229, the one sign of it
  event.nativeEvent.keyCode === 229;

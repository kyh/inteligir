/* oxlint-disable max-classes-per-file -- the voice port's two refusals; a caller catches them together */
export class VoiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceUnavailableError";
  }
}

export class VoiceBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceBusyError";
  }
}

// ---------------------------------------------------------------------------
// Deepgram streaming STT via raw WebSocket — zero dependencies
// ---------------------------------------------------------------------------

export type TranscriptCallback = (text: string, isFinal: boolean) => void;

export type STTHandle = {
  stop: () => void;
};

type DeepgramMessage = {
  type?: string;
  is_final?: boolean;
  channel?: {
    alternatives?: Array<{ transcript?: string }>;
  };
};

export async function startSTT(
  apiKey: string,
  onTranscript: TranscriptCallback,
  onError: (error: string) => void,
): Promise<STTHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const params = new URLSearchParams({
    model: "nova-3",
    language: "en",
    smart_format: "true",
    interim_results: "true",
    utterance_end_ms: "1000",
    endpointing: "300",
    encoding: "linear16",
    sample_rate: "16000",
  });

  const ws = new WebSocket(
    `wss://api.deepgram.com/v1/listen?${params.toString()}`,
    ["token", apiKey],
  );

  let keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  let audioContext: AudioContext | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let processorNode: ScriptProcessorNode | null = null;
  let stopped = false;

  ws.onopen = () => {
    if (stopped) return;

    // ScriptProcessorNode sends raw PCM (linear16 @ 16kHz) to Deepgram.
    // Connected to a silent gain node — NOT to destination (avoids echo).
    audioContext = new AudioContext({ sampleRate: 16000 });
    sourceNode = audioContext.createMediaStreamSource(stream);
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    const silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;

    processorNode.onaudioprocess = (event) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const float32 = event.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i] ?? 0));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      ws.send(int16.buffer);
    };

    sourceNode.connect(processorNode);
    processorNode.connect(silentOutput);
    silentOutput.connect(audioContext.destination);

    keepAliveInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, 8000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(String(event.data)) as DeepgramMessage;
      const transcript = data.channel?.alternatives?.[0]?.transcript;
      if (transcript) {
        onTranscript(transcript, data.is_final ?? false);
      }
    } catch {
      // Non-JSON message — ignore
    }
  };

  ws.onerror = () => {
    onError("Deepgram connection error");
  };

  ws.onclose = (event) => {
    if (!stopped && event.code !== 1000) {
      onError(`Deepgram disconnected: ${event.reason || `code ${String(event.code)}`}`);
    }
  };

  return {
    stop: () => {
      stopped = true;
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      processorNode?.disconnect();
      sourceNode?.disconnect();
      processorNode = null;
      sourceNode = null;
      void audioContext?.close();
      audioContext = null;
      stream.getTracks().forEach((t) => t.stop());
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000);
      }
    },
  };
}

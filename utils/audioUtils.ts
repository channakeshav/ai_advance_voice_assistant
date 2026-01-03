// Convert Float32Array PCM data to the format Gemini expects (PCM 16-bit Int)
export function createBlob(data: Float32Array): { data: string; mimeType: string } {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Clamp values to [-1, 1] before converting
    const s = Math.max(-1, Math.min(1, data[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

// Basic base64 encoder
export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Basic base64 decoder
export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Decode raw PCM 16-bit audio data into an AudioBuffer
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Simulates a phone ring tone using Web Audio API
export function playRingSound(ctx: AudioContext): Promise<void> {
  return new Promise((resolve) => {
    // Standard US Ring cadence: 2s on, 4s off. We just do one 2s ring.
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    // Dual frequencies for a phone ring effect (e.g., 440Hz + 480Hz)
    osc1.frequency.value = 440;
    osc2.frequency.value = 480;

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    // Modulation (flutter)
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 20; // 20Hz flutter
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5; // Amplitude modulation
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.1);
    gain.gain.linearRampToValueAtTime(0, now + 2.0);

    osc1.start(now);
    osc2.start(now);
    lfo.start(now);

    osc1.stop(now + 2.1);
    osc2.stop(now + 2.1);
    lfo.stop(now + 2.1);

    setTimeout(resolve, 2000);
  });
}

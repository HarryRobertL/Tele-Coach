/**
 * Convert PCM16 audio data to WAV format for Whisper processing
 */

export interface WavHeader {
  view: DataView;
  buffer: ArrayBuffer;
}

/**
 * Create WAV header for PCM16 audio data
 */
export function createWavHeader(sampleRate: number, channels: number, dataLength: number): WavHeader {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  // RIFF identifier
  view.setUint32(0, 0x46464952, true); // "RIFF"
  // file length
  view.setUint32(4, 36 + dataLength, true);
  // WAVE identifier
  view.setUint32(8, 0x45564157, true); // "WAVE"
  // fmt chunk identifier
  view.setUint32(12, 0x20746d66, true); // "fmt "
  // chunk length
  view.setUint32(16, 16, true);
  // sample format (PCM)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, channels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate
  view.setUint32(28, sampleRate * channels * 2, true);
  // block align
  view.setUint16(32, channels * 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  view.setUint32(36, 0x61746164, true); // "data"
  // data length
  view.setUint32(40, dataLength, true);

  return { view, buffer };
}

/**
 * Convert PCM16 Uint8Array to WAV format
 */
export function pcm16ToWav(pcm16: Uint8Array, sampleRate: number = 16000, channels: number = 1): ArrayBuffer {
  const dataLength = pcm16.length;
  const header = createWavHeader(sampleRate, channels, dataLength);
  const wav = new ArrayBuffer(header.buffer.byteLength + dataLength);
  
  // Copy header
  new Uint8Array(wav).set(new Uint8Array(header.buffer), 0);
  
  // Copy PCM data
  new Uint8Array(wav).set(pcm16, header.buffer.byteLength);
  
  return wav;
}

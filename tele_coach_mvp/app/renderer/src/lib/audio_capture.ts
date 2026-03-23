export interface AudioCaptureOptions {
  sampleRate: 16000;
  channels: 1;
  frameMs: 200;
  onChunk: (chunk: AudioChunkPayload) => void;
  onRms?: (rms: number) => void;
  onStatus?: (status: MicStatus, detail?: string) => void;
}

export interface AudioChunkPayload {
  pcm16: Uint8Array;
  sampleRate: 16000;
  channels: 1;
  frameMs: 200;
  rms: number;
}

export type MicStatus = "idle" | "requesting" | "active" | "error";

let workletModuleCounter = 0;

function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sumSquares += samples[i] * samples[i];
  }
  return Math.sqrt(sumSquares / samples.length);
}

function clampSample(value: number): number {
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

function floatToPcm16(samples: Float32Array): Uint8Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = clampSample(samples[i]);
    pcm[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }
  return new Uint8Array(pcm.buffer.slice(0));
}

function downmixToMono(channelData: Float32Array[]): Float32Array {
  if (channelData.length === 0) return new Float32Array(0);
  if (channelData.length === 1) return channelData[0];
  const frameLength = channelData[0].length;
  const mono = new Float32Array(frameLength);
  for (let i = 0; i < frameLength; i += 1) {
    let sum = 0;
    for (let channel = 0; channel < channelData.length; channel += 1) {
      sum += channelData[channel][i] ?? 0;
    }
    mono[i] = sum / channelData.length;
  }
  return mono;
}

function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  const targetRate = 16000;
  if (inputRate === targetRate || input.length === 0) return input;
  const outputLength = Math.max(1, Math.round((input.length * targetRate) / inputRate));
  const output = new Float32Array(outputLength);
  const ratio = inputRate / targetRate;
  for (let i = 0; i < outputLength; i += 1) {
    const srcIndex = i * ratio;
    const left = Math.floor(srcIndex);
    const right = Math.min(left + 1, input.length - 1);
    const frac = srcIndex - left;
    output[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return output;
}

function createPcmWorkletUrl(): string {
  workletModuleCounter += 1;
  const source = `
    class PcmCaptureProcessor extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0 || !input[0]) {
          return true;
        }
        const frameLength = input[0].length;
        const channels = input.length;
        const mono = new Float32Array(frameLength);
        if (channels === 1) {
          mono.set(input[0]);
        } else {
          for (let i = 0; i < frameLength; i += 1) {
            let sum = 0;
            for (let ch = 0; ch < channels; ch += 1) {
              sum += input[ch][i] || 0;
            }
            mono[i] = sum / channels;
          }
        }
        this.port.postMessage(mono, [mono.buffer]);
        return true;
      }
    }
    registerProcessor("pcm-capture-processor-${workletModuleCounter}", PcmCaptureProcessor);
  `;
  return URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
}

export class AudioCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sinkNode: GainNode | null = null;
  private pending: number[] = [];
  private active = false;
  private workletUrl: string | null = null;

  constructor(private readonly options: AudioCaptureOptions) {}

  private pickPreferredInput(devices: MediaDeviceInfo[]): MediaDeviceInfo | null {
    const inputs = devices.filter((device) => device.kind === "audioinput");
    if (inputs.length === 0) return null;
    const ranked = [...inputs].sort((a, b) => {
      const score = (device: MediaDeviceInfo): number => {
        const label = device.label.toLowerCase();
        let s = 0;
        if (/(macbook|built-?in|internal)/.test(label)) s += 10;
        if (/(microphone|mic)/.test(label)) s += 2;
        if (/(iphone|continuity)/.test(label)) s -= 10;
        return s;
      };
      return score(b) - score(a);
    });
    return ranked[0] ?? null;
  }

  private setStatus(status: MicStatus, detail?: string): void {
    this.options.onStatus?.(status, detail);
  }

  private flushFrames(inputSamples: Float32Array, inputRate: number): void {
    const rms = computeRms(inputSamples);
    this.options.onRms?.(rms);
    const normalized = resampleTo16k(inputSamples, inputRate);
    for (let i = 0; i < normalized.length; i += 1) {
      this.pending.push(normalized[i]);
    }
    const frameSamples = (this.options.sampleRate * this.options.frameMs) / 1000;
    while (this.pending.length >= frameSamples) {
      const frame = new Float32Array(this.pending.slice(0, frameSamples));
      this.pending = this.pending.slice(frameSamples);
      this.options.onChunk({
        pcm16: floatToPcm16(frame),
        sampleRate: this.options.sampleRate,
        channels: this.options.channels,
        frameMs: this.options.frameMs,
        rms
      });
    }
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.setStatus("requesting");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 },
        // H9: disable browser DSP in packaged runtime in case processing path
        // is collapsing low-level signal to silence.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    });

    // After permission is granted, enumerate devices and prefer built-in mic.
    const devices = await navigator.mediaDevices.enumerateDevices();
    const preferredInput = this.pickPreferredInput(devices);
    const currentTrack = this.stream.getAudioTracks()[0] ?? null;
    const currentDeviceId = currentTrack?.getSettings().deviceId;
    if (
      preferredInput &&
      preferredInput.deviceId &&
      preferredInput.deviceId !== currentDeviceId
    ) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: preferredInput.deviceId },
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: false
      });
    }

    // Use device/native sample rate for capture reliability; we resample to 16 kHz in software.
    this.context = new AudioContext();
    const inputRate = this.context.sampleRate;
    this.sourceNode = this.context.createMediaStreamSource(this.stream);

    // Keep processing graph alive without audible playback.
    this.sinkNode = this.context.createGain();
    this.sinkNode.gain.value = 0;
    this.sinkNode.connect(this.context.destination);

    // ScriptProcessor is deprecated for browsers, but in packaged Electron it is
    // significantly more reliable than AudioWorklet across macOS device setups.
    this.processorNode = this.context.createScriptProcessor(4096, 1, 1);
    this.processorNode.onaudioprocess = (event) => {
      const channels: Float32Array[] = [];
      for (let i = 0; i < event.inputBuffer.numberOfChannels; i += 1) {
        channels.push(event.inputBuffer.getChannelData(i));
      }
      const mono = downmixToMono(channels);
      this.flushFrames(new Float32Array(mono), inputRate);
    };
    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.sinkNode);

    this.pending = [];
    this.active = true;
    const activeTrack = this.stream.getAudioTracks()[0] ?? null;
    const activeDeviceId = activeTrack?.getSettings().deviceId;
    const activeDeviceLabel =
      devices.find((device) => device.kind === "audioinput" && device.deviceId === activeDeviceId)
        ?.label ??
      preferredInput?.label ??
      "default microphone";
    this.setStatus("active", activeDeviceLabel);
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.pending = [];

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.sinkNode) {
      this.sinkNode.disconnect();
      this.sinkNode = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
    this.setStatus("idle");
  }

  async startSafe(): Promise<void> {
    try {
      await this.start();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown microphone error";
      this.setStatus("error", detail);
      throw error;
    }
  }
}

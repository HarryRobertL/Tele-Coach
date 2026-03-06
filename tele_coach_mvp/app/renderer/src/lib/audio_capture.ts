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
        const ch0 = input[0];
        const copy = new Float32Array(ch0.length);
        copy.set(ch0);
        this.port.postMessage(copy, [copy.buffer]);
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
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    });

    this.context = new AudioContext({ sampleRate: 16000 });
    const inputRate = this.context.sampleRate;
    this.sourceNode = this.context.createMediaStreamSource(this.stream);

    // Keep processing graph alive without audible playback.
    this.sinkNode = this.context.createGain();
    this.sinkNode.gain.value = 0;
    this.sinkNode.connect(this.context.destination);

    if (typeof AudioWorkletNode !== "undefined") {
      const processorName = `pcm-capture-processor-${workletModuleCounter + 1}`;
      this.workletUrl = createPcmWorkletUrl();
      await this.context.audioWorklet.addModule(this.workletUrl);
      this.workletNode = new AudioWorkletNode(this.context, processorName);
      this.workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        this.flushFrames(event.data, inputRate);
      };
      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.sinkNode);
    } else {
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
    }

    this.pending = [];
    this.active = true;
    this.setStatus("active");
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

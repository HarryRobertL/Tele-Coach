export interface TranscriptChunk {
  text: string;
  tsMs: number;
}

export class SttClient {
  subscribe(_handler: (chunk: TranscriptChunk) => void): () => void {
    // TODO: Subscribe to transcript IPC events.
    return () => {
      // TODO: Unsubscribe from transcript IPC events.
    };
  }
}

export type TranscriptSegmentKind = "partial" | "final";

export interface TranscriptSegment {
  id: string;
  text: string;
  kind: TranscriptSegmentKind;
  created_at: number;
  updated_at: number;
  speaker: "unknown";
  stable: boolean;
}

export interface TranscriptSessionState {
  segments: TranscriptSegment[];
  rollingText: string;
  lastStableText: string;
}

export interface TranscriptChunkInput {
  text: string;
  tsMs: number;
  isPartial: boolean;
}

export interface TranscriptSegmenterConfig {
  maxSegments?: number;
  maxRollingChars?: number;
}

const DEFAULT_MAX_SEGMENTS = 20;
const DEFAULT_MAX_ROLLING_CHARS = 2000;

let segmentCounter = 0;
function nextId(): string {
  segmentCounter += 1;
  return `seg_${segmentCounter}`;
}

export function createInitialTranscriptSessionState(): TranscriptSessionState {
  return {
    segments: [],
    rollingText: "",
    lastStableText: ""
  };
}

function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parts = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return parts.length > 0 ? parts : [trimmed];
}

function recomputeRollingText(
  segments: TranscriptSegment[],
  maxRollingChars: number
): string {
  let rolling = "";
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i];
    const candidate = seg.text + (rolling ? ` ${rolling}` : "");
    if (candidate.length > maxRollingChars) break;
    rolling = candidate;
  }
  return rolling;
}

function pruneSegments(
  segments: TranscriptSegment[],
  maxSegments: number,
  maxRollingChars: number
): { segments: TranscriptSegment[]; rollingText: string; lastStableText: string } {
  let pruned = segments;
  if (pruned.length > maxSegments) {
    pruned = pruned.slice(pruned.length - maxSegments);
  }

  let rollingText = recomputeRollingText(pruned, maxRollingChars);

  // If still too long, drop oldest stable segments until within limit
  while (rollingText.length > maxRollingChars && pruned.length > 1) {
    const firstStableIndex = pruned.findIndex((s) => s.stable);
    if (firstStableIndex === -1) break;
    pruned = pruned.slice(firstStableIndex + 1);
    rollingText = recomputeRollingText(pruned, maxRollingChars);
  }

  const lastStable = [...pruned].reverse().find((s) => s.stable) ?? null;

  return {
    segments: pruned,
    rollingText,
    lastStableText: lastStable?.text ?? ""
  };
}

/**
 * Update transcript session state with a new partial or final chunk.
 * - Partials update the active segment.
 * - Finals create stable segments (split by sentence) and clear partials.
 * - Trivial short continuations are merged into previous final segments.
 */
export function updateTranscriptSessionState(
  prev: TranscriptSessionState,
  chunk: TranscriptChunkInput,
  config?: TranscriptSegmenterConfig
): TranscriptSessionState {
  const maxSegments = config?.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  const maxRollingChars = config?.maxRollingChars ?? DEFAULT_MAX_ROLLING_CHARS;

  const now = chunk.tsMs || Date.now();
  const segments = [...prev.segments];

  if (chunk.isPartial) {
    const last = segments[segments.length - 1];
    if (last && last.kind === "partial") {
      last.text = chunk.text;
      last.updated_at = now;
    } else {
      segments.push({
        id: nextId(),
        text: chunk.text,
        kind: "partial",
        created_at: now,
        updated_at: now,
        speaker: "unknown",
        stable: false
      });
    }
  } else {
    // Final chunk: clear any existing partial and create stable final segments
    const last = segments[segments.length - 1];
    let baseSegment: TranscriptSegment | undefined;

    if (last && last.kind === "partial") {
      // Reuse the partial segment as the first final segment
      baseSegment = {
        ...last,
        kind: "final",
        stable: true,
        created_at: last.created_at,
        updated_at: now
      };
      segments.pop();
    }

    const sentences = splitIntoSentences(chunk.text);

    sentences.forEach((sentence, index) => {
      const text = sentence.trim();
      if (!text) return;

      const previous = segments[segments.length - 1];
      // Merge very short continuations into previous final segment
      if (
        previous &&
        previous.kind === "final" &&
        previous.stable &&
        text.length <= 5
      ) {
        previous.text = `${previous.text} ${text}`;
        previous.updated_at = now;
        return;
      }

      if (index === 0 && baseSegment) {
        baseSegment.text = text;
        segments.push(baseSegment);
      } else {
        segments.push({
          id: nextId(),
          text,
          kind: "final",
          created_at: now,
          updated_at: now,
          speaker: "unknown",
          stable: true
        });
      }
    });
  }

  const pruned = pruneSegments(segments, maxSegments, maxRollingChars);

  return {
    segments: pruned.segments,
    rollingText: pruned.rollingText,
    lastStableText: pruned.lastStableText
  };
}

// Helper selectors
export function getRollingTranscript(state: TranscriptSessionState): string {
  return state.rollingText;
}

export function getRecentStableSegments(
  state: TranscriptSessionState,
  count: number
): TranscriptSegment[] {
  const stable = state.segments.filter((s) => s.stable);
  if (count <= 0) return [];
  return stable.slice(Math.max(0, stable.length - count));
}

export function getLastStableSegment(
  state: TranscriptSessionState
): TranscriptSegment | null {
  const stable = [...state.segments].reverse().find((s) => s.stable);
  return stable ?? null;
}


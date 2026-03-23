import { NormalizedTranscript } from "./transcript_normalizer";

export interface TranscriptSegment {
  text: string;
  tsMs: number;
  isFinal: boolean;
}

export interface RollingWindowState {
  currentPartial: string;
  finalSegments: TranscriptSegment[];
  rollingCoachingText: string;
  totalChars: number;
}

export class TranscriptRollingWindow {
  private finalSegments: TranscriptSegment[] = [];
  private currentPartial = "";
  private rollingCoachingText = "";
  private readonly maxChars = 1800; // Upper limit for rolling window
  private readonly minChars = 1200; // Lower limit before trimming
  private readonly maxAgeMs = 40000; // 40 seconds max age
  private readonly minAgeMs = 20000; // 20 seconds min age

  private readonly DEBUG_STT = process.env.DEBUG_STT === "1";

  private debugLog(message: string, ...args: any[]): void {
    if (this.DEBUG_STT) {
      console.log(`[TranscriptRollingWindow] ${message}`, ...args);
    }
  }

  /**
   * Process a normalized transcript chunk and update rolling window
   */
  processChunk(chunk: NormalizedTranscript): RollingWindowState {
    if (chunk.isPartial) {
      this.updatePartial(chunk.text);
    } else {
      this.addFinalSegment(chunk.text, chunk.tsMs);
    }

    this.updateRollingWindow();

    const state: RollingWindowState = {
      currentPartial: this.currentPartial,
      finalSegments: [...this.finalSegments],
      rollingCoachingText: this.rollingCoachingText,
      totalChars: this.rollingCoachingText.length
    };

    this.debugLog("State updated:", {
      isPartial: chunk.isPartial,
      rollingTextLength: state.totalChars,
      segmentCount: state.finalSegments.length,
      partialLength: state.currentPartial.length
    });

    return state;
  }

  /**
   * Update current partial transcript
   */
  private updatePartial(text: string): void {
    this.currentPartial = text;
  }

  /**
   * Add a final transcript segment
   */
  private addFinalSegment(text: string, tsMs: number): void {
    // Avoid duplicate final segments
    const lastSegment = this.finalSegments[this.finalSegments.length - 1];
    if (lastSegment && lastSegment.text === text) {
      this.debugLog("Duplicate final segment, skipping");
      return;
    }

    this.finalSegments.push({
      text,
      tsMs,
      isFinal: true
    });

    // Clear current partial since we have a final version
    this.currentPartial = "";

    this.debugLog("Added final segment:", { text, segmentCount: this.finalSegments.length });
  }

  /**
   * Update the rolling coaching text based on time and character limits
   */
  private updateRollingWindow(): void {
    const now = Date.now();
    let combinedText = "";

    // Start with current partial if available
    if (this.currentPartial) {
      combinedText = this.currentPartial;
    }

    // Add final segments, newest first
    for (let i = this.finalSegments.length - 1; i >= 0; i--) {
      const segment = this.finalSegments[i];
      const age = now - segment.tsMs;

      // Skip segments that are too old
      if (age > this.maxAgeMs) {
        this.debugLog(`Segment too old: ${age}ms, skipping`);
        continue;
      }

      // Prepend segment text with separator
      const separator = combinedText ? " " : "";
      const newText = `${segment.text}${separator}${combinedText}`;

      // Check if we're within limits
      if (newText.length <= this.maxChars) {
        combinedText = newText;
      } else {
        // Trim older segments until we fit
        break;
      }
    }

    // If still too long, trim from the beginning
    if (combinedText.length > this.maxChars) {
      combinedText = this.trimToFit(combinedText);
    }

    this.rollingCoachingText = combinedText;
  }

  /**
   * Trim text to fit within max characters while preserving word boundaries
   */
  private trimToFit(text: string): string {
    if (text.length <= this.maxChars) {
      return text;
    }

    // Find the last word boundary within the limit
    const truncated = text.substring(text.length - this.maxChars);
    const firstSpace = truncated.indexOf(" ");
    
    if (firstSpace !== -1 && firstSpace < 100) { // If first space is reasonably close
      return truncated.substring(firstSpace + 1);
    }

    return truncated;
  }

  /**
   * Clean up old segments to prevent memory buildup
   */
  cleanup(): void {
    const now = Date.now();
    const originalCount = this.finalSegments.length;

    // Remove segments older than max age
    this.finalSegments = this.finalSegments.filter(
      segment => now - segment.tsMs <= this.maxAgeMs
    );

    // Also trim if we have too many segments
    if (this.finalSegments.length > 50) {
      this.finalSegments = this.finalSegments.slice(-30);
    }

    const removed = originalCount - this.finalSegments.length;
    if (removed > 0) {
      this.debugLog(`Cleaned up ${removed} old segments`);
    }
  }

  /**
   * Get the current rolling window text suitable for coaching
   */
  getCoachingText(): string {
    return this.rollingCoachingText;
  }

  /**
   * Get the current partial transcript
   */
  getCurrentPartial(): string {
    return this.currentPartial;
  }

  /**
   * Get all final segments
   */
  getFinalSegments(): TranscriptSegment[] {
    return [...this.finalSegments];
  }

  /**
   * Get complete state snapshot
   */
  getState(): RollingWindowState {
    return {
      currentPartial: this.currentPartial,
      finalSegments: [...this.finalSegments],
      rollingCoachingText: this.rollingCoachingText,
      totalChars: this.rollingCoachingText.length
    };
  }

  /**
   * Reset all state (useful for new sessions)
   */
  reset(): void {
    this.finalSegments = [];
    this.currentPartial = "";
    this.rollingCoachingText = "";
    this.debugLog("Rolling window reset");
  }

  /**
   * Get statistics about the current state
   */
  getStats(): {
    segmentCount: number;
    partialLength: number;
    rollingTextLength: number;
    oldestSegmentAge: number;
    newestSegmentAge: number;
  } {
    const now = Date.now();
    const ages = this.finalSegments.map(s => now - s.tsMs);
    
    return {
      segmentCount: this.finalSegments.length,
      partialLength: this.currentPartial.length,
      rollingTextLength: this.rollingCoachingText.length,
      oldestSegmentAge: ages.length > 0 ? Math.max(...ages) : 0,
      newestSegmentAge: ages.length > 0 ? Math.min(...ages) : 0
    };
  }
}

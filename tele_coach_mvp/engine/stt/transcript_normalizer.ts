export interface TranscriptChunk {
  text: string;
  tsMs: number;
  is_partial?: boolean;
}

export interface NormalizedTranscript {
  text: string;
  isPartial: boolean;
  tsMs: number;
  shouldTriggerCoaching: boolean;
}

export class TranscriptNormalizer {
  private lastPartialText = "";
  private lastFinalText = "";
  private recentDuplicates = new Set<string>();
  private lastDuplicateCleanup = 0;
  private readonly duplicateWindowMs = 2000; // 2 second rolling window for duplicates
  private readonly minChangeChars = 12; // Minimum character change to trigger coaching
  private readonly coachingThrottleMs = 1200; // Minimum time between coaching updates
  private lastCoachingUpdate = 0;

  private readonly DEBUG_STT = process.env.DEBUG_STT === "1";

  private debugLog(message: string, ...args: any[]): void {
    if (this.DEBUG_STT) {
      console.log(`[TranscriptNormalizer] ${message}`, ...args);
    }
  }

  /**
   * Normalize incoming transcript chunks and determine if coaching should be triggered
   */
  processChunk(chunk: TranscriptChunk): NormalizedTranscript | null {
    const normalizedText = this.normalizeText(chunk.text);
    if (!normalizedText) {
      this.debugLog("Empty text after normalization, dropping");
      return null;
    }

    const isPartial = chunk.is_partial !== false; // Default to partial if not specified
    const now = Date.now();

    // Clean up old duplicates periodically
    this.cleanupOldDuplicates(now);

    // Check for duplicates
    if (this.isDuplicate(normalizedText, isPartial)) {
      this.debugLog("Duplicate detected, dropping:", normalizedText);
      return null;
    }

    // Add to recent duplicates tracking (only for finals to prevent repeated events)
    if (!isPartial) {
      this.recentDuplicates.add(normalizedText);
    }

    // Determine if this should trigger coaching
    const shouldTriggerCoaching = this.shouldTriggerCoaching(normalizedText, isPartial, now);

    // Update tracking variables
    if (isPartial) {
      this.lastPartialText = normalizedText;
    } else {
      this.lastFinalText = normalizedText;
    }

    if (shouldTriggerCoaching) {
      this.lastCoachingUpdate = now;
    }

    this.debugLog("Processed chunk:", {
      text: normalizedText,
      isPartial,
      shouldTriggerCoaching,
      originalLength: chunk.text.length,
      normalizedLength: normalizedText.length
    });

    return {
      text: normalizedText,
      isPartial,
      tsMs: chunk.tsMs,
      shouldTriggerCoaching
    };
  }

  /**
   * Normalize text content
   */
  private normalizeText(text: string): string {
    return text
      .trim()                           // Remove leading/trailing whitespace
      .replace(/\s+/g, " ")            // Collapse multiple spaces to single space
      .replace(/\s+([.!?])/g, "$1")    // Remove space before punctuation
      .replace(/([.!?])\s+/g, "$1 ")   // Ensure single space after punctuation
      .trim();
  }

  /**
   * Check if text is a duplicate of recent content
   */
  private isDuplicate(text: string, isPartial: boolean): boolean {
    // Check against last partial/final for intelligent merging
    if (isPartial && text === this.lastPartialText) {
      return true;
    }

    if (!isPartial && text === this.lastFinalText) {
      return true;
    }

    // Check for micro-fluctuations (punctuation only changes)
    if (isPartial && this.isMicroFluctuation(text, this.lastPartialText)) {
      return true;
    }

    // Check for partial/final overlap
    if (this.hasPartialFinalOverlap(text, isPartial)) {
      return true;
    }

    // Only check exact duplicates in recent window for finals (to avoid repeated final events)
    if (!isPartial && this.recentDuplicates.has(text)) {
      return true;
    }

    return false;
  }

  /**
   * Check if change is just punctuation or trailing character
   */
  private isMicroFluctuation(current: string, previous: string): boolean {
    if (!previous || previous.length === 0) return false;
    
    // Remove punctuation and compare
    const currentClean = current.replace(/[.!?]+$/, "").trim();
    const previousClean = previous.replace(/[.!?]+$/, "").trim();
    
    if (currentClean === previousClean) {
      return true;
    }

    // Check if only difference is trailing space or single character
    const diff = Math.abs(current.length - previous.length);
    if (diff <= 2 && (current.startsWith(previous) || previous.startsWith(current))) {
      return true;
    }

    return false;
  }

  /**
   * Check for overlap between partial and final transcripts
   */
  private hasPartialFinalOverlap(text: string, isPartial: boolean): boolean {
    if (isPartial) {
      // Drop only when incoming partial is a shorter/equal prefix of the last final.
      // If partial extends the last final ("you" -> "you know ..."), keep it.
      return (
        this.lastFinalText.length > 0 &&
        this.lastFinalText.startsWith(text) &&
        text.length <= this.lastFinalText.length
      );
    } else {
      // For finals, only filter if it's identical to the last final
      // Allow finals that supersede partials
      return text === this.lastFinalText;
    }
  }

  /**
   * Determine if coaching should be triggered
   */
  private shouldTriggerCoaching(text: string, isPartial: boolean, now: number): boolean {
    // Always trigger on final transcripts
    if (!isPartial) {
      this.debugLog("Final transcript, triggering coaching");
      return true;
    }

    // Check time throttle
    if (now - this.lastCoachingUpdate < this.coachingThrottleMs) {
      this.debugLog("Coaching throttled, too soon since last update");
      return false;
    }

    // Check for material change
    const charChange = Math.abs(text.length - this.lastPartialText.length);
    if (charChange >= this.minChangeChars) {
      this.debugLog("Material character change detected:", charChange);
      return true;
    }

    // Check for sentence boundary
    if (/[.!?]\s*$/.test(text)) {
      this.debugLog("Sentence boundary detected");
      return true;
    }

    // Check time-based trigger
    if (now - this.lastCoachingUpdate >= this.coachingThrottleMs) {
      this.debugLog("Time-based coaching trigger");
      return true;
    }

    return false;
  }

  /**
   * Clean up old duplicate entries
   */
  private cleanupOldDuplicates(now: number): void {
    if (now - this.lastDuplicateCleanup < 500) { // Cleanup every 500ms max
      return;
    }

    // Simple cleanup - clear the set periodically
    // In a more sophisticated implementation, we'd track timestamps per entry
    if (this.recentDuplicates.size > 100) {
      this.recentDuplicates.clear();
      this.debugLog("Cleared duplicate tracking buffer");
    }
    this.lastDuplicateCleanup = now;
  }

  /**
   * Reset state (useful for new sessions)
   */
  reset(): void {
    this.lastPartialText = "";
    this.lastFinalText = "";
    this.recentDuplicates.clear();
    this.lastDuplicateCleanup = 0;
    this.lastCoachingUpdate = 0;
    this.debugLog("Normalizer reset");
  }
}

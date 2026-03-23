import { describe, it, expect } from 'vitest';
import { detectSeverity } from '../engine/classifier/severity_rules';

describe('Severity Rules', () => {
  it('should classify "remove me from your list" as hard', () => {
    const severity = detectSeverity("remove me from your list");
    expect(severity).toBe("hard");
  });

  it('should classify "we are fine" as medium', () => {
    const severity = detectSeverity("we are fine");
    expect(severity).toBe("medium");
  });

  it('should classify "im busy today" as soft', () => {
    const severity = detectSeverity("im busy today");
    expect(severity).toBe("soft");
  });

  it('should classify empty text as soft', () => {
    const severity = detectSeverity("");
    expect(severity).toBe("soft");
  });

  it('should handle whitespace normalization', () => {
    const severity1 = detectSeverity("we   are   fine");
    const severity2 = detectSeverity("we are fine");
    expect(severity1).toBe(severity2);
  });
});

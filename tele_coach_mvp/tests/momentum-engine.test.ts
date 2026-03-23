import { describe, it, expect } from "vitest";
import { scoreMomentum } from "../engine/scoring/momentum_engine";

describe("Momentum Engine - QA", () => {
  it("acceptance: competitor + quick look now is medium or high", () => {
    const result = scoreMomentum({
      transcript: "we use Experian but I can have a quick look now",
      competitorCategory: "named_competitor",
      competitorMentions: ["experian"],
      stage: "demo_transition",
      intent: "unknown",
      severity: "soft"
    });

    expect(result.level === "medium" || result.level === "high").toBe(true);
  });

  it("acceptance: send email and six months is low or lower-medium", () => {
    const result = scoreMomentum({
      transcript: "send me an email and call in six months",
      intent: "callback",
      severity: "soft",
      stage: "next_step_close"
    });

    expect(result.score).toBeLessThanOrEqual(45);
  });

  it("applies hard stop-calling penalties", () => {
    const result = scoreMomentum({
      transcript: "remove me and stop calling",
      severity: "hard",
      intent: "not_relevant"
    });

    expect(result.score).toBe(0);
    expect(result.level).toBe("low");
    expect(result.reasons).toContain("remove_me_or_stop_calling");
  });

  it("applies repeated brush-off penalties", () => {
    const result = scoreMomentum({
      transcript: "send me an email, email me later, send me an email"
    });

    expect(result.reasons).toContain("repeated_send_email_brush_off");
  });

  it("clamps score to 100 with stacked positive signals", () => {
    const result = scoreMomentum({
      transcript: "can you show me your report? i am at my desk now and we can do two minutes",
      intent: "demo_ready",
      stage: "demo_transition",
      severity: "soft",
      competitorCategory: "named_competitor",
      competitorMentions: ["experian"]
    });

    expect(result.score).toBe(100);
    expect(result.level).toBe("high");
  });
});

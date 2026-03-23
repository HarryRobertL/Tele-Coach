import { describe, it, expect } from "vitest";
import { deriveConversationState } from "../engine/conversation/state_machine";

describe("Conversation State - QA", () => {
  it("classifies ended from stop-call phrases", () => {
    const state = deriveConversationState({
      rollingText: "please remove me and do not call again",
      recentSegments: [],
      objectionId: "unknown",
      intent: "unknown"
    });

    expect(state.stage).toBe("ended");
  });

  it("classifies demo transition from demo language", () => {
    const state = deriveConversationState({
      rollingText: "are you near a screen for two minutes so I can show you your report",
      recentSegments: [],
      objectionId: "unknown",
      intent: "unknown"
    });

    expect(state.stage).toBe("demo_transition");
  });

  it("classifies next step close from callback language", () => {
    const state = deriveConversationState({
      rollingText: "call me next week and we can follow up",
      recentSegments: [],
      objectionId: "unknown",
      intent: "callback"
    });

    expect(state.stage).toBe("next_step_close");
  });

  it("classifies objection handling when objection is active", () => {
    const state = deriveConversationState({
      rollingText: "we already have a provider",
      recentSegments: [],
      objectionId: "already_use_provider",
      intent: "competitor_locked"
    });

    expect(state.stage).toBe("objection_handling");
  });

  it("classifies discovery from discovery prompts", () => {
    const state = deriveConversationState({
      rollingText: "how do you currently decide and what is your current process",
      recentSegments: [],
      objectionId: "unknown",
      intent: "curious"
    });

    expect(state.stage).toBe("discovery");
  });

  it("classifies value exploration from value phrases", () => {
    const state = deriveConversationState({
      rollingText: "our credit risk and payment behaviour visibility is limited",
      recentSegments: [{ id: "1", text: "credit risk and payment behaviour matter here" }],
      objectionId: "unknown",
      intent: "unknown"
    });

    expect(state.stage).toBe("value_exploration");
  });

  it("classifies opening for early call segments", () => {
    const state = deriveConversationState({
      rollingText: "hello is that finance",
      recentSegments: [{ id: "1", text: "hello" }],
      objectionId: "unknown",
      intent: "unknown"
    });

    expect(state.stage).toBe("opening");
  });
});

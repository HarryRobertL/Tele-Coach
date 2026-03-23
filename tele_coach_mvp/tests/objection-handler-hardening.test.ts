import { beforeEach, describe, it, expect } from "vitest";
import { detectObjectionId, resetObjectionClassifierState } from "../engine/classifier/playbook_classifier";

describe("Objection Handler Hardening", () => {
  beforeEach(() => {
    resetObjectionClassifierState();
  });

  it("maps floor-language email brush-off variants", () => {
    const detection = detectObjectionId("can you put it in an email and send details by email");
    expect(detection.id).toBe("send_email");
    expect(detection.confidence).toBeGreaterThan(0.62);
  });

  it("maps competitor mentions to already_use_provider", () => {
    const detection = detectObjectionId("we use d&b at the moment");
    expect(detection.id).toBe("already_use_provider");
  });

  it("maps soft not-interested phrasing", () => {
    const detection = detectObjectionId("not for us right now, we dont need this");
    expect(detection.id).toBe("not_interested_soft");
  });

  it("maps hard not-interested phrasing", () => {
    const detection = detectObjectionId("definitely not interested, really not interested");
    expect(detection.id).toBe("not_interested_cartwheel");
  });

  it("maps budget/price objections with variants", () => {
    const budget = detectObjectionId("we have no budget for this and budget is tight");
    resetObjectionClassifierState();
    const price = detectObjectionId("it's too expensive and price is too high");

    expect(budget.id).toBe("no_budget");
    expect(price.id).toBe("too_expensive");
  });
});

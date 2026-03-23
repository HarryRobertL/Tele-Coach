import { describe, expect, it } from "vitest";
import { selectCoachingPack } from "../engine/response_engine/selector";
import { resetObjectionClassifierState } from "../engine/classifier/playbook_classifier";
import { SALES_FLOOR_PHRASES } from "./fixtures/sales-floor-phrases.fixture";

describe("Sales Floor Script Contract", () => {
  it("keeps phrase-to-classification contract stable", () => {
    for (const scenario of SALES_FLOOR_PHRASES) {
      resetObjectionClassifierState();
      const pack = selectCoachingPack(scenario.transcript);

      if (scenario.expect.objectionId !== undefined) {
        expect(pack.objection_id, `${scenario.id}: objection`).toBe(scenario.expect.objectionId);
      }
      if (scenario.expect.severity !== undefined) {
        expect(pack.severity, `${scenario.id}: severity`).toBe(scenario.expect.severity);
      }
      if (scenario.expect.intent !== undefined) {
        expect(pack.intent, `${scenario.id}: intent`).toBe(scenario.expect.intent);
      }
      if (scenario.expect.stage !== undefined) {
        expect(pack.conversation_stage, `${scenario.id}: stage`).toBe(scenario.expect.stage);
      }
      if (scenario.expect.momentumLevel !== undefined) {
        expect(pack.momentum_level, `${scenario.id}: momentum level`).toBe(scenario.expect.momentumLevel);
      }
      if (scenario.expect.minScore !== undefined) {
        expect(pack.momentum_score, `${scenario.id}: min score`).toBeGreaterThanOrEqual(scenario.expect.minScore);
      }
      if (scenario.expect.maxScore !== undefined) {
        expect(pack.momentum_score, `${scenario.id}: max score`).toBeLessThanOrEqual(scenario.expect.maxScore);
      }
      if (scenario.expect.reasonIncludes !== undefined) {
        for (const reason of scenario.expect.reasonIncludes) {
          expect(pack.momentum_reasons, `${scenario.id}: reason ${reason}`).toContain(reason);
        }
      }
    }
  });
});

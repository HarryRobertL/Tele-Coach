/**
 * Dev smoke test: runs selectCoachingPack against sample transcripts and logs results.
 * Validates the single source of truth path (playbook classifier → coaching_pack).
 * Run: npm run dev:smoke
 */

import { selectCoachingPack } from "../engine/response_engine/selector";

const SAMPLE_TRANSCRIPTS = [
  "I'm not interested right now.",
  "We already use Experian for that.",
  "Can you send me an email with more info?",
  "I'm really busy, call back later.",
  "We're tied into a contract with our current provider.",
  "Are you near a screen? I'd like to see what you can show me.",
  "Who are Creditsafe? How do you compare to D&B?",
  "We don't use credit checks, we just take payment upfront.",
  "No budget for this at the moment.",
  "Not interested at all, please remove me from your list."
];

function run(): void {
  console.log("🚀 Tele Coach Smoke Test - Single Source of Truth Validation");
  console.log("Testing selectCoachingPack with %d sample transcripts\n", SAMPLE_TRANSCRIPTS.length);
  
  let totalTests = 0;
  let passedTests = 0;
  
  for (let i = 0; i < SAMPLE_TRANSCRIPTS.length; i++) {
    const transcript = SAMPLE_TRANSCRIPTS[i]!;
    const pack = selectCoachingPack(transcript);
    
    console.log("--- Test %d ---", i + 1);
    console.log("  transcript:     %s", transcript);
    console.log("  objection_id:   %s", pack.objection_id);
    console.log("  confidence:     %s", pack.confidence.toFixed(2));
    console.log("  severity:       %s", pack.severity);
    console.log("  response:       %s", pack.response.slice(0, 60) + (pack.response.length > 60 ? "..." : ""));
    console.log("  question:       %s", pack.question.slice(0, 60) + (pack.question.length > 60 ? "..." : ""));
    console.log("  bridge:         %s", pack.bridge.slice(0, 60) + (pack.bridge.length > 60 ? "..." : ""));
    console.log("  momentum_level: %s", pack.momentum_level);
    console.log("  momentum_score: %d/100", pack.momentum_score);
    console.log("  momentum_reasons: [%s]", pack.momentum_reasons.join(", "));
    console.log("  timestamp:      %d", pack.timestamp);
    
    // Basic validations
    totalTests++;
    let testPassed = true;
    
    if (!pack.objection_id) {
      console.log("  ❌ Missing objection_id");
      testPassed = false;
    }
    
    if (pack.confidence < 0 || pack.confidence > 1) {
      console.log("  ❌ Invalid confidence range");
      testPassed = false;
    }
    
    if (!["soft", "medium", "hard"].includes(pack.severity)) {
      console.log("  ❌ Invalid severity");
      testPassed = false;
    }
    
    if (!pack.response || !pack.question || !pack.bridge) {
      console.log("  ❌ Empty response/question/bridge");
      testPassed = false;
    }
    
    if (!["low", "medium", "high"].includes(pack.momentum_level)) {
      console.log("  ❌ Invalid momentum_level");
      testPassed = false;
    }
    
    if (pack.momentum_score < 0 || pack.momentum_score > 100) {
      console.log("  ❌ Invalid momentum_score range");
      testPassed = false;
    }
    
    if (!Array.isArray(pack.momentum_reasons)) {
      console.log("  ❌ Invalid momentum_reasons type");
      testPassed = false;
    }
    
    if (testPassed) {
      console.log("  ✅ Test passed");
      passedTests++;
    } else {
      console.log("  ❌ Test failed");
    }
    
    console.log("");
  }
  
  console.log("📊 Smoke Test Results:");
  console.log("  Total tests: %d", totalTests);
  console.log("  Passed: %d", passedTests);
  console.log("  Failed: %d", totalTests - passedTests);
  console.log("  Success rate: %s%%", ((passedTests / totalTests) * 100).toFixed(1));
  
  if (passedTests === totalTests) {
    console.log("🎉 All tests passed! Single source of truth path validated.");
  } else {
    console.log("⚠️  Some tests failed. Check the output above for details.");
  }
  
  console.log("\n🏁 Smoke test complete.");
}

run();

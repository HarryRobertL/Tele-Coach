/**
 * Dev smoke test: runs selectCoachingPack against sample transcripts and logs results.
 * Run: npx tsx scripts/dev_smoke.ts
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
  console.log("Dev smoke: selectCoachingPack x %d transcripts\n", SAMPLE_TRANSCRIPTS.length);
  for (let i = 0; i < SAMPLE_TRANSCRIPTS.length; i++) {
    const transcript = SAMPLE_TRANSCRIPTS[i]!;
    const pack = selectCoachingPack(transcript);
    console.log("--- %d ---", i + 1);
    console.log("  objection id:    %s", pack.objection.id);
    console.log("  severity:        %s", pack.severity);
    console.log("  response:        %s", pack.response.slice(0, 60) + (pack.response.length > 60 ? "..." : ""));
    console.log("  question:        %s", pack.question.slice(0, 60) + (pack.question.length > 60 ? "..." : ""));
    console.log("  bridge:          %s", pack.bridge.slice(0, 60) + (pack.bridge.length > 60 ? "..." : ""));
    console.log("  momentum score:  %d (%s)", pack.momentum.score, pack.momentum.level);
    console.log("");
  }
  console.log("Smoke done.");
}

run();

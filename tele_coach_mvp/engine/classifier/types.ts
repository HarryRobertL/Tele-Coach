export type ObjectionId =
  | "unknown"
  | "not_interested"
  | "already_have_provider"
  | "send_email"
  | "no_budget"
  | "not_my_job"
  | "call_back_later"
  | "too_busy"
  | "bad_timing"
  | "rarely_do_checks"
  | "compliance_concern"
  | "price"
  | "contract";

export interface ObjectionClassification {
  objection_id: ObjectionId;
  confidence: number;
  matched_phrases: string[];
}

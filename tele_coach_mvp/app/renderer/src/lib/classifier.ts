export interface Suggestion {
  id: string;
  text: string;
  confidence: number;
}

export function classifyTranscript(_input: string): Suggestion[] {
  // TODO: Route transcript through local rule classifier + playbook.
  return [];
}

export interface PlaybookRule {
  id: string;
  trigger: string;
  suggestion: string;
}

export function loadDefaultPlaybook(): PlaybookRule[] {
  // TODO: Load from engine/playbooks/default_en.json through main-process API.
  return [];
}

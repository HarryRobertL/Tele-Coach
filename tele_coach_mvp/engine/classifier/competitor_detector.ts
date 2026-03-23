/**
 * Competitor Mention Detector
 * Detects mentions of competitor companies or generic existing providers in transcript text.
 */

export type CompetitorCategory = "named_competitor" | "generic_provider" | "none";

export interface CompetitorDetection {
  mentions: string[];
  hasCompetitor: boolean;
  category: CompetitorCategory;
}

interface CompetitorPattern {
  key: string;
  patterns: RegExp[];
}

function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAMED_COMPETITOR_PATTERNS: CompetitorPattern[] = [
  {
    key: "experian",
    patterns: [/\bexperian\b/i]
  },
  {
    key: "dnb",
    patterns: [
      /\bdnb\b/i,
      /\bd&b\b/i,
      /\bd and b\b/i,
      /\bdun and bradstreet\b/i
    ]
  },
  {
    key: "equifax",
    patterns: [/\bequifax\b/i]
  },
  {
    key: "graydon",
    patterns: [/\bgraydon\b/i]
  },
  {
    key: "company watch",
    patterns: [
      /\bcompany\s*watch\b/i,
      /\bcompanywatch\b/i
    ]
  },
  {
    key: "crif",
    patterns: [/\bcrif\b/i]
  },
  {
    key: "duedil",
    patterns: [
      /\bdue\s*dil\b/i,
      /\bdue\s*diligence\b/i
    ]
  }
];

const GENERIC_PROVIDER_PATTERNS: RegExp[] = [
  /\banother provider\b/i,
  /\bexisting provider\b/i,
  /\bwe already use someone else\b/i,
  /\bwe (already )?use (someone|somebody) else\b/i,
  /\bwe already have a provider\b/i,
  /\balready (have|use|using) (a|an|our)?\s*(provider|supplier|service)\b/i
];

export function detectCompetitors(text: string): CompetitorDetection {
  if (!text.trim()) {
    return {
      mentions: [],
      hasCompetitor: false,
      category: "none"
    };
  }

  const normalized = normalizeText(text);
  const mentionsSet = new Set<string>();

  for (const competitor of NAMED_COMPETITOR_PATTERNS) {
    for (const pattern of competitor.patterns) {
      if (pattern.test(normalized)) {
        mentionsSet.add(competitor.key);
        break;
      }
    }
  }

  const hasNamed = mentionsSet.size > 0;

  let hasGeneric = false;
  if (!hasNamed) {
    for (const pattern of GENERIC_PROVIDER_PATTERNS) {
      if (pattern.test(normalized)) {
        hasGeneric = true;
        break;
      }
    }
  }

  const mentions = Array.from(mentionsSet);

  if (hasNamed) {
    return {
      mentions,
      hasCompetitor: true,
      category: "named_competitor"
    };
  }

  if (hasGeneric) {
    return {
      mentions: [],
      hasCompetitor: true,
      category: "generic_provider"
    };
  }

  return {
    mentions: [],
    hasCompetitor: false,
    category: "none"
  };
}

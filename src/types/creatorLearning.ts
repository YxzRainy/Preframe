export type LearningSourceType = "shooting" | "publishing";
export type LearningFactStatus = "pending" | "confirmed" | "rejected";
export type LearningPatternStatus = "candidate" | "confirmed" | "rejected";
export type CreatorStrategyStatus = "active" | "retired";

export type LearningCategory =
  | "script"
  | "shooting"
  | "visual"
  | "workflow"
  | "audience"
  | "publishing"
  | "performance";

export interface LearningFact {
  id: string;
  sourceKey: string;
  sourceType: LearningSourceType;
  sourceProjectSlug: string;
  sourceProjectName: string;
  sourceRef: string;
  category: LearningCategory;
  text: string;
  status: LearningFactStatus;
  createdAt: string;
  decidedAt?: string;
}

export interface LearningPattern {
  id: string;
  patternKey: string;
  category: LearningCategory;
  statement: string;
  supportingFactIds: string[];
  supportingProjectSlugs: string[];
  status: LearningPatternStatus;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
}

export interface CreatorStrategy {
  id: string;
  patternId: string;
  category: LearningCategory;
  statement: string;
  supportingFactIds: string[];
  status: CreatorStrategyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorLearningStore {
  version: 1;
  facts: LearningFact[];
  patterns: LearningPattern[];
  strategies: CreatorStrategy[];
  lastScannedAt?: string;
}

export interface CreatorLearningSummary extends CreatorLearningStore {
  counts: {
    pendingFacts: number;
    confirmedFacts: number;
    candidatePatterns: number;
    activeStrategies: number;
  };
}

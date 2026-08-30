export type ContentAtomKind = "viewpoint" | "case" | "hook" | "audience-question" | "result" | "strategy";

export interface ContentAtom {
  id: string;
  fingerprint: string;
  kind: ContentAtomKind;
  text: string;
  sourceProjectSlug?: string;
  sourceProjectName?: string;
  sourceFile?: string;
  sourceSection?: string;
  platform?: string;
  domain?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ContentTopicNode {
  id: string;
  label: string;
  atomCount: number;
  projectCount: number;
  projectSlugs: string[];
  kinds: Partial<Record<ContentAtomKind, number>>;
}

export interface ContentAssetSuggestion {
  id: string;
  title: string;
  note: string;
  tags: string[];
  rationale: string;
  sourceAtomIds: string[];
}

export interface ContentAssetReadiness {
  ready: boolean;
  projectCount: number;
  atomCount: number;
  activeStrategyCount: number;
  minimumProjects: number;
  minimumAtoms: number;
  reason: string;
}

export interface ContentAssetStore {
  version: 1;
  atoms: ContentAtom[];
  topics: ContentTopicNode[];
  suggestions: ContentAssetSuggestion[];
  readiness: ContentAssetReadiness;
  lastBuiltAt?: string;
}

export interface ContentAssetAssembly {
  query: string;
  viewpoints: ContentAtom[];
  cases: ContentAtom[];
  hooks: ContentAtom[];
  audienceQuestions: ContentAtom[];
  results: ContentAtom[];
  strategies: ContentAtom[];
  sourceProjects: Array<{ slug: string; name: string }>;
  suggestions: ContentAssetSuggestion[];
}

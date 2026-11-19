export type Stage = "direction" | "spec";
export type View = "find" | Stage | "delivery";

export type ChatMessage = { role: "agent" | "user"; text: string };

export type DirectionDoc = {
  oneLine: string;
  usersSituation: string;
  problemAlternatives: string;
  promisedChange: string;
  coreLoop: string;
};

export type SpecDoc = {
  result: string;
  scope: string[];
  verification: string[];
  notNow: string;
};

export type DocFor<S extends Stage> = S extends "direction" ? DirectionDoc : SpecDoc;

export type AgentReply<S extends Stage = Stage> = {
  message: string;
  doc: Partial<DocFor<S>>;
};

export type StageState<D> = { messages: ChatMessage[]; doc: D; done: boolean };

export type DeliveryStep = "generate" | "repo" | "push" | "project" | "database" | "deploy" | "verify";

export type DeliveryErrorCode = "github-auth" | "vercel-auth" | "vercel-git" | "neon-missing" | "name-taken" | "build" | "unsupported" | "failed";

export type DeliveryState = {
  repoName: string;
  confirmed: boolean;
  running: DeliveryStep | null;
  done: DeliveryStep[];
  repoUrl: string | null;
  repoId: number | null;
  owner: string | null;
  projectId: string | null;
  needsDatabase: boolean;
  databaseId: string | null;
  deployUrl: string | null;
  deploymentId: string | null;
  verified: boolean;
  fixAttempts: number;
  error: { step: DeliveryStep; code: DeliveryErrorCode; message: string } | null;
  interrupted: boolean;
  files: Record<string, string> | null;
};

export type Progress = {
  view: View;
  projectName: string;
  idea: string | null;
  findDone: boolean;
  direction: StageState<DirectionDoc>;
  spec: StageState<SpecDoc>;
  review: { 2: boolean; 3: boolean; 4: boolean };
  delivery: DeliveryState;
  changeNote: string;
  finished: boolean;
  fresh: string[];
};

export type Connection = { apiKey: string; endpoint: string; deployment: string };

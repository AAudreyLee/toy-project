export type Stage = "direction" | "spec";
export type View = "find" | Stage;

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

export type Progress = {
  view: View;
  projectName: string;
  idea: string | null;
  findDone: boolean;
  direction: StageState<DirectionDoc>;
  spec: StageState<SpecDoc>;
  review: { 2: boolean; 3: boolean };
  changeNote: string;
  finished: boolean;
  fresh: string[];
};

export type Connection = { apiKey: string; endpoint: string; deployment: string };

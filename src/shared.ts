export type AdapterId = "cursor" | "claude" | "copilot" | "codex" | "aider";
export type Mode = "agent" | "plan" | "ask";
export type Permission = "ask" | "auto" | "yolo";

export type AdapterStatus = {
  id: AdapterId;
  name: string;
  bin: string | null;
  install: string;
  site: string;
  hasLogin: boolean;
  loggedIn: boolean | null;
  protocol: "acp" | "headless";
  models: string[];
  model: string | null;
};

export type TodoItem = { id: string; content: string; status: string };

export type PermOption = { optionId: string; name: string };
export type PermQuestion = { id: string; prompt: string; options: PermOption[] };

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thought"; text: string }
  | { type: "activity"; text: string }
  | { type: "tool_start"; id: string; name: string; detail?: string }
  | { type: "tool_end"; id: string; name: string; detail?: string }
  | { type: "todo"; items: TodoItem[]; plan?: string }
  | {
      type: "permission";
      requestId: string;
      title: string;
      kind?: "tool" | "question" | "plan";
      detail?: string;
      options: PermOption[];
      questions?: PermQuestion[];
    }
  | { type: "done"; sessionId?: string; cost?: number }
  | { type: "error"; message: string }
  | { type: "log"; text: string };

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type Skill = {
  id: string;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
};

export type PermDecision = {
  optionId: string;
  answers?: { questionId: string; selectedOptionIds: string[] }[];
};

export type ClientMsg =
  | { type: "hello" }
  | { type: "setWorkspace"; path: string }
  | { type: "detect" }
  | { type: "login"; adapterId: AdapterId }
  | { type: "openSite"; adapterId: AdapterId }
  | { type: "prompt"; adapterId: AdapterId; text: string; mode: Mode; permission: Permission; model?: string }
  | { type: "setModel"; adapterId: AdapterId; model: string }
  | { type: "permission"; requestId: string; optionId: string; answers?: PermDecision["answers"] }
  | { type: "cancel" }
  | { type: "ls"; path: string }
  | { type: "saveMemory"; text: string }
  | { type: "toggleSkill"; id: string; enabled: boolean };

export type ServerMsg =
  | {
      type: "status";
      adapters: AdapterStatus[];
      workspace: string;
      memory: string;
      skills: Skill[];
      chat: ChatTurn[];
      home: string;
      recent: string[];
      error?: string;
    }
  | { type: "event"; event: StreamEvent }
  | { type: "diff"; status: string; patch: string }
  | { type: "ls"; path: string; dirs: string[]; parent: string | null };

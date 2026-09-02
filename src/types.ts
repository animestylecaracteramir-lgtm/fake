export interface ToolMetadata {
  name: string;
  description: string;
  version: string;
  entrypoint?: string;
  category: 'web' | 'python' | 'environment' | 'file' | 'agent' | 'memory' | 'validation' | 'v2ray' | 'custom';
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
  returns?: Record<string, any>;
  created_at: string;
  last_tested?: string;
  status: 'active' | 'deprecated' | 'testing' | 'error';
  dependencies: string[];
  is_custom?: boolean;
  code?: string;
}

export interface ToolResult {
  success: boolean;
  data: any;
  error: {
    type: string;
    message: string;
    details?: string;
  } | null;
  metadata?: {
    duration_ms?: number;
    tool_name?: string;
    timestamp?: string;
    version?: string;
  };
}

export interface AgentAction {
  id: string;
  timestamp: string;
  type: 'plan' | 'tool_call' | 'tool_result' | 'reasoning' | 'strategy_change' | 'diagnosis' | 'repair' | 'verify' | 'output_export' | 'complete' | 'error';
  tool?: string;
  arguments?: Record<string, any>;
  result?: ToolResult;
  message?: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'info';
  duration_ms?: number;
}

export interface ArtifactMetadata {
  filename: string;
  path: string;
  type: 'json' | 'python' | 'markdown' | 'yaml' | 'text' | 'v2ray_config';
  goal: string;
  created_at: string;
  validated: boolean;
  validation_result: string;
  source: 'generated' | 'repaired' | 'custom_tool';
  version: string;
  size_bytes?: number;
  content_preview?: string;
  share_link?: string;
}

export interface AgentState {
  goal: string;
  status: 'idle' | 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
  currentObjective: string;
  currentPlan: string[];
  currentStrategy: string;
  strategyAttemptCount: number;
  completedActions: AgentAction[];
  pendingActions: string[];
  iterationCount: number;
  maxIterations: number;
  toolHistory: Array<{ tool: string; args: any; success: boolean; timestamp: string }>;
  errors: Array<{ message: string; tool?: string; timestamp: string; diagnosed_cause?: string }>;
  experiments: string[];
  artifacts: ArtifactMetadata[];
  validationStatus: {
    isVerified: boolean;
    verificationCriteria?: string;
    verificationOutput?: string;
    timestamp?: string;
  };
  stuckDiagnosis?: {
    isStuck: boolean;
    reason?: string;
    suggestedAction?: string;
  };
  startTime?: string;
  endTime?: string;
}

export interface LLMSettings {
  provider: 'openai_compatible';
  baseURL: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  maxRetries?: number;
}

export interface TestResultItem {
  id: number;
  name: string;
  category: string;
  passed: boolean;
  durationMs: number;
  details: string;
  error?: string;
}

export interface TestSuiteSummary {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  timestamp: string;
  results: TestResultItem[];
}

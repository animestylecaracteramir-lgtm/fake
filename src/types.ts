export type PermissionScope =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'process.execute'
  | 'network.read'
  | 'network.write'
  | 'memory.read'
  | 'memory.write';

export type ToolStatus = 'candidate' | 'testing' | 'active' | 'deprecated' | 'quarantined';
export type ToolHealthStatus = 'healthy' | 'degraded' | 'failing' | 'quarantined';

export interface ToolQualityMetrics {
  successRate: number;
  usageCount: number;
  failureCount: number;
  evaluationScore: number;
  avgLatencyMs: number;
  health: ToolHealthStatus;
  lastTestedAt?: string;
  consecutiveFailures: number;
}

export interface ToolMetadata {
  name: string;
  description: string;
  version: string;
  entrypoint?: string;
  category: 'web' | 'python' | 'environment' | 'file' | 'agent' | 'memory' | 'validation' | 'v2ray' | 'custom' | 'learning';
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
  returns?: Record<string, any>;
  created_at: string;
  last_tested?: string;
  status: ToolStatus;
  dependencies: string[];
  is_custom?: boolean;
  code?: string;
  permissions?: PermissionScope[];
  quality?: ToolQualityMetrics;
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
    evaluationScore?: number;
    [key: string]: any;
  };
}

export type MemoryCategory = 'episodic' | 'semantic' | 'procedural' | 'failure' | 'tool';
export type PromotionLevel = 'observed' | 'repeated' | 'confirmed' | 'trusted';

export interface ExperienceRecord {
  id: string;
  category: MemoryCategory;
  taskType: string;
  taskSignature: string;
  goal: string;
  strategy: string;
  toolsUsed: string[];
  conditions: Record<string, any>;
  result: 'success' | 'failure' | 'partial';
  evaluationScore: number;
  evaluationDetails?: string;
  evidence: string[];
  failureReason?: string;
  recoveryStrategy?: string;
  promotionLevel: PromotionLevel;
  confidence: number;
  occurrences: number;
  lastObservedAt: string;
  lesson: string;
  invalidated?: boolean;
  invalidationReason?: string;
}

export interface NegativeKnowledge {
  id: string;
  strategyOrTool: string;
  failedUnderConditions: Record<string, any>;
  failureType: string;
  reason: string;
  suggestedAlternative: string;
  observedCount: number;
  confidence: number;
  evidence: string[];
  lastObservedAt: string;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  description: string;
  applicableConditions: string[];
  knownSuccessPatterns: string[];
  knownFailurePatterns: string[];
  recommendedAlternatives: string[];
  requiredCapabilities: string[];
  successCount: number;
  failureCount: number;
  avgEvaluationScore: number;
  costMetric: {
    avgDurationMs: number;
    estimatedTokenCost: number;
    riskLevel: 'low' | 'medium' | 'high';
  };
  status: 'active' | 'experimental' | 'deprecated';
  lastUpdated: string;
}

export interface EvaluationReport {
  id: string;
  targetId: string;
  targetType: 'tool' | 'strategy' | 'artifact' | 'task_result';
  layers: {
    structural: number;
    semantic: number;
    behavioral: number;
    runtime: number;
    taskLevel: number;
  };
  overallScore: number;
  passed: boolean;
  deterministicChecks: Array<{
    name: string;
    passed: boolean;
    details: string;
  }>;
  evidence: string[];
  summary: string;
  evaluatedAt: string;
  evaluatorVersion: string;
}

export interface AgentAction {
  id: string;
  timestamp: string;
  type: 'plan' | 'tool_call' | 'tool_result' | 'reasoning' | 'strategy_change' | 'diagnosis' | 'repair' | 'verify' | 'output_export' | 'complete' | 'error' | 'capability_gap' | 'self_evolution' | 'evaluation';
  tool?: string;
  arguments?: Record<string, any>;
  result?: ToolResult;
  message?: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'info';
  duration_ms?: number;
  evaluation?: EvaluationReport;
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

export type ExecutionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'verifying'
  | 'verified'
  | 'completing'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'stuck';

export interface AgentState {
  goal: string;
  status: ExecutionStatus;
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
    score?: number;
  };
  stuckDiagnosis?: {
    isStuck: boolean;
    reason?: string;
    suggestedAction?: string;
  };
  completionReason?: string;
  completionEvidence?: string[];
  verificationLevel?: string;
  terminalAt?: string;
  postCompletionExecutionAttempts: number;
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

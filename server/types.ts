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

export interface ToolParameterSchema {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
  properties?: Record<string, any>;
  required?: string[];
}

export interface ToolMetadata {
  name: string;
  description: string;
  version: string;
  entrypoint?: string;
  category: 'web' | 'python' | 'environment' | 'file' | 'agent' | 'memory' | 'validation' | 'v2ray' | 'custom' | 'learning';
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameterSchema>;
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
  previousVersions?: string[];
  capabilities?: string[];
}

export interface ToolResult<T = any> {
  success: boolean;
  data: T | null;
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

export interface ProvenanceRecord {
  createdBy: string;
  timestamp: string;
  verifiedBy?: string;
  evidenceIds: string[];
  context?: Record<string, any>;
}

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
  evaluationScore: number; // 0.00 to 1.00
  evaluationDetails?: string;
  evidence: string[]; // execution/action IDs
  failureReason?: string;
  recoveryStrategy?: string;
  promotionLevel: PromotionLevel;
  confidence: number; // 0.00 to 1.00
  occurrences: number;
  lastObservedAt: string;
  provenance: ProvenanceRecord;
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

export interface CapabilityGap {
  requiredCapability: string;
  currentCapabilities: string[];
  missingAspect: string;
  taskType: string;
  suggestedToolName: string;
  expectedBenefit: string;
  permissionsRequired: PermissionScope[];
}

export interface EvaluationReport {
  id: string;
  targetId: string;
  targetType: 'tool' | 'strategy' | 'artifact' | 'task_result';
  layers: {
    structural: number; // 0.0 - 1.0
    semantic: number;   // 0.0 - 1.0
    behavioral: number; // 0.0 - 1.0
    runtime: number;    // 0.0 - 1.0
    taskLevel: number;  // 0.0 - 1.0
  };
  overallScore: number; // 0.00 - 1.00
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
  activeLearningInsights?: {
    retrievedExperiencesCount: number;
    avoidedFailuresCount: number;
    recommendedStrategy?: string;
    capabilityGapsIdentified: string[];
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

export interface LogEntry {
  timestamp: string;
  sessionId: string;
  action: string;
  tool?: string;
  argumentsSanitized?: any;
  resultSuccess?: boolean;
  durationMs?: number;
  error?: string;
  status: string;
}

export interface ExperimentRecord {
  id: string;
  goal: string;
  date: string;
  strategy: string;
  tools_used: string[];
  commands_executed: string[];
  dependencies_installed: string[];
  experiments: Array<{
    attempt: number;
    action: string;
    tool: string;
    input: any;
    output?: any;
    error?: string;
    result: string;
  }>;
  errors: string[];
  solutions: string[];
  final_result: any;
  validation_result: {
    verified: boolean;
    criteria: string;
    details?: string;
  };
  important_discoveries: string[];
}

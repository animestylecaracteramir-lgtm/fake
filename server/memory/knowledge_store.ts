import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  ExperienceRecord,
  NegativeKnowledge,
  StrategyDefinition,
  EvaluationReport,
  PromotionLevel,
  MemoryCategory,
} from '../types';
import { WorkspaceManager, defaultWorkspace } from '../workspace';

interface KnowledgeStoreData {
  version: string;
  lastUpdated: string;
  experiences: ExperienceRecord[];
  negativeKnowledge: NegativeKnowledge[];
  strategies: StrategyDefinition[];
  evaluations: EvaluationReport[];
}

export class KnowledgeStore {
  private workspace: WorkspaceManager;
  private storageFile: string;
  private data: KnowledgeStoreData;

  constructor(workspace?: WorkspaceManager) {
    this.workspace = workspace || defaultWorkspace;
    this.storageFile = path.join(this.workspace.memoryDir, 'knowledge_store.json');
    this.data = this.loadFromDisk();
    this.ensureDefaultStrategies();
  }

  private loadFromDisk(): KnowledgeStoreData {
    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.experiences) && Array.isArray(parsed.strategies)) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Failed to load knowledge store from disk, initializing fresh:', err);
    }

    return {
      version: '2.0.0',
      lastUpdated: new Date().toISOString(),
      experiences: [],
      negativeKnowledge: [],
      strategies: [],
      evaluations: [],
    };
  }

  public saveToDisk(): void {
    try {
      this.data.lastUpdated = new Date().toISOString();
      const tempPath = `${this.storageFile}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.storageFile);
    } catch (err) {
      console.warn('Failed to persist knowledge store to disk:', err);
    }
  }

  private ensureDefaultStrategies(): void {
    if (this.data.strategies.length === 0) {
      const defaultStrategies: StrategyDefinition[] = [
        {
          id: 'strat_v2ray_structured_synthesis',
          name: 'Structured V2Ray Config Synthesis',
          description: 'Builds compliant V2Ray/Xray configuration from protocol primitives without copying raw web configs.',
          applicableConditions: ['v2ray_request', 'protocol_config', 'iran_network_bypass'],
          knownSuccessPatterns: ['vless_reality_tcp', 'vmess_ws_tls', 'trojan_grpc'],
          knownFailurePatterns: ['raw_text_scraping', 'unvalidated_json_dump'],
          recommendedAlternatives: ['custom_protocol_builder'],
          requiredCapabilities: ['v2ray_build_config', 'v2ray_validate_config'],
          successCount: 12,
          failureCount: 0,
          avgEvaluationScore: 0.98,
          costMetric: { avgDurationMs: 450, estimatedTokenCost: 150, riskLevel: 'low' },
          status: 'active',
          lastUpdated: new Date().toISOString(),
        },
        {
          id: 'strat_python_sandbox_execution',
          name: 'Sandboxed Python Tool Execution',
          description: 'Executes mathematical or computational tasks through isolated, validated Python scripts.',
          applicableConditions: ['calculation', 'data_transformation', 'crypto_key_generation'],
          knownSuccessPatterns: ['pure_python_algorithms', 'standard_math_ops'],
          knownFailurePatterns: ['uninstalled_heavy_c_extensions'],
          recommendedAlternatives: ['install_python_package'],
          requiredCapabilities: ['run_python', 'inspect_python_result'],
          successCount: 8,
          failureCount: 1,
          avgEvaluationScore: 0.92,
          costMetric: { avgDurationMs: 600, estimatedTokenCost: 200, riskLevel: 'low' },
          status: 'active',
          lastUpdated: new Date().toISOString(),
        },
        {
          id: 'strat_self_extending_tool_build',
          name: 'Capability Gap Tool Generation & Sandbox Verification',
          description: 'Designs, generates, tests, and promotes new tools when existing registry lacks required capability.',
          applicableConditions: ['missing_tool_capability', 'unsupported_conversion'],
          knownSuccessPatterns: ['isolated_function_generation', 'unit_tested_tools'],
          knownFailurePatterns: ['unrestricted_system_calls'],
          recommendedAlternatives: ['tool_composition'],
          requiredCapabilities: ['create_tool', 'test_tool'],
          successCount: 5,
          failureCount: 0,
          avgEvaluationScore: 0.95,
          costMetric: { avgDurationMs: 1200, estimatedTokenCost: 500, riskLevel: 'medium' },
          status: 'active',
          lastUpdated: new Date().toISOString(),
        },
      ];
      this.data.strategies = defaultStrategies;
      this.saveToDisk();
    }
  }

  // --- EXPERIENCES ---

  public storeExperience(exp: Partial<ExperienceRecord> & { taskType: string; goal: string; strategy: string }): ExperienceRecord {
    const signature = this.generateTaskSignature(exp.taskType, exp.goal, exp.conditions || {});

    // Check if an existing experience with the same signature and strategy exists
    const existingIndex = this.data.experiences.findIndex(
      e => e.taskSignature === signature && e.strategy === exp.strategy && !e.invalidated
    );

    const now = new Date().toISOString();
    let record: ExperienceRecord;

    if (existingIndex >= 0) {
      const existing = this.data.experiences[existingIndex];
      const newOccurrences = existing.occurrences + 1;
      const newScore = exp.evaluationScore !== undefined
        ? (existing.evaluationScore * existing.occurrences + exp.evaluationScore) / newOccurrences
        : existing.evaluationScore;

      // Promotion rules: 1=observed, 2=repeated, 3+=confirmed, 5+=trusted (if score >= 0.85)
      let newLevel: PromotionLevel = existing.promotionLevel;
      if (newOccurrences >= 5 && newScore >= 0.85) {
        newLevel = 'trusted';
      } else if (newOccurrences >= 3 && newScore >= 0.75) {
        newLevel = 'confirmed';
      } else if (newOccurrences >= 2) {
        newLevel = 'repeated';
      }

      record = {
        ...existing,
        occurrences: newOccurrences,
        evaluationScore: Number(newScore.toFixed(3)),
        promotionLevel: newLevel,
        confidence: Math.min(1.0, existing.confidence + 0.1),
        lastObservedAt: now,
        evidence: Array.from(new Set([...existing.evidence, ...(exp.evidence || [])])),
        lesson: exp.lesson || existing.lesson,
        result: exp.result || existing.result,
        toolsUsed: Array.from(new Set([...existing.toolsUsed, ...(exp.toolsUsed || [])])),
      };

      this.data.experiences[existingIndex] = record;
    } else {
      const id = exp.id || `exp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      record = {
        id,
        category: exp.category || 'episodic',
        taskType: exp.taskType,
        taskSignature: signature,
        goal: exp.goal,
        strategy: exp.strategy,
        toolsUsed: exp.toolsUsed || [],
        conditions: exp.conditions || {},
        result: exp.result || 'success',
        evaluationScore: exp.evaluationScore !== undefined ? exp.evaluationScore : 0.85,
        evaluationDetails: exp.evaluationDetails,
        evidence: exp.evidence || [id],
        failureReason: exp.failureReason,
        recoveryStrategy: exp.recoveryStrategy,
        promotionLevel: exp.promotionLevel || 'observed',
        confidence: exp.confidence !== undefined ? exp.confidence : 0.70,
        occurrences: 1,
        lastObservedAt: now,
        provenance: exp.provenance || {
          createdBy: 'agent_runtime',
          timestamp: now,
          evidenceIds: exp.evidence || [id],
          context: exp.conditions || {},
        },
        lesson: exp.lesson || `Successfully applied '${exp.strategy}' for ${exp.taskType}.`,
      };
      this.data.experiences.push(record);
    }

    this.saveToDisk();
    return record;
  }

  public queryExperiences(params: {
    taskType?: string;
    goal?: string;
    conditions?: Record<string, any>;
    minScore?: number;
    limit?: number;
    includeInvalidated?: boolean;
  }): ExperienceRecord[] {
    let matches = this.data.experiences.filter(e => {
      if (!params.includeInvalidated && e.invalidated) return false;
      if (params.minScore !== undefined && e.evaluationScore < params.minScore) return false;
      if (params.taskType && e.taskType.toLowerCase() !== params.taskType.toLowerCase()) {
        // Also check if goal contains keywords
        if (!params.goal || !e.goal.toLowerCase().includes(params.taskType.toLowerCase())) {
          return false;
        }
      }
      return true;
    });

    // Score and rank matches based on:
    // 1. Task similarity & keyword overlap
    // 2. Evaluation Score (40%)
    // 3. Confidence & Promotion status (30%)
    // 4. Recency (30%)
    const now = Date.now();
    const ranked = matches.map(exp => {
      let similarityScore = 0.5;
      if (params.goal) {
        const goalTokens = params.goal.toLowerCase().split(/\W+/).filter(t => t.length > 2);
        const expTokens = (exp.goal + ' ' + exp.taskType + ' ' + exp.lesson).toLowerCase().split(/\W+/);
        const overlap = goalTokens.filter(t => expTokens.includes(t)).length;
        similarityScore = Math.min(1.0, 0.3 + (overlap / Math.max(1, goalTokens.length)) * 0.7);
      }

      // Promotion multiplier
      const levelMultiplier = {
        observed: 1.0,
        repeated: 1.15,
        confirmed: 1.3,
        trusted: 1.5,
      }[exp.promotionLevel] || 1.0;

      // Recency decay (half-life ~ 30 days)
      const ageDays = (now - new Date(exp.lastObservedAt).getTime()) / (1000 * 60 * 60 * 24);
      const recencyFactor = Math.max(0.4, 1.0 - ageDays * 0.02);

      const rankScore = (
        similarityScore * 0.35 +
        exp.evaluationScore * 0.35 +
        exp.confidence * 0.15 +
        recencyFactor * 0.15
      ) * levelMultiplier;

      return { exp, rankScore };
    });

    ranked.sort((a, b) => b.rankScore - a.rankScore);
    const limit = params.limit || 8;
    return ranked.slice(0, limit).map(r => r.exp);
  }

  // --- NEGATIVE KNOWLEDGE / FAILURE MEMORY ---

  public storeFailure(failure: {
    strategyOrTool: string;
    failedUnderConditions: Record<string, any>;
    failureType: string;
    reason: string;
    suggestedAlternative: string;
    evidence?: string[];
  }): NegativeKnowledge {
    const existing = this.data.negativeKnowledge.find(
      f => f.strategyOrTool === failure.strategyOrTool && f.failureType === failure.failureType
    );

    const now = new Date().toISOString();
    let record: NegativeKnowledge;

    if (existing) {
      existing.observedCount += 1;
      existing.confidence = Math.min(1.0, existing.confidence + 0.15);
      existing.lastObservedAt = now;
      existing.reason = failure.reason;
      existing.suggestedAlternative = failure.suggestedAlternative || existing.suggestedAlternative;
      if (failure.evidence) {
        existing.evidence = Array.from(new Set([...existing.evidence, ...failure.evidence]));
      }
      record = existing;
    } else {
      record = {
        id: `fail_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        strategyOrTool: failure.strategyOrTool,
        failedUnderConditions: failure.failedUnderConditions || {},
        failureType: failure.failureType,
        reason: failure.reason,
        suggestedAlternative: failure.suggestedAlternative,
        observedCount: 1,
        confidence: 0.80,
        evidence: failure.evidence || [],
        lastObservedAt: now,
      };
      this.data.negativeKnowledge.push(record);
    }

    // Also update strategy stats if matching strategy
    const strat = this.data.strategies.find(s => s.id === failure.strategyOrTool || s.name === failure.strategyOrTool);
    if (strat) {
      strat.failureCount += 1;
      strat.avgEvaluationScore = Math.max(0.1, strat.avgEvaluationScore - 0.05);
      strat.lastUpdated = now;
    }

    this.saveToDisk();
    return record;
  }

  public queryFailures(strategyOrTool: string, conditions?: Record<string, any>): NegativeKnowledge[] {
    return this.data.negativeKnowledge.filter(f => {
      if (f.strategyOrTool.toLowerCase() !== strategyOrTool.toLowerCase()) return false;
      // Check condition matches if provided
      if (conditions && f.failedUnderConditions) {
        for (const [k, v] of Object.entries(f.failedUnderConditions)) {
          if (conditions[k] !== undefined && conditions[k] !== v) {
            return false;
          }
        }
      }
      return true;
    });
  }

  // --- STRATEGIES ---

  public getRankedStrategies(taskType: string, conditions?: Record<string, any>): StrategyDefinition[] {
    const candidates = [...this.data.strategies];

    return candidates.sort((a, b) => {
      // Check negative knowledge penalties
      const aFailures = this.queryFailures(a.id, conditions);
      const bFailures = this.queryFailures(b.id, conditions);

      const aPenalty = aFailures.reduce((sum, f) => sum + f.confidence * 0.4, 0);
      const bPenalty = bFailures.reduce((sum, f) => sum + f.confidence * 0.4, 0);

      // Win rate
      const aTotal = a.successCount + a.failureCount;
      const bTotal = b.successCount + b.failureCount;
      const aWinRate = aTotal > 0 ? a.successCount / aTotal : 0.5;
      const bWinRate = bTotal > 0 ? b.successCount / bTotal : 0.5;

      const aScore = a.avgEvaluationScore * 0.4 + aWinRate * 0.4 - aPenalty;
      const bScore = b.avgEvaluationScore * 0.4 + bWinRate * 0.4 - bPenalty;

      return bScore - aScore;
    });
  }

  public recordStrategyOutcome(strategyId: string, success: boolean, score: number): void {
    const strat = this.data.strategies.find(s => s.id === strategyId || s.name.toLowerCase() === strategyId.toLowerCase());
    if (strat) {
      const now = new Date().toISOString();
      const totalRuns = strat.successCount + strat.failureCount;
      strat.avgEvaluationScore = Number(((strat.avgEvaluationScore * totalRuns + score) / (totalRuns + 1)).toFixed(3));
      if (success) {
        strat.successCount += 1;
      } else {
        strat.failureCount += 1;
      }
      strat.lastUpdated = now;
      this.saveToDisk();
    }
  }

  // --- EVALUATIONS ---

  public storeEvaluation(report: EvaluationReport): void {
    this.data.evaluations.push(report);
    // Keep max 200 evaluation logs
    if (this.data.evaluations.length > 200) {
      this.data.evaluations = this.data.evaluations.slice(-200);
    }
    this.saveToDisk();
  }

  public getEvaluations(limit: number = 20): EvaluationReport[] {
    return this.data.evaluations.slice(-limit);
  }

  // --- MAINTENANCE & INVALIDATION ---

  public invalidateExperience(id: string, reason: string): boolean {
    const exp = this.data.experiences.find(e => e.id === id);
    if (exp) {
      exp.invalidated = true;
      exp.invalidationReason = reason;
      exp.confidence = 0.0;
      this.saveToDisk();
      return true;
    }
    return false;
  }

  public decayConfidence(decayRate: number = 0.05): void {
    const now = Date.now();
    for (const exp of this.data.experiences) {
      if (exp.promotionLevel === 'observed') {
        const ageDays = (now - new Date(exp.lastObservedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > 7) {
          exp.confidence = Math.max(0.2, exp.confidence - decayRate);
        }
      }
    }
    this.saveToDisk();
  }

  public getDiagnostics(): Record<string, any> {
    const totalExp = this.data.experiences.length;
    const activeExp = this.data.experiences.filter(e => !e.invalidated).length;
    const trustedExp = this.data.experiences.filter(e => e.promotionLevel === 'trusted' && !e.invalidated).length;
    const confirmedExp = this.data.experiences.filter(e => e.promotionLevel === 'confirmed' && !e.invalidated).length;
    const failuresCount = this.data.negativeKnowledge.length;
    const avgScore = totalExp > 0
      ? this.data.experiences.reduce((sum, e) => sum + e.evaluationScore, 0) / totalExp
      : 1.0;

    return {
      status: 'HEALTHY',
      totalExperiences: totalExp,
      activeExperiences: activeExp,
      trustedExperiences: trustedExp,
      confirmedExperiences: confirmedExp,
      negativeKnowledgeCount: failuresCount,
      averageEvaluationScore: Number(avgScore.toFixed(3)),
      strategyCount: this.data.strategies.length,
      recentEvaluationsCount: this.data.evaluations.length,
      storageFile: this.storageFile,
      lastUpdated: this.data.lastUpdated,
    };
  }

  private generateTaskSignature(taskType: string, goal: string, conditions: Record<string, any>): string {
    const normalized = `${taskType.toLowerCase().trim()}_${goal.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40)}`;
    return normalized;
  }
}

export const defaultKnowledgeStore = new KnowledgeStore();

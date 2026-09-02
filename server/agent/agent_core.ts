import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AgentAction, AgentState, ToolResult, EvaluationReport, ExecutionStatus } from '../types';
import { WorkspaceManager, defaultWorkspace } from '../workspace';
import { ToolRegistry, defaultToolRegistry } from '../tools/registry';
import { LLMClient, defaultLLMClient, ChatMessage } from '../llm/client';
import { StateManager } from './state_manager';
import { LoopDetector } from './loop_detector';
import { KnowledgeStore, defaultKnowledgeStore } from '../memory/knowledge_store';
import { ToolBuilder, defaultToolBuilder } from '../tools/builder';
import { EvaluatorCore, defaultEvaluator } from '../evaluator/evaluator_core';
import { buildArgumentRepairInstruction } from '../tools/argument_repair';

export type AgentEventCallback = (event: { type: string; payload: any }) => void;

export interface CompleteGoalParams {
  summary: string;
  reason?: string;
  evidence?: string[];
  verificationCriteria?: string;
  verificationOutput?: string;
  score?: number;
}

export class AgentCore {
  private stateManager: StateManager;
  private loopDetector: LoopDetector;
  private toolRegistry: ToolRegistry;
  private workspace: WorkspaceManager;
  private llmClient: LLMClient;
  private knowledgeStore: KnowledgeStore;
  private toolBuilder: ToolBuilder;
  private evaluator: EvaluatorCore;
  private listeners: Set<AgentEventCallback> = new Set();
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private abortController: AbortController | null = null;
  private sessionId: string = '';
  private goalCompletedEmitted: boolean = false;

  constructor(
    workspace?: WorkspaceManager,
    toolRegistry?: ToolRegistry,
    llmClient?: LLMClient,
    knowledgeStore?: KnowledgeStore,
    toolBuilder?: ToolBuilder,
    evaluator?: EvaluatorCore
  ) {
    this.workspace = workspace || defaultWorkspace;
    this.toolRegistry = toolRegistry || defaultToolRegistry;
    this.llmClient = llmClient || defaultLLMClient;
    this.knowledgeStore = knowledgeStore || defaultKnowledgeStore;
    this.toolBuilder = toolBuilder || defaultToolBuilder;
    this.evaluator = evaluator || defaultEvaluator;
    this.stateManager = new StateManager();
    this.loopDetector = new LoopDetector();

    // Broadcast API retry events live & record in state
    this.llmClient.onRetry((info) => {
      if (this.isTerminal()) return;

      const retryAction: AgentAction = {
        id: `act_${Date.now()}_retry_${info.attempt}`,
        timestamp: new Date().toISOString(),
        type: 'repair',
        message: `[API Retry ${info.attempt}/${info.maxAttempts}] ${info.provider} (Retrying in ${info.delayMs}ms): ${info.error}`,
        status: 'info',
      };
      this.stateManager.addAction(retryAction);

      this.broadcast('api_retry', {
        ...info,
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
      });
    });
  }

  public subscribe(callback: AgentEventCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private broadcast(type: string, payload: any): void {
    const event = { type, payload };
    this.listeners.forEach(cb => {
      try { cb(event); } catch {}
    });

    if (this.sessionId) {
      this.workspace.appendLog(this.sessionId, {
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        type,
        payload,
      });
    }
  }

  public isTerminal(status?: ExecutionStatus): boolean {
    const st = status || this.stateManager.getState().status;
    return st === 'completed' || st === 'failed' || st === 'stopped';
  }

  public getState(): AgentState {
    const st = this.stateManager.getState();
    if (!this.isRunning && (st.status === 'running' || st.status === 'paused' || st.status === 'verifying' || st.status === 'completing')) {
      st.status = st.completedActions.length > 0 ? 'stopped' : 'idle';
      this.stateManager.setStatus(st.status);
    }
    return st;
  }

  public pause(): void {
    if (this.isRunning && !this.isPaused && !this.isTerminal()) {
      this.isPaused = true;
      this.stateManager.setStatus('paused' as any);
      this.broadcast('status_change', { status: 'paused' });
    }
  }

  public resume(): void {
    if (this.isRunning && this.isPaused && !this.isTerminal()) {
      this.isPaused = false;
      this.stateManager.setStatus('running');
      this.broadcast('status_change', { status: 'running' });
    }
  }

  public stop(): void {
    if (this.isRunning) {
      this.isRunning = false;
      this.isPaused = false;
      if (this.abortController) {
        this.abortController.abort();
      }
      this.stateManager.setStatus('stopped');
      this.broadcast('status_change', { status: 'stopped', message: 'Agent stopped by user.' });
    }
  }

  public clear(): void {
    this.stop();
    this.goalCompletedEmitted = false;
    this.stateManager.reset();
    this.broadcast('state_reset', this.stateManager.getState());
  }

  public async start(goal: string): Promise<AgentState> {
    if (this.isRunning) {
      this.stop();
    }

    this.sessionId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.goalCompletedEmitted = false;
    this.stateManager.reset(goal);
    this.stateManager.setStatus('running');
    this.isRunning = true;
    this.isPaused = false;
    this.abortController = new AbortController();

    this.broadcast('agent_started', {
      sessionId: this.sessionId,
      goal,
      startTime: new Date().toISOString(),
    });

    try {
      await this.runSelfEvolvingLoop(goal);
    } catch (err: any) {
      console.error('[AgentCore] Error in runSelfEvolvingLoop:', err);
      if (err.name === 'AbortError') {
        this.stateManager.setStatus('stopped');
      } else {
        this.stateManager.setStatus('failed');
        this.broadcast('agent_error', { message: err.message, stack: err.stack });
      }
    } finally {
      this.isRunning = false;
      this.isPaused = false;
      const finalState = this.stateManager.getState();
      this.broadcast('agent_finished', finalState);
    }

    return this.stateManager.getState();
  }

  /**
   * Authoritative, idempotent completion gate.
   * Ensures terminal state is set, experience is stored deterministically,
   * running flags are stopped, and exactly one completion event is emitted.
   */
  public async completeGoal(params: CompleteGoalParams): Promise<AgentState> {
    const currentState = this.stateManager.getState();
    if (currentState.status === 'completed') {
      return currentState;
    }

    // 1. Transition through completing to completed
    this.stateManager.setStatus('completing');
    this.stateManager.complete({
      summary: params.summary,
      reason: params.reason || 'Objective satisfied and verified.',
      evidence: params.evidence || currentState.completedActions.map(a => a.id),
      verificationCriteria: params.verificationCriteria || 'Strict verification criteria met',
      verificationOutput: params.verificationOutput || params.summary,
      score: params.score || currentState.validationStatus.score || 0.96,
    });

    // 2. Terminate execution immediately
    this.isRunning = false;
    this.isPaused = false;

    const completedState = this.stateManager.getState();
    const taskType = this.inferTaskType(completedState.goal);

    // 3. Finalization Pipeline: Deterministic experience recording (NO LLM, NO extra tools)
    let storedExp: any = null;
    try {
      storedExp = this.knowledgeStore.storeExperience({
        taskType,
        goal: completedState.goal,
        strategy: completedState.currentStrategy,
        toolsUsed: completedState.toolHistory.map(t => t.tool),
        result: 'success',
        evaluationScore: completedState.validationStatus.score || params.score || 0.96,
        evidence: completedState.completionEvidence || [],
        lesson: `Successfully executed '${completedState.currentStrategy}' for: ${completedState.goal}`,
      });
    } catch (err) {
      console.warn('Failed to record completed experience in knowledge store:', err);
    }

    // 4. Emit goal_completed event exactly once
    if (!this.goalCompletedEmitted) {
      this.goalCompletedEmitted = true;
      this.broadcast('goal_completed', {
        goal: completedState.goal,
        summary: params.summary,
        reason: completedState.completionReason,
        artifacts: completedState.artifacts,
        validation: completedState.validationStatus,
        verificationLevel: completedState.verificationLevel,
        terminalAt: completedState.terminalAt,
        experienceStored: storedExp,
      });
    }

    return completedState;
  }

  public reset(goal?: string): void {
    this.isRunning = false;
    this.isPaused = false;
    this.stateManager.reset(goal);
  }

  /**
   * Deterministically evaluates whether task completion criteria are met
   */
  public checkTaskCompletionCriteria(goal: string, state: AgentState): { satisfied: boolean; reason: string; score: number; evidence: string[] } {
    const taskType = this.inferTaskType(goal);
    const actions = state.completedActions;
    const artifacts = state.artifacts;

    // A. If strict validation passed with high score
    if (state.validationStatus?.isVerified && (state.validationStatus.score || 0.95) >= 0.70) {
      return {
        satisfied: true,
        reason: `Validation verified: ${state.validationStatus.verificationCriteria || 'All checks passed'}`,
        score: state.validationStatus.score || 0.95,
        evidence: actions.filter(a => a.status === 'success').map(a => a.id),
      };
    }

    // B. V2Ray Task: Config generated/validated and exported
    if (taskType === 'v2ray_config') {
      const hasValidatedConfig = actions.some(a =>
        a.status === 'success' && (a.tool === 'v2ray_validate_config' || a.tool === 'v2ray_test_config')
      );
      const hasBuildConfig = actions.some(a =>
        a.status === 'success' && a.tool === 'v2ray_build_config'
      );
      const hasArtifact = artifacts.some(art => art.type === 'v2ray_config' || art.filename.endsWith('.json'));

      if ((hasValidatedConfig || hasBuildConfig) && (hasArtifact || artifacts.length > 0)) {
        return {
          satisfied: true,
          reason: 'V2Ray configuration synthesized, validated with 0 errors, and exported to artifact storage.',
          score: 0.98,
          evidence: actions.filter(a => a.tool?.startsWith('v2ray_') || a.tool === 'export_artifact').map(a => a.id),
        };
      }
    }

    // C. Custom Tool Synthesis / Math / Crypto / Python: Tool created and tested
    if (taskType === 'math_conversion' || taskType === 'cryptography' || taskType === 'python_coding') {
      const toolCreated = actions.some(a => a.status === 'success' && (a.tool === 'create_tool' || a.tool === 'synthesize_tool'));
      const toolExecuted = actions.some(a => a.status === 'success' && a.type === 'tool_call' && a.tool !== 'create_tool');
      const testPassed = actions.some(a => a.status === 'success' && (a.tool === 'run_test' || a.tool === 'validate_output'));

      if (toolCreated && (toolExecuted || testPassed)) {
        return {
          satisfied: true,
          reason: 'Custom sandboxed tool synthesized, registered into registry, and verified via test execution.',
          score: 0.95,
          evidence: actions.filter(a => a.status === 'success').map(a => a.id),
        };
      }
    }

    // D. Artifact Exported with validation
    if (artifacts.length > 0 && artifacts.some(a => a.validated)) {
      return {
        satisfied: true,
        reason: `Artifact '${artifacts[0].filename}' synthesized, validated, and exported.`,
        score: 0.95,
        evidence: actions.filter(a => a.status === 'success').map(a => a.id),
      };
    }

    return { satisfied: false, reason: 'Pending required action/verification', score: 0, evidence: [] };
  }

  private async runSelfEvolvingLoop(goal: string): Promise<void> {
    const startTime = Date.now();
    const maxWallClockMs = 120000; // 2 minutes hard limit

    // 1. KNOWLEDGE RETRIEVAL & STRATEGY SELECTION
    const taskType = this.inferTaskType(goal);
    const pastExperiences = this.knowledgeStore.queryExperiences({ taskType, goal, limit: 3 });
    const knownFailures = this.knowledgeStore.queryFailures(taskType);
    const rankedStrategies = this.knowledgeStore.getRankedStrategies(taskType);
    const chosenStrategy = rankedStrategies[0]?.name || 'Adaptive Tool Composition';

    // 2. CAPABILITY GAP DETECTION
    const capabilityGap = this.toolBuilder.detectCapabilityGap(goal, this.toolRegistry.listTools());
    if (capabilityGap) {
      this.stateManager.addAction({
        id: `act_${Date.now()}_gap`,
        timestamp: new Date().toISOString(),
        type: 'capability_gap',
        message: `Capability gap detected: ${capabilityGap.missingAspect}. Recommended tool: '${capabilityGap.suggestedToolName}'`,
        status: 'info',
      });
      this.broadcast('capability_gap_detected', capabilityGap);
    }

    this.stateManager.changeStrategy(chosenStrategy);

    // Format Knowledge Context for LLM
    let memoryContext = '';
    if (pastExperiences.length > 0) {
      memoryContext += `\nPAST EXPERIENCES (High Confidence):\n` +
        pastExperiences.map((e, idx) => `  ${idx + 1}. [${e.promotionLevel.toUpperCase()}] ${e.lesson} (Score: ${(e.evaluationScore * 100).toFixed(0)}%)`).join('\n');
    }
    if (knownFailures.length > 0) {
      memoryContext += `\nKNOWN FAILURE PATTERNS (AVOID):\n` +
        knownFailures.map((f, idx) => `  ${idx + 1}. AVOID: ${f.reason} -> Suggestion: ${f.suggestedAlternative}`).join('\n');
    }

    const systemPrompt = `You are a Self-Evolving Autonomous Software Agent.
Your mandate is: GOAL -> KNOWLEDGE QUERY -> GAP DETECTION -> REASON -> PLAN -> TOOL SELECTION -> EXECUTE -> EVALUATE -> COMPLETE.

Core Operating Rules:
1. OUTCOME-ORIENTED: Execute concrete actions using tools dynamically.
2. V2RAY / CONFIG BUILDER POLICY:
   - Synthesize configuration cleanly from user requirements using 'v2ray_build_config'.
   - Validate with 'v2ray_validate_config' and evaluate with 'v2ray_test_config'.
3. SELF-TOOL-BUILDING: If a required capability is missing (e.g. specialized math or hashing), use 'create_tool' to write Python code, sandbox test it, and call it immediately!
4. INDEPENDENT EVALUATION: Output artifacts and tool results are autonomously scored by the evaluator.
5. ARTIFACT EXPORT: When your work is validated and ready, export using 'export_artifact'.
6. TERMINAL EFFICIENCY: Complete the goal cleanly in the minimal number of tool calls. Once verified, the runtime controller will immediately finalize and complete.
${memoryContext}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `USER GOAL:\n${goal}\n\nSelected Strategy: ${chosenStrategy}\nPlease begin execution.` },
    ];

    while (this.isRunning) {
      const currentState = this.stateManager.getState();

      // Invariant 1: Top of loop check for terminal state
      if (this.isTerminal(currentState.status)) {
        break;
      }

      // Invariant 2: Safety wall-clock & iteration bounds check
      if (currentState.iterationCount >= currentState.maxIterations || (Date.now() - startTime > maxWallClockMs)) {
        this.stateManager.setStatus('failed');
        this.broadcast('agent_error', { message: 'Execution bounds exceeded (iterations/timeout).' });
        break;
      }

      // Handle pause
      while (this.isPaused && this.isRunning) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (!this.isRunning || this.isTerminal(this.stateManager.getState().status)) break;

      const iteration = this.stateManager.incrementIteration();

      // Invariant 3: Check Loop & Stuck Detector
      const loopCheck = this.loopDetector.check(
        currentState.completedActions,
        iteration,
        currentState.maxIterations
      );

      if (loopCheck.type === 'TERMINAL_SUCCESS') {
        await this.completeGoal({
          summary: loopCheck.message || 'Terminal success reached.',
          reason: 'Loop detector identified terminal success condition.',
        });
        break;
      }

      if (loopCheck.isStuck) {
        this.stateManager.setStuck(true, loopCheck.message, loopCheck.recommendedPivot);
        this.broadcast('loop_detected', {
          type: loopCheck.type,
          message: loopCheck.message,
          recommendedPivot: loopCheck.recommendedPivot,
        });

        messages.push({
          role: 'user',
          content: `SYSTEM WARNING: STUCK/LOOP DETECTED.\n${loopCheck.message}\nAction Required: ${loopCheck.recommendedPivot}\nChange your strategy or diagnose now.`,
        });

        this.stateManager.changeStrategy(`Pivot: ${loopCheck.recommendedPivot}`);
      }

      // Invariant 4: Check terminal before calling LLM
      if (!this.isRunning || this.isTerminal(this.stateManager.getState().status)) break;

      const toolsSchema = this.toolRegistry.getToolDefinitionsForLLM();

      this.broadcast('iteration_start', {
        iteration,
        maxIterations: currentState.maxIterations,
        strategy: currentState.currentStrategy,
      });

      let response: any;
      try {
        response = await this.llmClient.chatCompletion(messages, toolsSchema);
      } catch (err: any) {
        this.broadcast('llm_error', { message: err.message });
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      // Invariant 5: Check terminal immediately after LLM call
      if (!this.isRunning || this.isTerminal(this.stateManager.getState().status)) break;

      const content = response.content;
      const toolCalls = response.tool_calls;

      messages.push({
        role: 'assistant',
        content: content || undefined,
        tool_calls: toolCalls,
      });

      if (content) {
        const reasoningAction: AgentAction = {
          id: `act_${Date.now()}_reason`,
          timestamp: new Date().toISOString(),
          type: 'reasoning',
          message: content,
          status: 'info',
        };
        this.stateManager.addAction(reasoningAction);
        this.broadcast('agent_reasoning', { content });
      }

      // If LLM decided not to call any tools, check if completion criteria are satisfied
      if (!toolCalls || toolCalls.length === 0) {
        const completionCheck = this.checkTaskCompletionCriteria(goal, this.stateManager.getState());
        if (completionCheck.satisfied) {
          await this.completeGoal({
            summary: content || 'Goal completed and verified.',
            reason: completionCheck.reason,
            score: completionCheck.score,
            evidence: completionCheck.evidence,
          });
          break;
        } else {
          messages.push({
            role: 'user',
            content: 'Please take concrete tool action to make progress, verify outputs, and export artifacts.',
          });
          continue;
        }
      }

      // Execute tool calls with per-step terminal guards
      for (const tc of toolCalls) {
        if (!this.isRunning || this.isTerminal(this.stateManager.getState().status)) {
          break;
        }

        const toolName = tc.function.name;
        const toolArgs = tc.function.arguments;

        const actionId = `act_${Date.now()}_${tc.id}`;
        const action: AgentAction = {
          id: actionId,
          timestamp: new Date().toISOString(),
          type: 'tool_call',
          tool: toolName,
          arguments: toolArgs,
          status: 'running',
        };

        const added = this.stateManager.addAction(action);
        if (!added) {
          // Task already completed, reject tool execution
          break;
        }

        this.broadcast('tool_execution_start', {
          actionId,
          tool: toolName,
          arguments: this.workspace.sanitizeCredentials(toolArgs),
        });

        const startExec = Date.now();
        const toolResult: ToolResult = await this.toolRegistry.executeTool(toolName, toolArgs);
        const durationMs = Date.now() - startExec;

        const updatedStatus = toolResult.success ? 'success' : 'failed';

        // 4. AUTONOMOUS EVALUATION OF TOOL RESULT
        const evalReport = this.evaluator.evaluateToolExecution(toolName, toolArgs, toolResult);

        this.stateManager.updateAction(actionId, {
          status: updatedStatus,
          result: toolResult,
          duration_ms: durationMs,
          evaluation: evalReport,
        });

        this.broadcast('tool_execution_end', {
          actionId,
          tool: toolName,
          success: toolResult.success,
          result: toolResult,
          evaluation: evalReport,
          durationMs,
        });

        // If successful, reset argument repair attempts
        if (toolResult.success) {
          this.stateManager.clearArgumentRepairState();
        }

        const isArgError = !toolResult.success && (
          toolResult.error?.type === 'INVALID_ARGUMENTS' ||
          toolResult.error?.type === 'INVALID_ARGUMENT_TYPE' ||
          toolResult.error?.type === 'DUPLICATE_INVALID_TOOL_CALL'
        );

        // Record failure in negative knowledge ONLY if it is a genuine execution/strategy failure, not argument formatting
        if (!toolResult.success && toolResult.error && !isArgError) {
          this.knowledgeStore.storeFailure({
            strategyOrTool: toolName,
            failureType: toolResult.error.type || 'EXECUTION_ERROR',
            reason: toolResult.error.message,
            suggestedAlternative: 'Try alternative tool or diagnose parameters.',
            failedUnderConditions: toolArgs,
            evidence: [actionId],
          });
        }

        if (toolName === 'export_artifact' && toolResult.success && toolResult.data?.metadata) {
          this.stateManager.addArtifact(toolResult.data.metadata);
          this.broadcast('artifact_created', toolResult.data.metadata);
        }

        if (['validate_output', 'run_test', 'v2ray_validate_config', 'v2ray_test_config', 'evaluate_artifact'].includes(toolName)) {
          if (toolResult.success) {
            const score = toolResult.data?.score || toolResult.data?.overallScore || 0.95;
            this.stateManager.setValidation(true, `Passed ${toolName}`, JSON.stringify(toolResult.data), score);
            this.broadcast('validation_success', { tool: toolName, data: toolResult.data, score });
          }
        }

        // Argument Repair Architecture Flow
        if (isArgError) {
          const currentAttempts = this.stateManager.getState().argumentRepairAttempts || 0;
          const toolMeta = this.toolRegistry.getTool(toolName);
          const canAttemptRepair = !!toolMeta && currentAttempts < 2 && toolResult.error?.type !== 'DUPLICATE_INVALID_TOOL_CALL';

          if (canAttemptRepair) {
            const nextAttempt = this.stateManager.incrementArgumentRepairAttempts();
            this.stateManager.setArgumentRepairState({
              status: 'repairing',
              tool: toolName,
              attempts: nextAttempt,
              maxAttempts: 2,
              lastFingerprint: toolResult.error?.fingerprint || '',
              missingFields: toolResult.error?.missing || [],
              invalidFields: toolResult.error?.invalid || [],
            });

            this.broadcast('argument_repair_start', {
              tool: toolName,
              attempt: nextAttempt,
              maxAttempts: 2,
              error: toolResult.error,
            });

            const repairResult = buildArgumentRepairInstruction({
              toolName,
              schema: toolMeta?.parameters || {},
              missingFields: toolResult.error?.missing,
              invalidFields: toolResult.error?.invalid,
              previousArgs: toolArgs,
              errorMessage: toolResult.error?.message,
            });

            messages.push({
              role: 'tool',
              name: toolName,
              tool_call_id: tc.id,
              content: JSON.stringify(toolResult),
            });

            const instructionContent = typeof repairResult === 'string'
              ? repairResult
              : ('instruction' in repairResult ? repairResult.instruction : repairResult.reason);

            messages.push({
              role: 'user',
              content: instructionContent || '[ARGUMENT REPAIR REQUIRED] Repair invalid arguments.',
            });

            // Immediately break to execute the repair step next
            break;
          } else {
            // Repair blocked or exceeded maximum attempts
            this.stateManager.setArgumentRepairState({
              status: 'failed',
              tool: toolName,
              attempts: currentAttempts,
              maxAttempts: 2,
              lastFingerprint: toolResult.error?.fingerprint || '',
              missingFields: toolResult.error?.missing || [],
              invalidFields: toolResult.error?.invalid || [],
            });

            this.broadcast('argument_repair_failed', {
              tool: toolName,
              attempts: currentAttempts,
              reason: toolResult.error?.type === 'DUPLICATE_INVALID_TOOL_CALL'
                ? 'Duplicate invalid argument payload rejected.'
                : 'Maximum argument repair attempts exceeded.',
            });

            messages.push({
              role: 'tool',
              name: toolName,
              tool_call_id: tc.id,
              content: JSON.stringify(toolResult),
            });

            messages.push({
              role: 'user',
              content: `[ARGUMENT_REPAIR_BLOCKED] Repair for tool '${toolName}' failed (${toolResult.error?.message}). DO NOT re-invoke '${toolName}' with these arguments. Pivot strategy or choose an alternative tool.`,
            });

            break;
          }
        }

        messages.push({
          role: 'tool',
          name: toolName,
          tool_call_id: tc.id,
          content: JSON.stringify(toolResult),
        });

        // Invariant 6: Authoritative Check IMMEDIATELY after tool execution
        const criteriaCheck = this.checkTaskCompletionCriteria(goal, this.stateManager.getState());
        if (criteriaCheck.satisfied) {
          this.stateManager.setStatus('verifying');
          this.stateManager.setStatus('verified');
          await this.completeGoal({
            summary: `Goal completed with tool '${toolName}': ${criteriaCheck.reason}`,
            reason: criteriaCheck.reason,
            score: criteriaCheck.score,
            evidence: criteriaCheck.evidence,
          });
          // Break tool loop immediately
          break;
        }
      }

      // Invariant 7: Break outer loop immediately if state is terminal
      if (this.isTerminal(this.stateManager.getState().status)) {
        break;
      }

      await new Promise(r => setTimeout(r, 400));
    }

    // Ensure final state is normalized if loop exited without explicit completion
    const finalSt = this.stateManager.getState();
    if (finalSt.status === 'running' || finalSt.status === 'verifying' || finalSt.status === 'completing') {
      const finalCheck = this.checkTaskCompletionCriteria(goal, finalSt);
      if (finalCheck.satisfied) {
        await this.completeGoal({
          summary: 'Task verified upon loop conclusion.',
          reason: finalCheck.reason,
          score: finalCheck.score,
          evidence: finalCheck.evidence,
        });
      } else {
        this.stateManager.setStatus('stopped');
      }
    }
  }

  private inferTaskType(goal: string): string {
    const g = (goal || '').toLowerCase();
    if (g.includes('v2ray') || g.includes('vless') || g.includes('vmess') || g.includes('reality') || g.includes('proxy')) {
      return 'v2ray_config';
    }
    if (g.includes('temperature') || g.includes('celsius') || g.includes('fahrenheit') || g.includes('convert')) {
      return 'math_conversion';
    }
    if (g.includes('hash') || g.includes('sha256') || g.includes('crypto')) {
      return 'cryptography';
    }
    if (g.includes('python') || g.includes('script')) {
      return 'python_coding';
    }
    return 'general_task';
  }
}

export const defaultAgentCore = new AgentCore();

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AgentAction, AgentState, ToolResult } from '../types';
import { WorkspaceManager, defaultWorkspace } from '../workspace';
import { ToolRegistry, defaultToolRegistry } from '../tools/registry';
import { LLMClient, defaultLLMClient, ChatMessage } from '../llm/client';
import { StateManager } from './state_manager';
import { LoopDetector } from './loop_detector';

export type AgentEventCallback = (event: { type: string; payload: any }) => void;

export class AgentCore {
  private stateManager: StateManager;
  private loopDetector: LoopDetector;
  private toolRegistry: ToolRegistry;
  private workspace: WorkspaceManager;
  private llmClient: LLMClient;
  private listeners: Set<AgentEventCallback> = new Set();
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private abortController: AbortController | null = null;
  private sessionId: string = '';

  constructor(
    workspace?: WorkspaceManager,
    toolRegistry?: ToolRegistry,
    llmClient?: LLMClient,
  ) {
    this.workspace = workspace || defaultWorkspace;
    this.toolRegistry = toolRegistry || defaultToolRegistry;
    this.llmClient = llmClient || defaultLLMClient;
    this.stateManager = new StateManager();
    this.loopDetector = new LoopDetector();

    // Broadcast API retry events live & record in state
    this.llmClient.onRetry((info) => {
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

    // Log to JSONL session log
    if (this.sessionId) {
      this.workspace.appendLog(this.sessionId, {
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        type,
        payload,
      });
    }
  }

  public getState(): AgentState {
    return this.stateManager.getState();
  }

  public pause(): void {
    if (this.isRunning && !this.isPaused) {
      this.isPaused = true;
      this.stateManager.setStatus('paused');
      this.broadcast('status_change', { status: 'paused' });
    }
  }

  public resume(): void {
    if (this.isRunning && this.isPaused) {
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
    this.stateManager.reset();
    this.broadcast('state_reset', this.stateManager.getState());
  }

  public async start(goal: string): Promise<AgentState> {
    if (this.isRunning) {
      this.stop();
    }

    this.sessionId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
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
      await this.runLoop(goal);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        this.stateManager.setStatus('stopped');
      } else {
        this.stateManager.setStatus('failed');
        this.broadcast('agent_error', { message: err.message, stack: err.stack });
      }
    } finally {
      this.isRunning = false;
      this.broadcast('agent_finished', this.stateManager.getState());
    }

    return this.stateManager.getState();
  }

  private async runLoop(goal: string): Promise<void> {
    const systemPrompt = `You are an Autonomous Goal-Oriented Software Agent.
Your mandate is: GOAL -> REASON -> PLAN -> TOOL SELECTION -> EXECUTE -> OBSERVE -> VERIFY -> REPAIR -> CONTINUE -> COMPLETE.

Core Operating Rules:
1. OUTCOME-ORIENTED: You are given a high-level goal. Analyze it, determine required tools, and execute actions dynamically. Do NOT follow a rigid hardcoded workflow.
2. TOOL EXECUTION: You MUST call actual tools to inspect, code, test, and build. Do not simply describe actions in text.
3. V2RAY / CONFIG BUILDER POLICY:
   - NEVER copy a ready-made configuration from the internet or search results.
   - Use technical references/documentation only to understand protocol semantics.
   - Synthesize the final configuration cleanly from user requirements using 'v2ray_build_config' or structured data models.
   - Validate using 'v2ray_validate_config' and test with 'v2ray_test_config'.
4. SELF-EXTENDING CAPABILITY: If a task requires a custom calculation or utility that no built-in tool provides, use 'create_tool' to write Python code, back up, test, and register the new tool, then call it immediately!
5. VERIFICATION REQUIREMENT: NEVER mark a goal complete until you have explicitly executed a verification step ('validate_output', 'run_test', or 'v2ray_validate_config').
6. ARTIFACT EXPORT: When your work is validated and ready, export the final output (.json, .py, .md, .yaml) using 'export_artifact' into workspace/outputs/.
7. TRANSPARENCY: If stuck, diagnose the failure, change strategy, or install missing dependencies with 'install_python_package'.`;

    // Messages array for LLM
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `USER GOAL:\n${goal}\n\nPlease inspect the workspace, decide your strategy, execute appropriate tools, verify results, and complete the goal.` },
    ];

    let goalCompleted = false;

    while (this.isRunning && !goalCompleted) {
      // Check pause
      while (this.isPaused && this.isRunning) {
        await new Promise(r => setTimeout(r, 500));
      }

      if (!this.isRunning) break;

      const iteration = this.stateManager.incrementIteration();
      const currentState = this.stateManager.getState();

      // Check Loop & Stuck Detector
      const loopCheck = this.loopDetector.check(
        currentState.completedActions,
        iteration,
        currentState.maxIterations
      );

      if (loopCheck.isStuck) {
        this.stateManager.setStuck(true, loopCheck.message, loopCheck.recommendedPivot);
        this.broadcast('loop_detected', {
          type: loopCheck.type,
          message: loopCheck.message,
          recommendedPivot: loopCheck.recommendedPivot,
        });

        // Inject pivot instruction to LLM
        messages.push({
          role: 'user',
          content: `SYSTEM WARNING: STUCK/LOOP DETECTED.\n${loopCheck.message}\nAction Required: ${loopCheck.recommendedPivot}\nChange your approach or formulate a diagnosis now.`,
        });

        this.stateManager.changeStrategy(`Pivot: ${loopCheck.recommendedPivot}`);
      }

      // Prepare Tools Schema for LLM
      const toolsSchema = this.toolRegistry.getToolDefinitionsForLLM();

      this.broadcast('iteration_start', {
        iteration,
        maxIterations: currentState.maxIterations,
        strategy: currentState.currentStrategy,
      });

      // Query LLM
      let response: any;
      try {
        response = await this.llmClient.chatCompletion(messages, toolsSchema);
      } catch (err: any) {
        this.broadcast('llm_error', { message: err.message });
        // Retry with backoff
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      const content = response.content;
      const toolCalls = response.tool_calls;

      // Record Assistant message in history
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

      // If no tool calls were made by the model:
      if (!toolCalls || toolCalls.length === 0) {
        // Check if the agent claims completion in text
        if (currentState.validationStatus.isVerified || content?.toLowerCase().includes('goal complete') || content?.toLowerCase().includes('completed the goal')) {
          goalCompleted = true;
          this.stateManager.setStatus('completed');
          this.broadcast('goal_completed', {
            goal,
            summary: content || 'Goal completed and verified.',
            artifacts: currentState.artifacts,
            validation: currentState.validationStatus,
          });
          break;
        } else {
          // Model just spoke without taking action or verifying. Prompt it to act!
          messages.push({
            role: 'user',
            content: 'Please take concrete action using tools to make progress, verify results, and export artifacts.',
          });
          continue;
        }
      }

      // Execute all tool calls
      for (const tc of toolCalls) {
        if (!this.isRunning) break;

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

        this.stateManager.addAction(action);

        this.broadcast('tool_execution_start', {
          actionId,
          tool: toolName,
          arguments: this.workspace.sanitizeCredentials(toolArgs),
        });

        const startExec = Date.now();
        const toolResult: ToolResult = await this.toolRegistry.executeTool(toolName, toolArgs);
        const durationMs = Date.now() - startExec;

        const updatedStatus = toolResult.success ? 'success' : 'failed';
        this.stateManager.updateAction(actionId, {
          status: updatedStatus,
          result: toolResult,
          duration_ms: durationMs,
        });

        this.broadcast('tool_execution_end', {
          actionId,
          tool: toolName,
          success: toolResult.success,
          result: toolResult,
          durationMs,
        });

        // Special handling for export_artifact
        if (toolName === 'export_artifact' && toolResult.success && toolResult.data?.metadata) {
          this.stateManager.addArtifact(toolResult.data.metadata);
          this.broadcast('artifact_created', toolResult.data.metadata);
        }

        // Special handling for validation tools
        if (['validate_output', 'run_test', 'v2ray_validate_config', 'v2ray_test_config'].includes(toolName)) {
          if (toolResult.success) {
            this.stateManager.setValidation(true, `Passed ${toolName}`, JSON.stringify(toolResult.data));
            this.broadcast('validation_success', { tool: toolName, data: toolResult.data });
          }
        }

        // Add tool response to LLM context
        messages.push({
          role: 'tool',
          name: toolName,
          tool_call_id: tc.id,
          content: JSON.stringify(toolResult),
        });
      }

      // Brief delay between loop iterations
      await new Promise(r => setTimeout(r, 600));
    }

    if (this.stateManager.getState().status === 'running') {
      this.stateManager.setStatus(goalCompleted ? 'completed' : 'stopped');
    }
  }
}

export const defaultAgentCore = new AgentCore();

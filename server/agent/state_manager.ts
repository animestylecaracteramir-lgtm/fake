import fs from 'fs';
import path from 'path';
import { AgentState, AgentAction, ArtifactMetadata, ExecutionStatus } from '../types';

export class StateManager {
  private state: AgentState;
  private storageFilePath: string;

  constructor(storageDir?: string) {
    const dir = storageDir || path.resolve(process.cwd(), 'workspace');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    }
    this.storageFilePath = path.join(dir, 'agent_state.json');
    this.state = this.loadFromDisk() || this.getInitialState();
  }

  private loadFromDisk(): AgentState | null {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.completedActions)) {
          // If server was started anew, any stale 'running' or 'paused' status from previous run is normalized to 'idle' or 'stopped'
          if (parsed.status === 'running' || parsed.status === 'paused' || parsed.status === 'verifying' || parsed.status === 'completing') {
            parsed.status = parsed.completedActions.length > 0 ? 'stopped' : 'idle';
          }
          if (typeof parsed.postCompletionExecutionAttempts !== 'number') {
            parsed.postCompletionExecutionAttempts = 0;
          }
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Failed to load agent state from disk, using fresh state:', err);
    }
    return null;
  }

  public saveToDisk(): void {
    try {
      const tempPath = `${this.storageFilePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.storageFilePath);
    } catch (err) {
      console.warn('Failed to persist agent state to disk:', err);
    }
  }

  public getInitialState(): AgentState {
    return {
      goal: '',
      status: 'idle',
      currentObjective: '',
      currentPlan: [],
      currentStrategy: 'Initial Strategy Formulation',
      strategyAttemptCount: 1,
      completedActions: [],
      pendingActions: [],
      iterationCount: 0,
      maxIterations: 25,
      toolHistory: [],
      errors: [],
      experiments: [],
      artifacts: [],
      validationStatus: {
        isVerified: false,
      },
      postCompletionExecutionAttempts: 0,
    };
  }

  public getState(): AgentState {
    return { ...this.state };
  }

  public isTerminal(status?: ExecutionStatus): boolean {
    const st = status || this.state.status;
    return st === 'completed' || st === 'failed' || st === 'stopped';
  }

  public reset(goal?: string): void {
    this.state = this.getInitialState();
    if (goal) {
      this.state.goal = goal;
      this.state.startTime = new Date().toISOString();
    }
    this.saveToDisk();
  }

  public setGoal(goal: string): void {
    this.state.goal = goal;
    this.state.status = 'idle';
    this.saveToDisk();
  }

  public setStatus(status: ExecutionStatus): void {
    // If state is already completed, ignore transitions except explicit 'idle' reset
    if (this.state.status === 'completed' && status !== 'idle') {
      return;
    }

    this.state.status = status;
    if (status === 'completed' || status === 'failed' || status === 'stopped') {
      this.state.endTime = new Date().toISOString();
      if (status === 'completed' && !this.state.terminalAt) {
        this.state.terminalAt = new Date().toISOString();
      }
    }
    this.saveToDisk();
  }

  public setPlan(plan: string[], objective: string, strategy?: string): void {
    if (this.isTerminal()) {
      return;
    }
    this.state.currentPlan = plan;
    this.state.currentObjective = objective;
    if (strategy) this.state.currentStrategy = strategy;
    this.saveToDisk();
  }

  public changeStrategy(newStrategy: string): void {
    if (this.isTerminal()) {
      return;
    }
    this.state.currentStrategy = newStrategy;
    this.state.strategyAttemptCount += 1;
    this.saveToDisk();
  }

  public addAction(action: AgentAction): boolean {
    // Hard guard: no new actions allowed after terminal completion
    if (this.state.status === 'completed') {
      this.state.postCompletionExecutionAttempts += 1;
      this.saveToDisk();
      return false;
    }

    const existingIdx = this.state.completedActions.findIndex(a => a.id === action.id);
    if (existingIdx >= 0) {
      this.state.completedActions[existingIdx] = {
        ...this.state.completedActions[existingIdx],
        ...action,
      };
    } else {
      this.state.completedActions.push(action);
    }

    // Only record in toolHistory once per action
    if (action.tool && !this.state.toolHistory.some(t => t.timestamp === action.timestamp && t.tool === action.tool)) {
      this.state.toolHistory.push({
        tool: action.tool,
        args: action.arguments,
        success: action.status === 'success',
        timestamp: action.timestamp,
      });
    }

    // Only record in errors once
    if (action.status === 'failed' && action.result?.error && !this.state.errors.some(e => e.timestamp === action.timestamp && e.tool === action.tool)) {
      this.state.errors.push({
        message: action.result.error.message,
        tool: action.tool,
        timestamp: action.timestamp,
      });
    }

    this.saveToDisk();
    return true;
  }

  public updateAction(actionId: string, updates: Partial<AgentAction>): boolean {
    if (this.state.status === 'completed') {
      this.state.postCompletionExecutionAttempts += 1;
      this.saveToDisk();
      return false;
    }

    const existingIdx = this.state.completedActions.findIndex(a => a.id === actionId);
    if (existingIdx >= 0) {
      this.state.completedActions[existingIdx] = {
        ...this.state.completedActions[existingIdx],
        ...updates,
      };

      const updated = this.state.completedActions[existingIdx];
      // Update toolHistory if tool exists
      if (updated.tool) {
        const histIdx = this.state.toolHistory.findIndex(t => t.timestamp === updated.timestamp && t.tool === updated.tool);
        if (histIdx >= 0) {
          this.state.toolHistory[histIdx].success = updated.status === 'success';
        } else {
          this.state.toolHistory.push({
            tool: updated.tool,
            args: updated.arguments,
            success: updated.status === 'success',
            timestamp: updated.timestamp,
          });
        }
      }

      // Update errors if failed
      if (updated.status === 'failed' && updated.result?.error) {
        const errExists = this.state.errors.some(e => e.timestamp === updated.timestamp && e.tool === updated.tool);
        if (!errExists) {
          this.state.errors.push({
            message: updated.result.error.message,
            tool: updated.tool,
            timestamp: updated.timestamp,
          });
        }
      }

      this.saveToDisk();
      return true;
    }
    return false;
  }

  public addArtifact(artifact: ArtifactMetadata): void {
    const existingIdx = this.state.artifacts.findIndex(a => a.filename === artifact.filename);
    if (existingIdx >= 0) {
      this.state.artifacts[existingIdx] = artifact;
    } else {
      this.state.artifacts.push(artifact);
    }
    this.saveToDisk();
  }

  public setValidation(isVerified: boolean, criteria?: string, output?: string, score?: number): void {
    this.state.validationStatus = {
      isVerified,
      verificationCriteria: criteria,
      verificationOutput: output,
      score,
      timestamp: new Date().toISOString(),
    };
    this.saveToDisk();
  }

  public incrementIteration(): number {
    if (this.isTerminal()) {
      return this.state.iterationCount;
    }
    this.state.iterationCount += 1;
    this.saveToDisk();
    return this.state.iterationCount;
  }

  public setStuck(isStuck: boolean, reason?: string, suggestedAction?: string): void {
    this.state.stuckDiagnosis = {
      isStuck,
      reason,
      suggestedAction,
    };
    this.saveToDisk();
  }

  public complete(params: {
    summary: string;
    reason?: string;
    evidence?: string[];
    verificationCriteria?: string;
    verificationOutput?: string;
    score?: number;
  }): void {
    if (this.state.status === 'completed') {
      return;
    }
    this.state.status = 'completed';
    this.state.completionReason = params.reason || params.summary;
    this.state.completionEvidence = params.evidence || this.state.completedActions.map(a => a.id);
    this.state.verificationLevel = (params.score && params.score >= 0.9) ? 'verified_strict' : 'verified_standard';
    this.state.terminalAt = new Date().toISOString();
    this.state.endTime = new Date().toISOString();
    this.state.validationStatus = {
      isVerified: true,
      verificationCriteria: params.verificationCriteria || params.reason || 'Criteria satisfied',
      verificationOutput: params.verificationOutput || params.summary,
      score: params.score || 0.95,
      timestamp: new Date().toISOString(),
    };
    this.saveToDisk();
  }
}

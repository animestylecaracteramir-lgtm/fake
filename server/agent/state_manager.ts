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
      argumentRepairAttempts: 0,
      maxArgumentRepairAttempts: 2,
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

    // Canonical single-record tracking for toolHistory
    if (action.tool) {
      const histIdx = this.state.toolHistory.findIndex(t => (t.actionId && t.actionId === action.id) || (t.timestamp === action.timestamp && t.tool === action.tool));
      if (histIdx >= 0) {
        this.state.toolHistory[histIdx] = {
          ...this.state.toolHistory[histIdx],
          actionId: action.id,
          tool: action.tool,
          args: action.arguments !== undefined ? action.arguments : this.state.toolHistory[histIdx].args,
          success: action.status === 'success',
          duration_ms: action.duration_ms !== undefined ? action.duration_ms : this.state.toolHistory[histIdx].duration_ms,
        };
      } else {
        this.state.toolHistory.push({
          actionId: action.id,
          tool: action.tool,
          args: action.arguments,
          success: action.status === 'success',
          timestamp: action.timestamp,
          duration_ms: action.duration_ms,
        });
      }
    }

    // Canonical single-record tracking for errors
    if (action.status === 'failed' && action.result?.error) {
      const errIdx = this.state.errors.findIndex(e => (e.actionId && e.actionId === action.id) || (e.timestamp === action.timestamp && e.tool === action.tool));
      if (errIdx >= 0) {
        this.state.errors[errIdx] = {
          actionId: action.id,
          message: action.result.error.message,
          tool: action.tool,
          timestamp: action.timestamp,
          errorType: action.result.error.type,
        };
      } else {
        this.state.errors.push({
          actionId: action.id,
          message: action.result.error.message,
          tool: action.tool,
          timestamp: action.timestamp,
          errorType: action.result.error.type,
        });
      }
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
      // Update existing toolHistory record in-place
      if (updated.tool) {
        const histIdx = this.state.toolHistory.findIndex(t => (t.actionId && t.actionId === actionId) || (t.timestamp === updated.timestamp && t.tool === updated.tool));
        if (histIdx >= 0) {
          this.state.toolHistory[histIdx] = {
            ...this.state.toolHistory[histIdx],
            actionId,
            tool: updated.tool,
            args: updated.arguments !== undefined ? updated.arguments : this.state.toolHistory[histIdx].args,
            success: updated.status === 'success',
            duration_ms: updated.duration_ms !== undefined ? updated.duration_ms : this.state.toolHistory[histIdx].duration_ms,
          };
        } else {
          this.state.toolHistory.push({
            actionId,
            tool: updated.tool,
            args: updated.arguments,
            success: updated.status === 'success',
            timestamp: updated.timestamp,
            duration_ms: updated.duration_ms,
          });
        }
      }

      // Update existing error record in-place
      if (updated.status === 'failed' && updated.result?.error) {
        const errIdx = this.state.errors.findIndex(e => (e.actionId && e.actionId === actionId) || (e.timestamp === updated.timestamp && e.tool === updated.tool));
        if (errIdx >= 0) {
          this.state.errors[errIdx] = {
            actionId,
            message: updated.result.error.message,
            tool: updated.tool,
            timestamp: updated.timestamp,
            errorType: updated.result.error.type,
          };
        } else {
          this.state.errors.push({
            actionId,
            message: updated.result.error.message,
            tool: updated.tool,
            timestamp: updated.timestamp,
            errorType: updated.result.error.type,
          });
        }
      } else if (updated.status === 'success') {
        const errIdx = this.state.errors.findIndex(e => e.actionId === actionId);
        if (errIdx >= 0) {
          this.state.errors.splice(errIdx, 1);
        }
      }

      this.saveToDisk();
      return true;
    }
    return false;
  }

  public setArgumentRepairState(repairState: AgentState['argumentRepairState']): void {
    this.state.argumentRepairState = repairState;
    if (repairState?.status === 'repairing') {
      this.state.status = 'repairing_arguments';
    }
    this.saveToDisk();
  }

  public clearArgumentRepairState(): void {
    this.state.argumentRepairState = undefined;
    this.state.argumentRepairAttempts = 0;
    if (this.state.status === 'repairing_arguments') {
      this.state.status = 'running';
    }
    this.saveToDisk();
  }

  public incrementArgumentRepairAttempts(): number {
    this.state.argumentRepairAttempts = (this.state.argumentRepairAttempts || 0) + 1;
    this.saveToDisk();
    return this.state.argumentRepairAttempts;
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

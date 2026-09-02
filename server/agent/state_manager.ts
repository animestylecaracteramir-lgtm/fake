import fs from 'fs';
import path from 'path';
import { AgentState, AgentAction, ArtifactMetadata } from '../types';

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
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Failed to load agent state from disk, using fresh state:', err);
    }
    return null;
  }

  private saveToDisk(): void {
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
    };
  }

  public getState(): AgentState {
    return { ...this.state };
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

  public setStatus(status: AgentState['status']): void {
    this.state.status = status;
    if (status === 'completed' || status === 'failed' || status === 'stopped') {
      this.state.endTime = new Date().toISOString();
    }
    this.saveToDisk();
  }

  public setPlan(plan: string[], objective: string, strategy?: string): void {
    this.state.currentPlan = plan;
    this.state.currentObjective = objective;
    if (strategy) this.state.currentStrategy = strategy;
    this.saveToDisk();
  }

  public changeStrategy(newStrategy: string): void {
    this.state.currentStrategy = newStrategy;
    this.state.strategyAttemptCount += 1;
    this.saveToDisk();
  }

  public addAction(action: AgentAction): void {
    // Avoid duplicate actions if already added by id
    const existingIdx = this.state.completedActions.findIndex(a => a.id === action.id);
    if (existingIdx >= 0) {
      this.state.completedActions[existingIdx] = {
        ...this.state.completedActions[existingIdx],
        ...action,
      };
    } else {
      this.state.completedActions.push(action);
    }

    if (action.tool) {
      this.state.toolHistory.push({
        tool: action.tool,
        args: action.arguments,
        success: action.status === 'success',
        timestamp: action.timestamp,
      });
    }
    if (action.status === 'failed' && action.result?.error) {
      this.state.errors.push({
        message: action.result.error.message,
        tool: action.tool,
        timestamp: action.timestamp,
      });
    }
    this.saveToDisk();
  }

  public updateAction(actionId: string, updates: Partial<AgentAction>): void {
    const existingIdx = this.state.completedActions.findIndex(a => a.id === actionId);
    if (existingIdx >= 0) {
      this.state.completedActions[existingIdx] = {
        ...this.state.completedActions[existingIdx],
        ...updates,
      };

      const updated = this.state.completedActions[existingIdx];
      if (updated.tool) {
        this.state.toolHistory.push({
          tool: updated.tool,
          args: updated.arguments,
          success: updated.status === 'success',
          timestamp: updated.timestamp,
        });
      }
      if (updated.status === 'failed' && updated.result?.error) {
        this.state.errors.push({
          message: updated.result.error.message,
          tool: updated.tool,
          timestamp: updated.timestamp,
        });
      }
      this.saveToDisk();
    }
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

  public setValidation(isVerified: boolean, criteria?: string, output?: string): void {
    this.state.validationStatus = {
      isVerified,
      verificationCriteria: criteria,
      verificationOutput: output,
      timestamp: new Date().toISOString(),
    };
    this.saveToDisk();
  }

  public incrementIteration(): number {
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
}

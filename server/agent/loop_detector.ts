import { AgentAction } from '../types';

export interface LoopDetectionResult {
  isStuck: boolean;
  type?: 'REPEATED_ACTION' | 'REPEATED_ERROR' | 'ITERATION_LIMIT' | 'NO_PROGRESS' | 'TERMINAL_SUCCESS';
  message?: string;
  recommendedPivot?: string;
}

export class LoopDetector {
  private readonly maxSameErrorThreshold: number = 3;
  private readonly maxSameActionThreshold: number = 3;

  public check(actions: AgentAction[], iterationCount: number, maxIterations: number): LoopDetectionResult {
    if (iterationCount >= maxIterations) {
      return {
        isStuck: true,
        type: 'ITERATION_LIMIT',
        message: `Iteration limit (${maxIterations}) reached. Halting loop to prevent infinite token consumption.`,
        recommendedPivot: 'Summarize completed actions, report verified results, and outline what remains missing.',
      };
    }

    if (actions.length < 2) {
      return { isStuck: false };
    }

    // 0. Check Terminal Success (Repeated successful validations or exports with valid results)
    const recentSuccessfulValidations = actions.filter(
      a => a.status === 'success' && (
        a.tool === 'v2ray_validate_config' ||
        a.tool === 'v2ray_test_config' ||
        a.tool === 'validate_output' ||
        a.tool === 'run_test' ||
        a.tool === 'export_artifact' ||
        a.type === 'verify'
      )
    );

    if (recentSuccessfulValidations.length >= 2) {
      const lastValidation = recentSuccessfulValidations[recentSuccessfulValidations.length - 1];
      const prevValidation = recentSuccessfulValidations[recentSuccessfulValidations.length - 2];
      
      // If the last two validations or export actions were successful and no new errors occurred
      const recentErrors = actions.filter(a => a.status === 'failed');
      if (recentErrors.length === 0 || actions[actions.length - 1].status === 'success') {
        if (lastValidation.tool === prevValidation.tool || lastValidation.tool === 'export_artifact' || prevValidation.tool === 'export_artifact') {
          return {
            isStuck: true,
            type: 'TERMINAL_SUCCESS',
            message: 'Objective is already verified and successful. Halting loop to prevent redundant executions.',
            recommendedPivot: 'Complete the task immediately with final evidence.',
          };
        }
      }
    }

    // 1. Check Repeated Identical Errors
    const recentErrors = actions
      .filter(a => a.status === 'failed' && a.result?.error)
      .slice(-4);

    if (recentErrors.length >= this.maxSameErrorThreshold) {
      const lastErrMsg = recentErrors[recentErrors.length - 1].result?.error?.message;
      const count = recentErrors.filter(e => e.result?.error?.message === lastErrMsg).length;
      if (count >= this.maxSameErrorThreshold) {
        return {
          isStuck: true,
          type: 'REPEATED_ERROR',
          message: `Same error encountered ${count} consecutive times: "${lastErrMsg}"`,
          recommendedPivot: 'PIVOT STRATEGY: Stop repeating this tool/call. Diagnose underlying prerequisite, install missing dependencies, or synthesize a dedicated custom tool.',
        };
      }
    }

    // 2. Check Repeated Identical Tool Calls & Arguments
    const recentToolCalls = actions
      .filter(a => a.type === 'tool_call')
      .slice(-4);

    if (recentToolCalls.length >= this.maxSameActionThreshold) {
      const lastCall = recentToolCalls[recentToolCalls.length - 1];
      const identicalCount = recentToolCalls.filter(c =>
        c.tool === lastCall.tool &&
        JSON.stringify(c.arguments) === JSON.stringify(lastCall.arguments)
      ).length;

      if (identicalCount >= this.maxSameActionThreshold) {
        return {
          isStuck: true,
          type: 'REPEATED_ACTION',
          message: `Identical tool '${lastCall.tool}' called with exact same arguments ${identicalCount} times in a row.`,
          recommendedPivot: 'BREAK LOOP: You are repeating an action without parameter changes. Switch to validation or an alternate tool.',
        };
      }
    }

    return { isStuck: false };
  }
}

import crypto from 'crypto';
import { EvaluationReport } from '../types';
import { V2RayValidator } from '../v2ray/validator';

export class EvaluatorCore {
  private version = '2.0.0';

  public evaluateToolExecution(
    toolName: string,
    args: any,
    result: any,
    expectedOutput?: any
  ): EvaluationReport {
    const checks: Array<{ name: string; passed: boolean; details: string }> = [];
    let structuralScore = 1.0;
    let semanticScore = 1.0;
    let behavioralScore = 1.0;
    let runtimeScore = 1.0;
    let taskLevelScore = 1.0;

    // 1. Runtime Check
    const successCheck = result && result.success === true;
    checks.push({
      name: 'Runtime Execution Success',
      passed: !!successCheck,
      details: successCheck ? 'Executed without unhandled exception' : `Failed: ${result?.error?.message || 'Unknown error'}`,
    });
    if (!successCheck) runtimeScore = 0.0;

    // Latency Check
    const durationMs = result?.metadata?.duration_ms || 0;
    if (durationMs > 10000) {
      runtimeScore = Math.max(0.2, runtimeScore - 0.3);
      checks.push({
        name: 'Execution Latency Threshold',
        passed: false,
        details: `Execution took ${durationMs}ms (threshold 10000ms)`,
      });
    } else {
      checks.push({
        name: 'Execution Latency Threshold',
        passed: true,
        details: `Execution took ${durationMs}ms`,
      });
    }

    // 2. Structural Check
    const dataExists = result && result.data !== undefined && result.data !== null;
    checks.push({
      name: 'Structured Data Presence',
      passed: dataExists,
      details: dataExists ? 'Result data object exists' : 'Result data is null or empty',
    });
    if (!dataExists) structuralScore = Math.min(structuralScore, 0.4);

    // 3. Behavioral Check (against expected output if provided)
    if (expectedOutput !== undefined) {
      const match = JSON.stringify(result.data) === JSON.stringify(expectedOutput) ||
        (typeof expectedOutput === 'number' && Number(result.data) === expectedOutput) ||
        (typeof expectedOutput === 'string' && String(result.data).includes(expectedOutput));

      checks.push({
        name: 'Deterministic Behavioral Assertion',
        passed: !!match,
        details: match ? 'Output matches expected test assertions' : `Output ${JSON.stringify(result.data)} does not match expected ${JSON.stringify(expectedOutput)}`,
      });
      if (!match) behavioralScore = 0.0;
    }

    // 4. Domain Semantic Checks (Specialized)
    if (toolName.startsWith('v2ray_')) {
      if (result.data?.config) {
        const valRes = V2RayValidator.validate(result.data.config);
        checks.push({
          name: 'V2Ray Protocol Semantic Integrity',
          passed: valRes.valid,
          details: `V2Ray validation score: ${valRes.score}/100, errors: ${valRes.errors.length}`,
        });
        semanticScore = valRes.valid ? 1.0 : valRes.score / 100;
      }
    }

    taskLevelScore = (structuralScore + semanticScore + behavioralScore + runtimeScore) / 4;
    const overallScore = Number((
      structuralScore * 0.2 +
      semanticScore * 0.25 +
      behavioralScore * 0.25 +
      runtimeScore * 0.15 +
      taskLevelScore * 0.15
    ).toFixed(3));

    const passed = overallScore >= 0.70 && runtimeScore > 0 && structuralScore > 0.3;

    return {
      id: `eval_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      targetId: toolName,
      targetType: 'tool',
      layers: {
        structural: structuralScore,
        semantic: semanticScore,
        behavioral: behavioralScore,
        runtime: runtimeScore,
        taskLevel: taskLevelScore,
      },
      overallScore,
      passed,
      deterministicChecks: checks,
      evidence: [`tool_${toolName}_exec_${Date.now()}`],
      summary: `Autonomous Evaluation for '${toolName}': Score ${(overallScore * 100).toFixed(1)}% (${passed ? 'PASSED' : 'FAILED'}).`,
      evaluatedAt: new Date().toISOString(),
      evaluatorVersion: this.version,
    };
  }

  public evaluateArtifact(
    artifactType: string,
    content: string,
    goal: string
  ): EvaluationReport {
    const checks: Array<{ name: string; passed: boolean; details: string }> = [];
    let structuralScore = 1.0;
    let semanticScore = 1.0;
    let behavioralScore = 1.0;
    let runtimeScore = 1.0;
    let taskLevelScore = 1.0;

    // 1. Structural Check
    if (artifactType === 'json' || artifactType === 'v2ray_config') {
      try {
        const parsed = JSON.parse(content);
        checks.push({
          name: 'JSON Syntax Valid',
          passed: true,
          details: `Parsed JSON structure with ${Object.keys(parsed).length} top-level keys`,
        });

        // 2. Semantic Check for V2Ray
        if (artifactType === 'v2ray_config') {
          const valRes = V2RayValidator.validate(parsed);
          checks.push({
            name: 'V2Ray Protocol Schema Conformance',
            passed: valRes.valid,
            details: `Validator score: ${valRes.score}/100, warnings: ${valRes.warnings.length}, errors: ${valRes.errors.length}`,
          });
          semanticScore = valRes.valid ? 1.0 : (valRes.score / 100) * 0.4;
          if (!valRes.valid) {
            behavioralScore = 0.0;
            taskLevelScore = 0.2;
            structuralScore = 0.4;
          }
        }
      } catch (err: any) {
        checks.push({
          name: 'JSON Syntax Valid',
          passed: false,
          details: `JSON Parse Error: ${err.message}`,
        });
        structuralScore = 0.0;
        semanticScore = 0.0;
        behavioralScore = 0.0;
        taskLevelScore = 0.0;
      }
    } else if (artifactType === 'python') {
      const hasDef = content.includes('def ') || content.includes('import ');
      checks.push({
        name: 'Python Code Structure',
        passed: hasDef,
        details: hasDef ? 'Valid python function definitions detected' : 'Missing standard python structure',
      });
      if (!hasDef) structuralScore = 0.5;
    }

    const overallScore = Number((
      structuralScore * 0.3 +
      semanticScore * 0.3 +
      behavioralScore * 0.2 +
      runtimeScore * 0.1 +
      taskLevelScore * 0.1
    ).toFixed(3));

    const passed = overallScore >= 0.75;

    return {
      id: `eval_art_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      targetId: artifactType,
      targetType: 'artifact',
      layers: {
        structural: structuralScore,
        semantic: semanticScore,
        behavioral: behavioralScore,
        runtime: runtimeScore,
        taskLevel: taskLevelScore,
      },
      overallScore,
      passed,
      deterministicChecks: checks,
      evidence: [`artifact_${artifactType}_${Date.now()}`],
      summary: `Autonomous Artifact Verification for ${artifactType}: Score ${(overallScore * 100).toFixed(1)}% (${passed ? 'VERIFIED' : 'REJECTED'}).`,
      evaluatedAt: new Date().toISOString(),
      evaluatorVersion: this.version,
    };
  }
}

export const defaultEvaluator = new EvaluatorCore();

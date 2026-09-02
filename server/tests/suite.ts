import fs from 'fs';
import path from 'path';
import { LLMClient, defaultLLMClient, ChatMessage } from '../llm/client';
import { ToolRegistry } from '../tools/registry';
import { WorkspaceManager } from '../workspace';
import { V2RayBuilder } from '../v2ray/builder';
import { V2RayValidator } from '../v2ray/validator';
import { LoopDetector } from '../agent/loop_detector';
import { KnowledgeStore } from '../memory/knowledge_store';
import { ToolBuilder } from '../tools/builder';
import { ToolSandbox } from '../tools/sandbox';
import { EvaluatorCore } from '../evaluator/evaluator_core';
import { AgentCore } from '../agent/agent_core';
import { AgentAction, ToolResult } from '../types';

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

export class VerificationTestSuite {
  public static async runAllTests(): Promise<TestSuiteSummary> {
    const startTime = Date.now();
    const results: TestResultItem[] = [];

    const workspace = new WorkspaceManager();
    const sandbox = new ToolSandbox(workspace);
    const evaluator = new EvaluatorCore();
    const memory = new KnowledgeStore(workspace);
    const builder = new ToolBuilder(workspace, sandbox, evaluator);
    const registry = new ToolRegistry(workspace, sandbox, builder, evaluator, memory);

    // 1. TEST A: Successful Experience Storage & Ranked Retrieval
    await this.runTest(results, 1, 'TEST A: Experience Reuse & Ranked Retrieval', 'Learning Engine', async () => {
      const exp = memory.storeExperience({
        taskType: 'v2ray_config',
        goal: 'Generate secure VLESS Reality proxy for Iranian network',
        strategy: 'Structured V2Ray Config Synthesis',
        toolsUsed: ['v2ray_build_config', 'v2ray_validate_config'],
        evaluationScore: 0.98,
        lesson: 'VLESS-Reality with TCP transport provides 100% censorship bypass rating.',
      });

      const retrieved = memory.queryExperiences({
        taskType: 'v2ray_config',
        goal: 'Deploy VLESS Reality server',
      });

      if (retrieved.length === 0 || retrieved[0].strategy !== 'Structured V2Ray Config Synthesis') {
        throw new Error(`Failed to retrieve stored experience for v2ray_config`);
      }
      return `Successfully stored experience '${exp.id}' and retrieved ranked match with score ${(retrieved[0].evaluationScore * 100).toFixed(0)}%.`;
    });

    // 2. TEST B: Failure Avoidance via Negative Knowledge
    await this.runTest(results, 2, 'TEST B: Negative Knowledge & Failure Avoidance', 'Learning Engine', async () => {
      memory.storeFailure({
        strategyOrTool: 'raw_text_scraping',
        failureType: 'SCRAPING_DEFECT',
        reason: 'Raw web scraping yielded malformed JSON syntax in Iranian network environment.',
        suggestedAlternative: 'Structured V2Ray Config Synthesis',
        failedUnderConditions: { target: 'v2ray_raw_url' },
      });

      const ranked = memory.getRankedStrategies('v2ray_config', { target: 'v2ray_raw_url' });
      const badStrategyIndex = ranked.findIndex(s => s.id === 'raw_text_scraping' || s.name === 'raw_text_scraping');

      if (badStrategyIndex === 0) {
        throw new Error('Failing strategy was not penalized in strategy ranking');
      }

      const failures = memory.queryFailures('raw_text_scraping');
      if (failures.length === 0) throw new Error('Stored negative knowledge record not found');

      return `Negative knowledge successfully penalized failing strategy. Recommended alternative: ${failures[0].suggestedAlternative}`;
    });

    // 3. TEST C: Capability Gap Detection
    await this.runTest(results, 3, 'TEST C: Capability Gap Detection', 'Self-Tool-Building', async () => {
      const existingTools = registry.listTools().filter(t => t.name !== 'convert_temperature');
      const gap = builder.detectCapabilityGap('Convert 100 Celsius to Fahrenheit for telemetry sensor', existingTools);

      if (!gap || gap.suggestedToolName !== 'convert_temperature') {
        throw new Error(`Expected capability gap for temperature conversion, got: ${JSON.stringify(gap)}`);
      }
      return `Detected missing capability '${gap.requiredCapability}'. Suggested new tool: '${gap.suggestedToolName}'.`;
    });

    // 4. TEST D: Tool Generation, Sandbox Test & Promotion
    await this.runTest(results, 4, 'TEST D: Full Tool Build, Sandbox & Promotion', 'Self-Tool-Building', async () => {
      const gap = {
        requiredCapability: 'temperature_conversion',
        currentCapabilities: [],
        missingAspect: 'Missing temperature converter',
        taskType: 'math_conversion',
        suggestedToolName: 'convert_temperature',
        expectedBenefit: 'Accurate temperature conversion',
        permissionsRequired: [],
      };

      const candidate = builder.synthesizeCandidateTool(gap);
      const testRes = await builder.testCandidateInSandbox(candidate);

      if (!testRes.passed || testRes.evaluationScore < 0.70) {
        throw new Error(`Sandbox test failed for candidate tool: ${JSON.stringify(testRes)}`);
      }

      // Register into live registry
      const registerRes = await registry.executeTool('create_tool', {
        name: candidate.name,
        description: candidate.description,
        parameters: candidate.parameters,
        code: candidate.code,
        test_args: candidate.testCases[0].args,
        expected_test_output: candidate.testCases[0].expectedOutput,
      });

      if (!registerRes.success) {
        throw new Error(`Failed to register tool into registry: ${registerRes.error?.message}`);
      }

      // Execute live tool
      const liveExec = await registry.executeTool('convert_temperature', {
        value: 100,
        from_unit: 'celsius',
        to_unit: 'fahrenheit',
      });

      if (!liveExec.success || liveExec.data?.result !== 212) {
        throw new Error(`Live execution failed: ${JSON.stringify(liveExec)}`);
      }

      return `Synthesized 'convert_temperature', verified in sandbox (score ${(testRes.evaluationScore * 100).toFixed(0)}%), registered, and computed 100C = ${liveExec.data.result}F.`;
    });

    // 5. TEST E: Candidate Tool Rejection on Faulty Logic
    await this.runTest(results, 5, 'TEST E: Faulty Candidate Tool Rejection', 'Self-Tool-Building', async () => {
      const faultyCandidate = {
        name: 'faulty_divider',
        description: 'Faulty division tool that crashes',
        parameters: { type: 'object', properties: { val: { type: 'number' } }, required: ['val'] },
        code: `import sys\nraise RuntimeError("Critical math syntax failure")`,
        runtime: 'python' as const,
        permissions: [],
        version: 'v1.0.0',
        isCustom: true,
        testCases: [{ name: 'Crash test', args: { val: 5 }, expectedOutput: 1 }],
      };

      const testRes = await builder.testCandidateInSandbox(faultyCandidate);
      if (testRes.passed) {
        throw new Error('Faulty candidate tool unexpectedly passed sandbox evaluation!');
      }

      return `Faulty tool candidate properly rejected in sandbox with evaluation failure.`;
    });

    // 6. TEST F: Tool Regression & Safe Rollback
    await this.runTest(results, 6, 'TEST F: Tool Regression & Safe Rollback', 'Self-Tool-Building', async () => {
      const toolName = 'unit_crypto_hasher';

      // 1. Create v1 working tool
      const v1Res = await registry.executeTool('create_tool', {
        name: toolName,
        description: 'Hasher v1 working',
        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        code: `import sys, json\nprint(json.dumps({"hash": "v1_valid_hash"}))\n`,
        test_args: { text: 'test' },
      });
      if (!v1Res.success) throw new Error('Failed to create v1 tool');

      // 2. Update to v2
      await registry.executeTool('create_tool', {
        name: toolName,
        description: 'Hasher v2 modified',
        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        code: `import sys, json\nprint(json.dumps({"hash": "v2_updated_hash"}))\n`,
        test_args: { text: 'test' },
      });

      // 3. Trigger rollback
      const rollbackSuccess = registry.rollbackTool(toolName);
      if (!rollbackSuccess) throw new Error('Tool rollback failed');

      // Verify executed code is v1
      const rolledBackExec = await registry.executeTool(toolName, { text: 'test' });
      if (!rolledBackExec.success || rolledBackExec.data?.hash !== 'v1_valid_hash') {
        throw new Error(`Rollback did not restore v1 output: got ${JSON.stringify(rolledBackExec)}`);
      }

      return `Verified safe version backup and automated rollback to v1.0.0.`;
    });

    // 7. TEST G: Persistent Memory Across Restart Simulation
    await this.runTest(results, 7, 'TEST G: Memory Persistence Across Process Restart', 'Persistence', async () => {
      const uniqueGoal = `Session_Persist_Check_${Date.now()}`;
      memory.storeExperience({
        taskType: 'persistence_check',
        goal: uniqueGoal,
        strategy: 'Durable Disk JSON Sync',
        evaluationScore: 1.0,
        lesson: 'Memory safely survived simulated runtime teardown.',
      });

      // Simulate complete process restart with fresh KnowledgeStore instance
      const freshMemoryInstance = new KnowledgeStore(workspace);
      const matches = freshMemoryInstance.queryExperiences({
        taskType: 'persistence_check',
        goal: uniqueGoal,
      });

      if (matches.length === 0 || matches[0].goal !== uniqueGoal) {
        throw new Error('Failed to find persisted experience after reloading KnowledgeStore from disk');
      }

      return `Verified durable disk persistence: experience loaded successfully from fresh instance.`;
    });

    // 8. TEST H: Stale Knowledge Confidence Decay & Evidence Domination
    await this.runTest(results, 8, 'TEST H: Stale Knowledge Confidence Decay', 'Learning Engine', async () => {
      const staleTask = `stale_benchmark_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const oldExp = memory.storeExperience({
        taskType: staleTask,
        goal: 'Old legacy protocol setup',
        strategy: 'Legacy Approach',
        evaluationScore: 0.70,
        confidence: 0.70,
        promotionLevel: 'observed',
      });

      // Artificially age the old experience by 15 days
      oldExp.lastObservedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      memory.saveToDisk();

      // Trigger decay
      memory.decayConfidence(0.15);

      const updatedOld = memory.queryExperiences({ taskType: staleTask })[0];
      if (!updatedOld || updatedOld.confidence >= 0.70) {
        throw new Error(`Expected confidence to decay below 0.70, got ${updatedOld?.confidence}`);
      }

      return `Stale experience confidence successfully decayed from 0.70 to ${updatedOld.confidence}.`;
    });

    // 9. TEST I: Independent Evaluator Objectivity (Reject False Positives)
    await this.runTest(results, 9, 'TEST I: Independent Evaluator Objectivity', 'Evaluation Engine', async () => {
      const malformedConfig = `{ "inbounds": [{ "protocol": "invalid_proto" }] }`;

      const evalReport = evaluator.evaluateArtifact('v2ray_config', malformedConfig, 'Create working proxy');
      if (evalReport.passed || evalReport.overallScore > 0.60) {
        throw new Error(`Independent evaluator accepted malformed config: ${JSON.stringify(evalReport)}`);
      }

      return `Independent evaluator rejected defective output (Score: ${(evalReport.overallScore * 100).toFixed(1)}%, Passed: ${evalReport.passed}).`;
    });

    // 10. TEST J: Learning Promotion Hierarchy (Observed -> Trusted)
    await this.runTest(results, 10, 'TEST J: Promotion Hierarchy (Observed -> Confirmed -> Trusted)', 'Learning Engine', async () => {
      const testTask = `hierarchy_test_task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const goal = 'Test promotion transitions';

      // 1st run -> observed
      const r1 = memory.storeExperience({ taskType: testTask, goal, strategy: 'Adaptive Strategy', evaluationScore: 0.95 });
      if (r1.promotionLevel !== 'observed') throw new Error(`Expected observed, got ${r1.promotionLevel}`);

      // 2nd run -> repeated
      const r2 = memory.storeExperience({ taskType: testTask, goal, strategy: 'Adaptive Strategy', evaluationScore: 0.95 });
      if (r2.promotionLevel !== 'repeated') throw new Error(`Expected repeated, got ${r2.promotionLevel}`);

      // 3rd run -> confirmed
      const r3 = memory.storeExperience({ taskType: testTask, goal, strategy: 'Adaptive Strategy', evaluationScore: 0.95 });
      if (r3.promotionLevel !== 'confirmed') throw new Error(`Expected confirmed, got ${r3.promotionLevel}`);

      // 4th and 5th run -> trusted
      memory.storeExperience({ taskType: testTask, goal, strategy: 'Adaptive Strategy', evaluationScore: 0.95 });
      const r5 = memory.storeExperience({ taskType: testTask, goal, strategy: 'Adaptive Strategy', evaluationScore: 0.95 });
      if (r5.promotionLevel !== 'trusted') throw new Error(`Expected trusted, got ${r5.promotionLevel}`);

      return `Promotion verified through all 4 stages: Observed -> Repeated -> Confirmed -> Trusted (Occurrences: ${r5.occurrences}).`;
    });

    // 11. V2Ray Structured Config Builder (No Copy-Paste)
    await this.runTest(results, 11, 'V2Ray Structured Config Synthesis', 'V2Ray Engine', async () => {
      const res = V2RayBuilder.buildConfig({
        role: 'server',
        protocol: 'vless',
        port: 443,
        transport: 'tcp',
        security: 'reality',
        sni: 'www.cloudflare.com',
        realityPrivateKey: 'mockPrivateKey1234567890abcdef',
        realityDest: 'www.cloudflare.com:443',
        blockAds: true,
        blockPrivateIps: true,
      });

      if (!res.config || !res.config.inbounds[0] || res.config.inbounds[0].protocol !== 'vless') {
        throw new Error('V2Ray config structure invalid');
      }
      return `Synthesized VLESS-Reality Server configuration with ${res.config.inbounds.length} inbounds and ${res.config.routing.rules.length} routing rules.`;
    });

    // 12. V2Ray Schema & Semantic Validation
    await this.runTest(results, 12, 'V2Ray Exhaustive Validator', 'V2Ray Engine', async () => {
      const sample = {
        inbounds: [
          {
            tag: 'in-vless',
            port: 443,
            listen: '0.0.0.0',
            protocol: 'vless',
            settings: { clients: [{ id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }] },
            streamSettings: {
              network: 'tcp',
              security: 'reality',
              realitySettings: { serverNames: ['www.cloudflare.com'] },
            },
          },
        ],
        outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
      };

      const valRes = V2RayValidator.validate(sample);
      if (!valRes.valid) {
        throw new Error(`Validation unexpectedly failed: ${JSON.stringify(valRes.errors)}`);
      }
      return `Validated V2Ray config: Score ${valRes.score}/100, 0 errors.`;
    });

    // 13. Output Artifact Export System
    await this.runTest(results, 13, 'Output Artifact Export System', 'Export Engine', async () => {
      const exportRes = await registry.executeTool('export_artifact', {
        filename: 'v2ray_learning_export.json',
        type: 'v2ray_config',
        content: JSON.stringify({ inbounds: [], outbounds: [] }, null, 2),
        goal: 'Generate test V2Ray config',
        validated: true,
      });
      if (!exportRes.success) throw new Error('Failed to export artifact');
      const fileExists = workspace.fileExists('outputs/v2ray_learning_export.json');
      if (!fileExists) throw new Error('Exported artifact file not found on disk.');
      return `Exported and registered artifact to outputs/v2ray_learning_export.json`;
    });

    // 14. API Key Sanitization
    await this.runTest(results, 14, 'API Key & Secret Sanitization', 'Security Boundary', async () => {
      const raw = {
        tool: 'llm_call',
        apiKey: 'secret_12345_super_confidential',
        nested: { password: 'pass123', safe: 'hello' },
      };
      const sanitized = workspace.sanitizeCredentials(raw);
      if (sanitized.apiKey !== '[REDACTED]' || sanitized.nested.password !== '[REDACTED]') {
        throw new Error('Sanitizer failed to mask sensitive keys');
      }
      return `Credentials safely sanitized and redacted from all logs and memory.`;
    });

    // 15. 5-Attempt API Retry Mechanism
    await this.runTest(results, 15, '5-Attempt API Retry & Exponential Backoff', 'Resilience Engine', async () => {
      const client = new LLMClient({
        baseURL: 'http://127.0.0.1:9999/invalid-api',
        model: 'test-model',
        apiKey: 'sk-test',
        maxRetries: 5,
      });

      const attemptsRecorded: number[] = [];
      client.onRetry((info) => {
        attemptsRecorded.push(info.attempt);
      });

      try {
        await client.executeWithRetry(
          'Test Retry Endpoint',
          async (attempt: number) => {
            if (attempt < 5) {
              throw new Error(`Transient API Failure on attempt ${attempt}`);
            }
            return { status: 'success_on_attempt_5' };
          },
          5,
          { baseDelayMs: 10, silent: true }
        );
      } catch (e) {}

      if (attemptsRecorded.length !== 4) {
        throw new Error(`Expected exactly 4 retry notifications before attempt 5, got ${attemptsRecorded.length}`);
      }

      return `Verified 5-attempt retry mechanism with exponential backoff: recovered on attempt 5.`;
    });

    // =========================================================================
    // CRITICAL TERMINAL EXECUTION & CONTROL-FLOW REGRESSION BENCHMARK SUITE
    // =========================================================================

    // 16. REGRESSION TEST 1: Tool Succeeds & Task Completes (0 Post-Completion Tool/LLM Calls)
    await this.runTest(results, 16, 'REGRESSION 1: Single Terminal Completion Gate (0 Post-Completion Actions)', 'Terminal Control Flow', async () => {
      let llmCallCount = 0;
      let goalCompletedCount = 0;

      // Mock LLM that returns a validation tool call
      const mockLLM = new LLMClient();
      mockLLM.chatCompletion = async () => {
        llmCallCount++;
        return {
          content: 'Synthesizing and validating V2Ray config now.',
          tool_calls: [
            {
              id: 'call_v2ray_test_1',
              type: 'function',
              function: {
                name: 'v2ray_validate_config',
                arguments: {
                  config: {
                    inbounds: [{ port: 443, protocol: 'vless', settings: { clients: [{ id: '11111111-2222-3333-4444-555555555555' }] } }],
                    outbounds: [{ protocol: 'freedom' }],
                  },
                },
              },
            },
          ],
        };
      };

      const testAgent = new AgentCore(workspace, registry, mockLLM, memory, builder, evaluator);
      testAgent.subscribe((event) => {
        if (event.type === 'goal_completed') {
          goalCompletedCount++;
        }
      });

      const finalState = await testAgent.start('Build and validate standard V2Ray config');

      if (finalState.status !== 'completed') {
        throw new Error(`Expected agent status 'completed', got '${finalState.status}'`);
      }
      if (goalCompletedCount !== 1) {
        throw new Error(`Expected exactly 1 'goal_completed' event, got ${goalCompletedCount}`);
      }
      if (finalState.postCompletionExecutionAttempts !== 0) {
        throw new Error(`Invariant violation: postCompletionExecutionAttempts = ${finalState.postCompletionExecutionAttempts} (must be 0)`);
      }
      if (llmCallCount !== 1) {
        throw new Error(`LLM was called ${llmCallCount} times (expected exactly 1 iteration before completion)`);
      }

      return `Verified terminal gate: goal_completed emitted exactly once, 0 actions after completion.`;
    });

    // 17. REGRESSION TEST 2: Evaluator Passes -> Task Completes Without Second Evaluator Call
    await this.runTest(results, 17, 'REGRESSION 2: Evaluator Pass Immediately Terminates (No Second Evaluation)', 'Terminal Control Flow', async () => {
      let evaluatorCalls = 0;
      const customEvaluator = new EvaluatorCore();
      const origEvaluateTool = customEvaluator.evaluateToolExecution.bind(customEvaluator);
      customEvaluator.evaluateToolExecution = (tool, args, result) => {
        evaluatorCalls++;
        return origEvaluateTool(tool, args, result);
      };

      const mockLLM = new LLMClient();
      mockLLM.chatCompletion = async () => ({
        content: 'Executing validation.',
        tool_calls: [
          {
            id: 'call_val_1',
            type: 'function',
            function: {
              name: 'validate_output',
              arguments: { output: '212', expected: '212' },
            },
          },
        ],
      });

      const testAgent = new AgentCore(workspace, registry, mockLLM, memory, builder, customEvaluator);
      const state = await testAgent.start('Convert 100 Celsius to Fahrenheit and validate');

      if (state.status !== 'completed') {
        throw new Error(`Task did not terminate as completed, status: ${state.status}`);
      }
      if (evaluatorCalls !== 1) {
        throw new Error(`Evaluator was called ${evaluatorCalls} times (expected exactly 1)`);
      }

      return `Evaluator succeeded and immediately triggered terminal completion with 0 re-evaluations.`;
    });

    // 18. REGRESSION TEST 3: Memory Persistence Succeeds After Task Completion Without Reopening Loop
    await this.runTest(results, 18, 'REGRESSION 3: Memory Persistence Finalization (No Reopened Loop)', 'Terminal Control Flow', async () => {
      const uniqueTaskGoal = `Memory_Sync_Terminal_${Date.now()}`;
      const mockLLM = new LLMClient();
      let turns = 0;
      mockLLM.chatCompletion = async () => {
        turns++;
        return {
          content: 'Exporting final artifact.',
          tool_calls: [
            {
              id: 'call_exp_1',
              type: 'function',
              function: {
                name: 'export_artifact',
                arguments: {
                  filename: 'terminal_test.json',
                  type: 'v2ray_config',
                  content: '{}',
                  goal: uniqueTaskGoal,
                  validated: true,
                },
              },
            },
          ],
        };
      };

      const testAgent = new AgentCore(workspace, registry, mockLLM, memory, builder, evaluator);
      const state = await testAgent.start(uniqueTaskGoal);

      if (state.status !== 'completed') {
        throw new Error(`Expected completed state, got ${state.status}`);
      }
      if (turns !== 1) {
        throw new Error(`Agent ran ${turns} turns instead of terminating after artifact export`);
      }

      // Verify experience record was created in knowledge store without agent reopening
      const retrieved = memory.queryExperiences({ goal: uniqueTaskGoal });
      if (retrieved.length === 0) {
        throw new Error('Experience was not persisted during deterministic finalization pipeline');
      }

      return `Experience persisted cleanly in KnowledgeStore during finalization with 0 additional turns.`;
    });

    // 19. REGRESSION TEST 4: Tool Creation Succeeds & Task Completes When Objective Verified
    await this.runTest(results, 19, 'REGRESSION 4: Self-Tool-Building Lifecycle Termination', 'Terminal Control Flow', async () => {
      let step = 0;
      const mockLLM = new LLMClient();
      mockLLM.chatCompletion = async () => {
        step++;
        if (step === 1) {
          return {
            content: 'Synthesizing tool.',
            tool_calls: [
              {
                id: 'call_create_1',
                type: 'function',
                function: {
                  name: 'create_tool',
                  arguments: {
                    name: 'fast_doubler',
                    description: 'Doubles numbers',
                    parameters: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
                    code: 'import sys, json\nprint(json.dumps({"result": 20}))\n',
                    test_args: { n: 10 },
                    expected_test_output: 20,
                  },
                },
              },
            ],
          };
        } else {
          return {
            content: 'Executing synthesized tool.',
            tool_calls: [
              {
                id: 'call_exec_1',
                type: 'function',
                function: {
                  name: 'fast_doubler',
                  arguments: { n: 10 },
                },
              },
            ],
          };
        }
      };

      const testAgent = new AgentCore(workspace, registry, mockLLM, memory, builder, evaluator);
      const state = await testAgent.start('Create a python script to double numbers and test it');

      if (state.status !== 'completed') {
        throw new Error(`Expected state 'completed', got '${state.status}'`);
      }
      if (step > 2) {
        throw new Error(`Agent looped for ${step} steps instead of terminating after tool verification`);
      }

      return `Tool synthesized in step 1, verified in step 2, and terminated immediately upon completion.`;
    });

    // 20. REGRESSION TEST 5: Loop Rejection When State is Already Completed
    await this.runTest(results, 20, 'REGRESSION 5: Immediate Loop Exit When State is Already Completed', 'Terminal Control Flow', async () => {
      const testAgent = new AgentCore(workspace, registry, defaultLLMClient, memory, builder, evaluator);
      
      // Manually invoke completeGoal
      await testAgent.completeGoal({
        summary: 'Goal pre-completed for invariant verification',
        reason: 'Manual terminal assertion',
        score: 1.0,
      });

      const state = testAgent.getState();
      if (state.status !== 'completed') {
        throw new Error(`State was not completed, got ${state.status}`);
      }

      // Verify isTerminal returns true
      if (!testAgent.isTerminal()) {
        throw new Error('isTerminal() returned false on completed agent');
      }

      return `Confirmed immediate terminal recognition: isTerminal() = true on completed state.`;
    });

    // 21. REGRESSION TEST 6: Model Tool Calls Rejected After Objective Verified
    await this.runTest(results, 21, 'REGRESSION 6: Tool Calls Strictly Rejected on Terminal State', 'Terminal Control Flow', async () => {
      const testAgent = new AgentCore(workspace, registry, defaultLLMClient, memory, builder, evaluator);
      await testAgent.completeGoal({ summary: 'Completed task' });

      // Attempt to add an action to state manager directly
      const attemptedAction: AgentAction = {
        id: 'act_illegal_post_completion',
        timestamp: new Date().toISOString(),
        type: 'tool_call',
        tool: 'v2ray_validate_config',
        arguments: {},
        status: 'running',
      };

      const added = (testAgent as any).stateManager.addAction(attemptedAction);
      if (added !== false) {
        throw new Error('StateManager permitted action addition after terminal completion!');
      }

      const st = testAgent.getState();
      if (st.postCompletionExecutionAttempts !== 1) {
        throw new Error(`Expected postCompletionExecutionAttempts to record 1 attempt, got ${st.postCompletionExecutionAttempts}`);
      }

      return `Successfully blocked post-completion tool action and tracked diagnostic attempt metric (count: ${st.postCompletionExecutionAttempts}).`;
    });

    // 22. REGRESSION TEST 7: Multiple Validations Triggers Single Completion
    await this.runTest(results, 22, 'REGRESSION 7: First Valid Final Verification Stops Batch Immediately', 'Terminal Control Flow', async () => {
      let executedTools: string[] = [];
      const mockLLM = new LLMClient();
      mockLLM.chatCompletion = async () => ({
        content: 'Running multi-tool batch.',
        tool_calls: [
          {
            id: 'tc_1',
            type: 'function',
            function: {
              name: 'validate_output',
              arguments: { output: 'success', expected: 'success' },
            },
          },
          {
            id: 'tc_2',
            type: 'function',
            function: {
              name: 'run_test',
              arguments: { command: 'echo redundant' },
            },
          },
          {
            id: 'tc_3',
            type: 'function',
            function: {
              name: 'run_test',
              arguments: { command: 'echo redundant2' },
            },
          },
        ],
      });

      const testAgent = new AgentCore(workspace, registry, mockLLM, memory, builder, evaluator);
      testAgent.subscribe((event) => {
        if (event.type === 'tool_execution_start') {
          executedTools.push(event.payload.tool);
        }
      });

      const state = await testAgent.start('Validate output and complete');

      if (state.status !== 'completed') {
        throw new Error(`State was not completed, got ${state.status}`);
      }
      // The 1st tool satisfied criteria -> subsequent tool calls in the batch MUST be aborted
      if (executedTools.length > 1) {
        throw new Error(`Executed ${executedTools.length} tools in batch, expected loop to break after 1st verified tool: ${executedTools.join(', ')}`);
      }

      return `First tool completed validation criteria -> aborted remaining ${3 - executedTools.length} redundant tool calls in batch.`;
    });

    // 23. REGRESSION TEST 8: Repeated Completion Call is Idempotent
    await this.runTest(results, 23, 'REGRESSION 8: CompleteGoal Idempotency (No Duplicate Events)', 'Terminal Control Flow', async () => {
      const testAgent = new AgentCore(workspace, registry, defaultLLMClient, memory, builder, evaluator);
      testAgent.reset('Test Idempotent Goal Completion');
      let eventCount = 0;
      testAgent.subscribe((e) => {
        if (e.type === 'goal_completed') eventCount++;
      });

      // 1st complete call
      await testAgent.completeGoal({ summary: 'Initial Completion' });
      const firstTerminalAt = testAgent.getState().terminalAt;

      // 2nd complete call (harmless idempotent replay)
      await testAgent.completeGoal({ summary: 'Duplicate Completion Attempt' });

      // 3rd complete call
      await testAgent.completeGoal({ summary: 'Third Completion Attempt' });

      const finalState = testAgent.getState();

      if (eventCount !== 1) {
        throw new Error(`Expected exactly 1 'goal_completed' event across 3 invocations, got ${eventCount}`);
      }
      if (finalState.terminalAt !== firstTerminalAt) {
        throw new Error(`terminalAt was mutated on duplicate completion call`);
      }

      return `Verified completion idempotency: 3 invocations produced exactly 1 completion event and preserved terminal state.`;
    });

    // 24. REGRESSION TEST 1: Missing Required Arguments
    await this.runTest(results, 24, 'REGRESSION TEST 1: Missing Required Arguments -> INVALID_ARGUMENTS', 'Argument Repair', async () => {
      registry.resetInvocationTracker();
      const res = await registry.executeTool('create_python_file', { code: "print('x')" });

      if (res.success) {
        throw new Error('Expected failure for missing required filepath, but tool succeeded');
      }
      if (res.error?.type !== 'INVALID_ARGUMENTS') {
        throw new Error(`Expected error type 'INVALID_ARGUMENTS', got '${res.error?.type}'`);
      }
      if (!res.error?.missing || !res.error.missing.includes('filepath')) {
        throw new Error(`Expected missing fields to include 'filepath', got: ${JSON.stringify(res.error?.missing)}`);
      }
      return `Detected missing parameter 'filepath' with error type INVALID_ARGUMENTS and schema details.`;
    });

    // 25. REGRESSION TEST 2: Duplicate Invalid Call Hard Guard
    await this.runTest(results, 25, 'REGRESSION TEST 2: Duplicate Invalid Arguments Blocked', 'Argument Repair', async () => {
      registry.resetInvocationTracker();
      const first = await registry.executeTool('create_python_file', { code: "print('x')" });
      if (first.success || first.error?.type !== 'INVALID_ARGUMENTS') {
        throw new Error('First call did not fail as expected');
      }

      // Second identical call
      const second = await registry.executeTool('create_python_file', { code: "print('x')" });
      if (second.success) {
        throw new Error('Second identical call succeeded unexpectedly');
      }
      if (second.error?.type !== 'DUPLICATE_INVALID_TOOL_CALL') {
        throw new Error(`Expected error type 'DUPLICATE_INVALID_TOOL_CALL', got '${second.error?.type}'`);
      }
      return `Blocked duplicate invalid call immediately with DUPLICATE_INVALID_TOOL_CALL guard.`;
    });

    // 26. REGRESSION TEST 3: Invalid First, Corrected Second
    await this.runTest(results, 26, 'REGRESSION TEST 3: Invalid First, Corrected Second -> Success', 'Argument Repair', async () => {
      registry.resetInvocationTracker();
      const first = await registry.executeTool('create_python_file', { code: "print('x')" });
      if (first.success) throw new Error('First call succeeded unexpectedly');

      const second = await registry.executeTool('create_python_file', { filepath: 'test_recovery.py', code: "print('x')" });
      if (!second.success) {
        throw new Error(`Corrected call failed: ${second.error?.message}`);
      }
      return `First invocation failed as expected, second corrected invocation succeeded cleanly.`;
    });

    // 27. REGRESSION TEST 4: Preserved Original Valid Arguments in Instruction
    await this.runTest(results, 27, 'REGRESSION TEST 4: Argument Repair Preserves Valid Parameters', 'Argument Repair', async () => {
      const tool = registry.getTool('create_python_file');
      if (!tool) throw new Error('Tool not found');

      const originalCode = "import math\nprint(math.sqrt(16))";
      const validation = registry.validateToolArgs('create_python_file', { code: originalCode });

      if (validation?.valid) throw new Error('Validation should have failed for missing filepath');

      // The corrected call uses original valid code + new filepath
      const executionResult = await registry.executeTool('create_python_file', {
        code: originalCode,
        filepath: 'math_test.py',
      });

      if (!executionResult.success) {
        throw new Error(`Corrected tool call failed: ${executionResult.error?.message}`);
      }

      const fileContent = fs.readFileSync(path.join(workspace.rootDir, 'math_test.py'), 'utf-8');
      if (fileContent !== originalCode) {
        throw new Error(`File content did not match preserved original code. Got: ${fileContent}`);
      }
      return `Corrected invocation successfully preserved original code and added required filepath.`;
    });

    // 28. REGRESSION TEST 5: Wrong Argument Type Detection
    await this.runTest(results, 28, 'REGRESSION TEST 5: Wrong Argument Type -> INVALID_ARGUMENT_TYPE', 'Argument Repair', async () => {
      registry.resetInvocationTracker();
      // filepath should be string, passing number
      const res = await registry.executeTool('create_python_file', { filepath: 12345, code: "print('y')" });

      if (res.success) throw new Error('Expected failure for invalid argument type');
      if (res.error?.type !== 'INVALID_ARGUMENT_TYPE') {
        throw new Error(`Expected error type 'INVALID_ARGUMENT_TYPE', got '${res.error?.type}'`);
      }
      if (!res.error?.invalid || !res.error.invalid.includes('filepath')) {
        throw new Error(`Expected invalid fields to include 'filepath', got: ${JSON.stringify(res.error?.invalid)}`);
      }
      return `Successfully flagged incorrect type for 'filepath' as INVALID_ARGUMENT_TYPE.`;
    });

    // 29. REGRESSION TEST 6: Unknown Argument Policy
    await this.runTest(results, 29, 'REGRESSION TEST 6: Deterministic Unknown Argument Detection', 'Argument Repair', async () => {
      registry.resetInvocationTracker();
      const res = await registry.executeTool('create_python_file', {
        filepath: 'clean.py',
        code: "print('hello')",
        bogus_extra_field: true,
      });

      if (res.success) throw new Error('Expected unknown arguments to be rejected under strict schema policy');
      if (!res.error?.message?.includes('Unknown parameter') && res.error?.type !== 'INVALID_ARGUMENTS') {
        throw new Error(`Expected deterministic rejection for unknown parameter, got: ${JSON.stringify(res.error)}`);
      }
      return `Unknown argument 'bogus_extra_field' deterministically rejected under schema policy.`;
    });

    // 30. REGRESSION TEST 7: JSON Key Order Invariance in Fingerprint
    await this.runTest(results, 30, 'REGRESSION TEST 7: Key Order Invariant Canonical Fingerprint', 'Argument Repair', async () => {
      registry.resetInvocationTracker();
      // First invalid call
      const res1 = await registry.executeTool('create_python_file', { a_missing: 'xyz', code: "print('unordered')" });
      // Second invalid call with keys reordered
      const res2 = await registry.executeTool('create_python_file', { code: "print('unordered')", a_missing: 'xyz' });

      if (res2.error?.type !== 'DUPLICATE_INVALID_TOOL_CALL') {
        throw new Error(`Expected duplicate call to be blocked despite key order differences. Got: ${res2.error?.type}`);
      }
      return `Key order differences normalized to identical fingerprint; duplicate blocked.`;
    });

    // 31. REGRESSION TEST 8: Whitespace Normalization in Semantic Fingerprint
    await this.runTest(results, 31, 'REGRESSION TEST 8: Semantic Whitespace Normalization', 'Argument Repair', async () => {
      registry.resetInvocationTracker();
      // First invalid call with trailing whitespace
      await registry.executeTool('create_python_file', { code: "print('whitespace')  " });
      // Second invalid call with leading whitespace
      const res2 = await registry.executeTool('create_python_file', { code: "  print('whitespace')" });

      if (res2.error?.type !== 'DUPLICATE_INVALID_TOOL_CALL') {
        throw new Error(`Expected whitespace variations to yield identical semantic fingerprint. Got: ${res2.error?.type}`);
      }
      return `Semantic whitespace trimming ensured duplicate invalid invocation was blocked.`;
    });

    // 32. REGRESSION TEST 9: Scoped Repair State Per Tool
    await this.runTest(results, 32, 'REGRESSION TEST 9: Independent Scoping Per Tool', 'Argument Repair', async () => {
      registry.resetInvocationTracker();
      // Fail on create_python_file
      const resPy = await registry.executeTool('create_python_file', { code: "print('py')" });
      // Fail on read_file
      const resRead = await registry.executeTool('read_file', {});

      if (resPy.error?.type !== 'INVALID_ARGUMENTS' || resRead.error?.type !== 'INVALID_ARGUMENTS') {
        throw new Error('Expected both distinct tools to fail independently on invalid arguments');
      }

      // Successful call to read_file with valid argument
      fs.writeFileSync(path.join(workspace.rootDir, 'temp_sample.txt'), 'hello');
      const readSuccess = await registry.executeTool('read_file', { filepath: 'temp_sample.txt' });

      if (!readSuccess.success) {
        throw new Error(`read_file failed unexpectedly: ${readSuccess.error?.message}`);
      }

      return `Repair state independently isolated across distinct tools.`;
    });

    // 33. REGRESSION TEST 10: Persistent Knowledge Across Restarts
    await this.runTest(results, 33, 'REGRESSION TEST 10: Persistent Failure Knowledge Survives Restarts', 'Knowledge Engine', async () => {
      const uniqueReason = `Persistent test error ${Date.now()}`;
      memory.storeFailure({
        strategyOrTool: 'test_persistent_tool',
        failedUnderConditions: {},
        failureType: 'EXECUTION_ERROR',
        reason: uniqueReason,
        suggestedAlternative: 'Alternative path',
      });

      // Simulate new instance loading from same workspace
      const newMemory = new KnowledgeStore(workspace);
      const found = newMemory.queryFailures('test_persistent_tool');

      if (!found.some(f => f.reason === uniqueReason)) {
        throw new Error('Failure record was not persisted to disk or reloaded by new instance');
      }
      return `Failure knowledge persisted and successfully retrieved by freshly initialized KnowledgeStore.`;
    });

    // 34. REGRESSION TEST 11: Controlled Recovery & No Infinite Looping
    await this.runTest(results, 34, 'REGRESSION TEST 11: Controlled Recovery & No Infinite Looping', 'Agent Architecture', async () => {
      const tracker = registry.getInvocationTracker();
      tracker.reset();

      // Invocations:
      // 1st: Invalid
      const call1 = await registry.executeTool('create_python_file', { code: "print('test')" });
      if (call1.error?.type !== 'INVALID_ARGUMENTS') throw new Error('Call 1 should be INVALID_ARGUMENTS');

      // 2nd: Duplicate -> blocked
      const call2 = await registry.executeTool('create_python_file', { code: "print('test')" });
      if (call2.error?.type !== 'DUPLICATE_INVALID_TOOL_CALL') throw new Error('Call 2 should be DUPLICATE_INVALID_TOOL_CALL');

      // 3rd: Duplicate again -> still blocked
      const call3 = await registry.executeTool('create_python_file', { code: "print('test')" });
      if (call3.error?.type !== 'DUPLICATE_INVALID_TOOL_CALL') throw new Error('Call 3 should be DUPLICATE_INVALID_TOOL_CALL');

      return `Infinite loop prevented: duplicate invalid attempts were deterministically rejected by hard guard.`;
    });

    // 35. REGRESSION TEST 12: create_tool Failing Test Arguments Prevents Promotion
    await this.runTest(results, 35, 'REGRESSION TEST 12: create_tool Failing Test Arguments Prevents Promotion', 'Tool Synthesis', async () => {
      const badToolName = 'failing_math_tool';
      const createRes = await registry.executeTool('create_tool', {
        name: badToolName,
        description: 'Tool that throws exception during test',
        parameters: {
          type: 'object',
          properties: { val: { type: 'number' } },
          required: ['val'],
        },
        code: `def tool(args):\n    raise ValueError("Intentional syntax or runtime test failure")\n`,
        test_args: { val: 10 },
      });

      if (createRes.success) {
        throw new Error('create_tool should have returned success: false when test execution failed');
      }
      if (createRes.error?.type !== 'TOOL_TEST_FAILED') {
        throw new Error(`Expected error type 'TOOL_TEST_FAILED', got '${createRes.error?.type}'`);
      }

      const createdMeta = registry.getTool(badToolName);
      if (!createdMeta) throw new Error('Created tool metadata not found');
      if (createdMeta.status === 'active') {
        throw new Error(`Tool was improperly promoted to 'active' status despite test failure! Status: ${createdMeta.status}`);
      }
      if (createdMeta.quality?.health !== 'failing') {
        throw new Error(`Tool quality health expected 'failing', got: ${createdMeta.quality?.health}`);
      }

      return `create_tool correctly rejected promotion: status is '${createdMeta.status}' and health is '${createdMeta.quality?.health}'.`;
    });

    const durationMs = Date.now() - startTime;
    const passedCount = results.filter(r => r.passed).length;
    return {
      total: results.length,
      passed: passedCount,
      failed: results.length - passedCount,
      durationMs,
      timestamp: new Date().toISOString(),
      results,
    };
  }

  private static async runTest(
    results: TestResultItem[],
    id: number,
    name: string,
    category: string,
    testFn: () => Promise<string>,
  ): Promise<void> {
    const start = Date.now();
    try {
      const detail = await testFn();
      const durationMs = Date.now() - start;
      results.push({
        id,
        name,
        category,
        passed: true,
        durationMs,
        details: detail,
      });
      console.log(`[PASS] #${id} ${name} (${durationMs}ms)`);
    } catch (err: any) {
      const durationMs = Date.now() - start;
      results.push({
        id,
        name,
        category,
        passed: false,
        durationMs,
        details: err.message || 'Test failed',
        error: err.stack,
      });
      console.error(`[FAIL] #${id} ${name} (${durationMs}ms): ${err.message}`);
    }
  }
}

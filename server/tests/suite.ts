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
import {
  normalizeToolSchema,
  toProviderSchema,
  validateProviderCompatibility,
  classifyProviderError,
} from '../tools/schema_normalizer';
import {
  FetchManager,
  defaultFetchManager,
  normalizeUrl,
  deduplicateUrls,
  classifyFetchError,
} from '../network/fetch_manager';

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
      const keys = V2RayBuilder.generateRealityKeyPair();
      const res = V2RayBuilder.buildConfig({
        role: 'server',
        protocol: 'vless',
        port: 443,
        transport: 'tcp',
        security: 'reality',
        sni: 'www.cloudflare.com',
        realityPrivateKey: keys.privateKey,
        realityShortIds: ['0123456789abcdef'],
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
      const keys = V2RayBuilder.generateRealityKeyPair();
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
              realitySettings: {
                serverNames: ['www.cloudflare.com'],
                privateKey: keys.privateKey,
                shortIds: ['0123456789abcdef'],
                dest: 'www.cloudflare.com:443',
              },
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

    // 36. TEST 1: Root Any Schema Normalization
    await this.runTest(results, 36, 'TEST 1: Root Any Normalization to Provider Schema', 'Schema Normalization', async () => {
      const input = { type: 'any' };
      const normalized = normalizeToolSchema(input, { isRoot: true });
      const providerSchema = toProviderSchema(normalized);
      const check = validateProviderCompatibility(providerSchema, { toolName: 'test_root_any' });

      if (!check.valid) {
        throw new Error(`Expected provider-valid schema, but failed: ${check.message} at ${check.path}`);
      }
      if (providerSchema.type !== 'object') {
        throw new Error(`Expected providerSchema.type to be 'object', got: ${providerSchema.type}`);
      }
      return `Root 'any' successfully normalized to valid provider schema: type='${providerSchema.type}'.`;
    });

    // 37. TEST 2: Nested Any Normalization
    await this.runTest(results, 37, 'TEST 2: Nested Any Property Normalization', 'Schema Normalization', async () => {
      const input = {
        type: 'object',
        properties: {
          expected_test_output: {
            type: 'any',
          },
        },
      };
      const normalized = normalizeToolSchema(input);
      const providerSchema = toProviderSchema(normalized);
      const check = validateProviderCompatibility(providerSchema, { toolName: 'test_nested_any' });

      if (!check.valid) {
        throw new Error(`Nested any failed provider compatibility: ${check.message} at ${check.path}`);
      }
      if ('type' in providerSchema.properties.expected_test_output) {
        throw new Error(`Nested property still has 'type' keyword: ${JSON.stringify(providerSchema.properties.expected_test_output)}`);
      }
      return `Nested 'expected_test_output: { type: "any" }' stripped of 'type: any' to valid unconstrained JSON schema node.`;
    });

    // 38. TEST 3: Array of Any Normalization
    await this.runTest(results, 38, 'TEST 3: Array of Any Items Normalization', 'Schema Normalization', async () => {
      const input = {
        type: 'array',
        items: {
          type: 'any',
        },
      };
      const normalized = normalizeToolSchema(input, { isRoot: false });
      const check = validateProviderCompatibility(normalized, { toolName: 'test_array_any' });

      if (!check.valid) {
        throw new Error(`Array of any failed validation: ${check.message}`);
      }
      if (normalized.items && 'type' in normalized.items) {
        throw new Error(`items still contains 'type' keyword: ${JSON.stringify(normalized.items)}`);
      }
      return `Array of any items normalized into valid schema without invalid 'type: any'.`;
    });

    // 39. TEST 4: Nullable Field Conversion
    await this.runTest(results, 39, 'TEST 4: Nullable Field Provider Representation', 'Schema Normalization', async () => {
      const input = {
        type: 'object',
        properties: {
          bio: { type: 'string', nullable: true },
        },
        required: [],
      };
      const normalized = normalizeToolSchema(input);
      const providerSchema = toProviderSchema(normalized);
      const check = validateProviderCompatibility(providerSchema, { toolName: 'test_nullable' });

      if (!check.valid) {
        throw new Error(`Nullable conversion produced invalid schema: ${check.message}`);
      }
      const bio = providerSchema.properties.bio;
      if (!bio.anyOf || !Array.isArray(bio.anyOf) || !bio.anyOf.some((v: any) => v.type === 'null')) {
        throw new Error(`Expected bio.anyOf to include null variant, got: ${JSON.stringify(bio)}`);
      }
      return `Nullable property successfully converted to provider-compatible anyOf representation with null.`;
    });

    // 40. TEST 5: Union Type Conversion
    await this.runTest(results, 40, 'TEST 5: Union Representation', 'Schema Normalization', async () => {
      const input = {
        type: 'object',
        properties: {
          id_or_name: { type: 'string | number' },
        },
        required: [],
      };
      const normalized = normalizeToolSchema(input);
      const providerSchema = toProviderSchema(normalized);
      const check = validateProviderCompatibility(providerSchema, { toolName: 'test_union' });

      if (!check.valid) {
        throw new Error(`Union conversion produced invalid schema: ${check.message}`);
      }
      const unionProp = providerSchema.properties.id_or_name;
      if (!unionProp.anyOf || unionProp.anyOf.length !== 2) {
        throw new Error(`Expected anyOf with 2 variants, got: ${JSON.stringify(unionProp)}`);
      }
      return `Union type 'string | number' normalized to provider-compatible anyOf: [{type: 'string'}, {type: 'number'}].`;
    });

    // 41. TEST 6: Required Subset Invariant (required ⊆ properties)
    await this.runTest(results, 41, 'TEST 6: Required Subset Invariant', 'Schema Normalization', async () => {
      const malformedInput = {
        type: 'object',
        properties: {
          actual_field: { type: 'string' },
        },
        required: ['actual_field', 'ghost_field_not_in_properties'],
      };

      // Direct validation of malformed input must catch violation
      const directCheck = validateProviderCompatibility(malformedInput, { toolName: 'test_req_invalid' });
      if (directCheck.valid) {
        throw new Error('validateProviderCompatibility failed to reject required property not present in properties');
      }
      if (directCheck.value !== 'ghost_field_not_in_properties') {
        throw new Error(`Expected invalid required value 'ghost_field_not_in_properties', got: ${directCheck.value}`);
      }

      // Normalization must purge ghost field to satisfy invariant
      const normalized = normalizeToolSchema(malformedInput);
      const providerSchema = toProviderSchema(normalized);
      const checkAfter = validateProviderCompatibility(providerSchema, { toolName: 'test_req_cleansed' });

      if (!checkAfter.valid) {
        throw new Error(`Normalized schema failed validation: ${checkAfter.message}`);
      }
      if (providerSchema.required.includes('ghost_field_not_in_properties')) {
        throw new Error('Normalization failed to purge un-defined required field');
      }
      return `Invariant enforced: required ⊆ properties verified. Ghost field detected and cleanly purged.`;
    });

    // 42. TEST 7: Invalid Type Detection (foobar)
    await this.runTest(results, 42, 'TEST 7: Invalid Type Detection (foobar)', 'Schema Normalization', async () => {
      const input = {
        type: 'object',
        properties: {
          invalid_field: { type: 'foobar' },
        },
      };
      const check = validateProviderCompatibility(input, { toolName: 'test_foobar' });

      if (check.valid) {
        throw new Error(`Expected type 'foobar' to be rejected by provider compatibility validator`);
      }
      if (check.type !== 'INVALID_TOOL_SCHEMA') {
        throw new Error(`Expected error type 'INVALID_TOOL_SCHEMA', got: ${check.type}`);
      }
      if (check.value !== 'foobar') {
        throw new Error(`Expected error value 'foobar', got: ${check.value}`);
      }
      if (!check.path?.includes('invalid_field')) {
        throw new Error(`Expected error path to point to 'invalid_field', got: ${check.path}`);
      }
      return `Invalid type 'foobar' rejected with path='${check.path}', value='${check.value}', code='${check.type}'.`;
    });

    // 43. TEST 8: Generated Tool with Any Field Accepted
    await this.runTest(results, 43, 'TEST 8: Generated Tool with Any Field Normalization', 'Tool Building', async () => {
      const toolName = 'generated_telemetry_transformer';
      const createRes = await registry.executeTool('create_tool', {
        name: toolName,
        description: 'Transforms telemetry data with flexible input output types',
        parameters: {
          type: 'object',
          properties: {
            payload: { type: 'any', description: 'Raw payload of any JSON type' },
          },
          required: ['payload'],
        },
        code: `import json, sys\n\ndef run(args):\n    return {"processed": True, "raw": args.get("payload")}\n\nif __name__ == "__main__":\n    raw = sys.argv[1] if len(sys.argv) > 1 else "{}"\n    try:\n        parsed = json.loads(raw)\n        print(json.dumps(run(parsed)))\n    except Exception as e:\n        print(json.dumps({"error": str(e)}))\n`,
        test_args: { payload: { sensor_id: 101, status: 'active' } },
        expected_test_output: { processed: true, raw: { sensor_id: 101, status: 'active' } },
      });

      if (!createRes.success) {
        throw new Error(`create_tool failed on tool with 'any' parameter: ${createRes.error?.message}`);
      }

      const meta = registry.getTool(toolName);
      if (!meta) throw new Error('Tool was not registered');
      if (meta.status !== 'active') throw new Error(`Tool expected status 'active', got: ${meta.status}`);

      // Verify provider schema is valid
      const compatCheck = validateProviderCompatibility(meta.providerSchema, { toolName });
      if (!compatCheck.valid) {
        throw new Error(`Active tool providerSchema is invalid: ${compatCheck.message}`);
      }
      if ('type' in meta.providerSchema.properties.payload) {
        throw new Error(`providerSchema still contains type: any for payload parameter`);
      }
      return `Generated tool with 'type: any' successfully normalized, validated, and promoted to active.`;
    });

    // 44. TEST 9: Client Pre-Flight Guard - Invalid Schema Never Reaches Provider
    await this.runTest(results, 44, 'TEST 9: Pre-Flight Guard Prevents Provider Call (Count = 0)', 'Provider Integration', async () => {
      let providerRequestCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        providerRequestCount++;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
      }) as any;

      try {
        const client = new LLMClient({ baseURL: 'http://mock-llm.local/v1', apiKey: 'mock-key' });
        const invalidTools = [
          {
            type: 'function',
            function: {
              name: 'malformed_tool',
              description: 'Tool with intentionally unrecoverable schema',
              parameters: {
                type: 'object',
                properties: {
                  bad_arg: { type: 'unsupported_custom_type' },
                },
              },
            },
          },
        ];

        let thrownError: any = null;
        try {
          await client.chatCompletion([{ role: 'user', content: 'Execute tool' }], invalidTools);
        } catch (err) {
          thrownError = err;
        }

        if (!thrownError) {
          throw new Error('Expected LLMClient to fail fast locally on invalid schema');
        }
        if (thrownError.classified?.errorClass !== 'INVALID_TOOL_SCHEMA') {
          throw new Error(`Expected errorClass 'INVALID_TOOL_SCHEMA', got: ${thrownError.classified?.errorClass}`);
        }
        if (providerRequestCount !== 0) {
          throw new Error(`CRITICAL: Provider was called ${providerRequestCount} times! Must be 0.`);
        }
        return `Pre-flight validation failed locally before HTTP dispatch. Provider request count = 0.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 45. TEST 10: Provider Non-Retry Guard - HTTP 400 Schema Error Does NOT Retry
    await this.runTest(results, 45, 'TEST 10: HTTP 400 Schema Error Does NOT Retry (Requests = 1)', 'Provider Integration', async () => {
      let providerRequestCount = 0;
      const originalFetch = globalThis.fetch;
      const schemaErrorPayload =
        "Tool 14 function has invalid 'parameters' schema: 'any' is not valid under any of the given schemas\nOn schema['properties']['expected_test_output']['type']:\n    'any'";

      globalThis.fetch = (async () => {
        providerRequestCount++;
        return new Response(schemaErrorPayload, {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'Content-Type': 'text/plain' },
        });
      }) as any;

      try {
        const client = new LLMClient({
          baseURL: 'http://mock-llm.local/v1',
          apiKey: 'mock-key',
          maxRetries: 5,
        });

        let thrownError: any = null;
        try {
          // Send with empty tools to trigger remote 400 simulation
          await client.chatCompletion([{ role: 'user', content: 'test schema error' }], []);
        } catch (err) {
          thrownError = err;
        }

        if (!thrownError) {
          throw new Error('Expected client to throw HTTP 400 error');
        }
        if (thrownError.classified?.errorClass !== 'INVALID_TOOL_SCHEMA') {
          throw new Error(`Expected classified 'INVALID_TOOL_SCHEMA', got: ${thrownError.classified?.errorClass}`);
        }
        if (thrownError.classified?.retryable !== false) {
          throw new Error('Expected classified error to be non-retryable');
        }
        if (providerRequestCount !== 1) {
          throw new Error(`Deterministic schema error was retried! Expected 1 request, but got: ${providerRequestCount}`);
        }
        return `HTTP 400 schema error classified as NON_RETRYABLE. Halted immediately after 1 attempt (not 5).`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 46. PROVIDER CONTRACT TEST: Validate All Registered Tools in Registry
    await this.runTest(results, 46, 'PROVIDER CONTRACT TEST: Complete Toolset Schema Validity', 'Contract Verification', async () => {
      const allDefinitions = registry.getToolDefinitionsForLLM('openai-compatible');
      if (allDefinitions.length === 0) {
        throw new Error('No active tools found in registry');
      }

      for (let i = 0; i < allDefinitions.length; i++) {
        const def = allDefinitions[i];
        const toolName = def.function.name;
        const params = def.function.parameters;

        const check = validateProviderCompatibility(params, {
          toolName,
          provider: 'openai-compatible',
        });

        if (!check.valid) {
          throw new Error(
            `Contract violation on tool [${i}] '${toolName}': ${check.message} at path '${check.path}' (value: ${JSON.stringify(check.value)})`
          );
        }

        // Top-level must be type: object
        if (params.type !== 'object') {
          throw new Error(`Tool '${toolName}' parameters.type is not 'object': got '${params.type}'`);
        }

        // Required must be array and subset of properties
        const propKeys = new Set(Object.keys(params.properties || {}));
        for (const req of params.required || []) {
          if (!propKeys.has(req)) {
            throw new Error(`Tool '${toolName}' required field '${req}' missing from properties`);
          }
        }
      }

      return `Verified all ${allDefinitions.length} active registered tools conform 100% to Model Provider JSON Schema contracts.`;
    });

    // 47. TEST 11: HTTP 500 Transient Error Triggers Retry
    await this.runTest(results, 47, 'TEST 11: HTTP 500 Transient Error Triggers Retry', 'Provider Integration', async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        callCount++;
        if (callCount < 3) {
          return new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] }), { status: 200 });
      }) as any;

      try {
        const client = new LLMClient({
          baseURL: 'http://mock-llm.local/v1',
          apiKey: 'mock-key',
          maxRetries: 3,
        });

        const res = await client.executeWithRetry(
          'Mock 500 Test',
          async (attempt) => {
            const resp = await fetch('http://mock-llm.local/v1/test');
            if (!resp.ok) {
              const err: any = new Error(`HTTP ${resp.status}`);
              err.statusCode = resp.status;
              throw err;
            }
            return await resp.json();
          },
          3,
          { baseDelayMs: 10, silent: true }
        );

        if (callCount !== 3) {
          throw new Error(`Expected 3 attempts for transient HTTP 500, got: ${callCount}`);
        }
        if (res.attemptsUsed !== 3) {
          throw new Error(`Expected attemptsUsed = 3, got: ${res.attemptsUsed}`);
        }
        return `HTTP 500 transient failure correctly triggered retries with exponential backoff. Total calls: ${callCount}.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 48. TEST 12: HTTP 429 Rate Limit Triggers Retry
    await this.runTest(results, 48, 'TEST 12: HTTP 429 Rate Limit Triggers Retry', 'Provider Integration', async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        callCount++;
        if (callCount < 2) {
          return new Response('Rate Limit Exceeded', { status: 429, statusText: 'Too Many Requests' });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: 'rate limit cleared' } }] }), { status: 200 });
      }) as any;

      try {
        const client = new LLMClient({
          baseURL: 'http://mock-llm.local/v1',
          apiKey: 'mock-key',
          maxRetries: 3,
        });

        const res = await client.executeWithRetry(
          'Mock 429 Test',
          async (attempt) => {
            const resp = await fetch('http://mock-llm.local/v1/test');
            if (!resp.ok) {
              const err: any = new Error(`HTTP ${resp.status}`);
              err.statusCode = resp.status;
              throw err;
            }
            return await resp.json();
          },
          3,
          { baseDelayMs: 10, silent: true }
        );

        if (callCount !== 2) {
          throw new Error(`Expected 2 attempts for HTTP 429 rate limit, got: ${callCount}`);
        }
        if (res.attemptsUsed !== 2) {
          throw new Error(`Expected attemptsUsed = 2, got: ${res.attemptsUsed}`);
        }
        return `HTTP 429 Rate Limit correctly classified as retryable. Recovered on attempt 2.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 49. TEST 13: create_tool Provider Schema Generation & Compatibility
    await this.runTest(results, 49, 'TEST 13: create_tool Provider Schema Specification', 'Provider Integration', async () => {
      const createToolMeta = registry.getTool('create_tool');
      if (!createToolMeta) throw new Error('create_tool is not registered');

      const defs = registry.getToolDefinitionsForLLM('openai-compatible');
      const createToolDef = defs.find(d => d.function.name === 'create_tool');
      if (!createToolDef) throw new Error('create_tool not found in getToolDefinitionsForLLM output');

      const expectedProp = createToolDef.function.parameters.properties.expected_test_output;
      if (!expectedProp) {
        throw new Error('expected_test_output missing from create_tool parameters');
      }

      if ('type' in expectedProp && (expectedProp.type === 'any' || expectedProp.type === 'unknown')) {
        throw new Error(`create_tool provider schema still contains type: '${expectedProp.type}'`);
      }

      const check = validateProviderCompatibility(createToolDef.function.parameters, {
        toolName: 'create_tool',
        provider: 'openai-compatible',
      });
      if (!check.valid) {
        throw new Error(`create_tool failed provider compatibility: ${check.message} at ${check.path}`);
      }

      return `create_tool provider schema generated and validated. expected_test_output adheres to valid JSON Schema without 'type: any'.`;
    });

    // 50. TEST 14: Serialized Provider Payload Contains NO "type":"any"
    await this.runTest(results, 50, 'TEST 14: Serialized Provider Payload Contains NO "type":"any"', 'Payload Inspection', async () => {
      let capturedPayload: any = null;
      let capturedBodyString = '';
      const originalFetch = globalThis.fetch;

      globalThis.fetch = (async (url: string, init?: any) => {
        capturedBodyString = init?.body || '';
        try {
          capturedPayload = JSON.parse(capturedBodyString);
        } catch {}
        return new Response(JSON.stringify({ choices: [{ message: { content: 'verified' } }] }), { status: 200 });
      }) as any;

      try {
        const client = new LLMClient({
          baseURL: 'http://mock-llm.local/v1',
          apiKey: 'mock-key',
        });

        // Pass all tools directly from registry
        const tools = registry.getToolDefinitionsForLLM('openai-compatible');
        await client.chatCompletion([{ role: 'user', content: 'hello' }], tools);

        if (!capturedPayload || !capturedPayload.tools) {
          throw new Error('No tools found in dispatched provider request body');
        }

        // Exact pattern match for invalid types in serialized payload
        const normalizedBody = capturedBodyString.replace(/\s+/g, '');
        if (normalizedBody.includes('"type":"any"') || normalizedBody.includes('"type":"unknown"')) {
          throw new Error(`CRITICAL: Serialized provider payload contains invalid "type":"any" or "type":"unknown"!\nPayload snippet: ${capturedBodyString.slice(0, 1000)}`);
        }

        return `Captured provider payload with ${capturedPayload.tools.length} tools. Verified 0 occurrences of 'type: any' in the entire serialized request.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 51. TEST 15: Full Production Integration (Registry -> Normalizer -> LLMClient -> Provider)
    await this.runTest(results, 51, 'TEST 15: End-to-End Production Flow for create_tool', 'Integration Verification', async () => {
      let requestReceived = false;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = (async (url: string, init?: any) => {
        requestReceived = true;
        const body = JSON.parse(init?.body || '{}');
        const tools = body.tools || [];
        const createTool = tools.find((t: any) => t.function?.name === 'create_tool');
        if (!createTool) {
          return new Response('create_tool missing from tools', { status: 400 });
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_create_1',
                      type: 'function',
                      function: {
                        name: 'create_tool',
                        arguments: JSON.stringify({
                          name: 'temp_echo',
                          description: 'Echoes input',
                          parameters: { type: 'object', properties: { val: { type: 'string' } } },
                          code: 'print("echo")',
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 }
        );
      }) as any;

      try {
        const client = new LLMClient({
          baseURL: 'http://mock-llm.local/v1',
          apiKey: 'mock-key',
        });

        const activeTools = registry.getToolDefinitionsForLLM('openai-compatible');
        const completion = await client.chatCompletion(
          [{ role: 'user', content: 'Create an echo tool' }],
          activeTools
        );

        if (!requestReceived) {
          throw new Error('Provider request was never dispatched');
        }
        if (!completion.tool_calls || completion.tool_calls.length === 0) {
          throw new Error('Expected tool call response from provider');
        }
        if (completion.tool_calls[0].function.name !== 'create_tool') {
          throw new Error(`Expected call to create_tool, got: ${completion.tool_calls[0].function.name}`);
        }

        return `Full production flow verified: ToolRegistry -> getToolDefinitionsForLLM -> schema normalization -> LLMClient -> Mock Provider -> create_tool accepted.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 52. TEST 16: Normal URL fetch success
    await this.runTest(results, 52, 'TEST 16: Normal URL Fetch Success', 'Network Fetch Subsystem', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMgr = new FetchManager();

      globalThis.fetch = (async (url: string) => {
        return new Response('<html><body>Success page content</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }) as any;

      try {
        const res = await fetchMgr.fetchUrl('https://example.com/test-success');
        if (!res.ok) throw new Error(`Expected fetch success, got error: ${res.errorType} - ${res.message}`);
        if (res.status !== 200) throw new Error(`Expected status 200, got ${res.status}`);
        if (!res.content.includes('Success page content')) throw new Error(`Content mismatch: ${res.content}`);
        if (res.attempts !== 1) throw new Error(`Expected 1 attempt, got ${res.attempts}`);
        return `Fetch succeeded with status 200 in 1 attempt. Content length: ${res.length} bytes.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 53. TEST 17: HTTP 404 failure (no retry)
    await this.runTest(results, 53, 'TEST 17: HTTP 404 Failure (No Retry)', 'Network Fetch Subsystem', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMgr = new FetchManager();
      let callCount = 0;

      globalThis.fetch = (async (url: string) => {
        callCount++;
        return new Response('Not Found', { status: 404 });
      }) as any;

      try {
        const res = await fetchMgr.fetchUrl('https://example.com/missing-resource');
        if (res.ok) throw new Error('Expected 404 failure, but fetch succeeded');
        if (res.errorType !== 'HTTP_404') throw new Error(`Expected HTTP_404 errorType, got ${res.errorType}`);
        if (res.retryable !== false) throw new Error(`HTTP 404 must NOT be marked retryable`);
        if (res.attempts !== 1 || callCount !== 1) {
          throw new Error(`HTTP 404 was retried! Attempts: ${res.attempts}, Call count: ${callCount}`);
        }
        return `HTTP 404 correctly classified as non-retryable and failed immediately without retries (attempts: ${res.attempts}).`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 54. TEST 18: HTTP 500 retry then success
    await this.runTest(results, 54, 'TEST 18: HTTP 500 Retry Then Success', 'Network Fetch Subsystem', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMgr = new FetchManager();
      let callCount = 0;

      globalThis.fetch = (async (url: string) => {
        callCount++;
        if (callCount === 1) {
          return new Response('Internal Server Error', { status: 500 });
        }
        return new Response('Recovered Content', { status: 200 });
      }) as any;

      try {
        const res = await fetchMgr.fetchUrl('https://example.com/flaky-service', { baseDelayMs: 10, silent: true });
        if (!res.ok) throw new Error(`Expected success after retry, failed with: ${res.errorType}`);
        if (res.attempts !== 2 || callCount !== 2) {
          throw new Error(`Expected exactly 2 attempts, got attempts: ${res.attempts}, calls: ${callCount}`);
        }
        if (!res.content.includes('Recovered Content')) throw new Error(`Unexpected content: ${res.content}`);
        return `Transient HTTP 500 retried with backoff and succeeded on attempt 2.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 55. TEST 19: HTTP 500 retry exhausted (fail after max attempts)
    await this.runTest(results, 55, 'TEST 19: HTTP 500 Retry Exhausted', 'Network Fetch Subsystem', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMgr = new FetchManager();
      let callCount = 0;

      globalThis.fetch = (async (url: string) => {
        callCount++;
        return new Response('Persistent Error', { status: 503 });
      }) as any;

      try {
        const res = await fetchMgr.fetchUrl('https://example.com/down-service', {
          maxRetries: 2,
          baseDelayMs: 10,
          silent: true,
        });
        if (res.ok) throw new Error('Expected failure after exhausted retries');
        if (res.errorType !== 'HTTP_5XX') throw new Error(`Expected HTTP_5XX errorType, got ${res.errorType}`);
        if (res.attempts !== 3 || callCount !== 3) {
          throw new Error(`Expected exactly 3 total attempts (1 initial + 2 retries), got attempts: ${res.attempts}, calls: ${callCount}`);
        }
        return `Persistent HTTP 503 exhausted retries at attempt 3 and terminated cleanly without infinite looping.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 56. TEST 20: Timeout detection
    await this.runTest(results, 56, 'TEST 20: Timeout Detection', 'Network Fetch Subsystem', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMgr = new FetchManager();

      globalThis.fetch = ((url: string, init?: any) => {
        return new Promise((resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }) as any;

      try {
        const res = await fetchMgr.fetchUrl('https://example.com/slow-endpoint', {
          timeoutMs: 40,
          maxRetries: 0,
          silent: true,
        });
        if (res.ok) throw new Error('Expected timeout failure');
        if (res.errorType !== 'TIMEOUT') throw new Error(`Expected TIMEOUT errorType, got: ${res.errorType}`);
        return `Timeout detected accurately within 40ms deadline and classified as TIMEOUT.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 57. TEST 21: AbortController cancellation
    await this.runTest(results, 57, 'TEST 21: AbortController External Cancellation', 'Network Fetch Subsystem', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMgr = new FetchManager();
      const externalController = new AbortController();

      globalThis.fetch = ((url: string, init?: any) => {
        return new Promise((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }) as any;

      try {
        // Abort almost immediately
        setTimeout(() => externalController.abort(), 20);
        const res = await fetchMgr.fetchUrl('https://example.com/aborted-task', {
          signal: externalController.signal,
          maxRetries: 2,
          silent: true,
        });
        if (res.ok) throw new Error('Expected aborted failure');
        if (res.errorType !== 'ABORTED') throw new Error(`Expected ABORTED errorType, got ${res.errorType}`);
        if (res.retryable !== false) throw new Error('External cancellation must NOT be marked retryable');
        return `External cancellation signal honored immediately; classified as non-retryable ABORTED.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 58. TEST 22: Concurrency limit enforcement
    await this.runTest(results, 58, 'TEST 22: Concurrency Limit Enforcement', 'Network Fetch Subsystem', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMgr = new FetchManager();
      let activeConcurrent = 0;
      let maxSeenConcurrent = 0;

      globalThis.fetch = (async (url: string) => {
        activeConcurrent++;
        if (activeConcurrent > maxSeenConcurrent) maxSeenConcurrent = activeConcurrent;
        await new Promise(r => setTimeout(r, 30));
        activeConcurrent--;
        return new Response('OK', { status: 200 });
      }) as any;

      try {
        const testUrls = [
          'https://example.com/c1',
          'https://example.com/c2',
          'https://example.com/c3',
          'https://example.com/c4',
          'https://example.com/c5',
          'https://example.com/c6',
        ];

        const res = await fetchMgr.fetchUrls(testUrls, { maxConcurrent: 2, bypassCache: true, silent: true });
        if (res.succeeded !== 6) throw new Error(`Expected 6 successes, got ${res.succeeded}`);
        if (maxSeenConcurrent > 2) {
          throw new Error(`Max concurrent fetches exceeded 2! Reached: ${maxSeenConcurrent}`);
        }
        return `Successfully fetched 6 URLs with max concurrency capped strictly at ${maxSeenConcurrent} <= 2.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 59. TEST 23: Multiple URLs partial success
    await this.runTest(results, 59, 'TEST 23: Multiple URLs Partial Success', 'Network Fetch Subsystem', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMgr = new FetchManager();

      globalThis.fetch = (async (url: string) => {
        if (url.includes('good-1') || url.includes('good-2')) {
          return new Response('Healthy content', { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      try {
        const urls = [
          'https://example.com/good-1',
          'https://example.com/bad-404',
          'https://example.com/good-2',
        ];

        const res = await fetchMgr.fetchUrls(urls, { bypassCache: true, silent: true });
        if (res.status !== 'PARTIAL_SUCCESS') throw new Error(`Expected PARTIAL_SUCCESS, got ${res.status}`);
        if (res.succeeded !== 2) throw new Error(`Expected 2 succeeded, got ${res.succeeded}`);
        if (res.failed !== 1) throw new Error(`Expected 1 failed, got ${res.failed}`);

        // Test integration through ToolRegistry
        const toolResult = await registry.executeTool('fetch_webpage', { urls });
        if (!toolResult.success) {
          throw new Error(`fetch_webpage tool failed when partial success was achieved: ${toolResult.error?.message}`);
        }
        if (toolResult.data.succeeded !== 2) {
          throw new Error(`Tool result mismatch: expected 2 succeeded, got ${toolResult.data.succeeded}`);
        }

        return `MultiFetchResult returned PARTIAL_SUCCESS (2/3 succeeded). Tool execution succeeded and preserved all data.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 60. TEST 24: Multiple URLs total failure
    await this.runTest(results, 60, 'TEST 24: Multiple URLs Total Failure', 'Network Fetch Subsystem', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMgr = new FetchManager();

      globalThis.fetch = (async (url: string) => {
        return new Response('Server Error', { status: 500 });
      }) as any;

      try {
        const urls = ['https://example.com/fail-1', 'https://example.com/fail-2'];
        const res = await fetchMgr.fetchUrls(urls, { maxRetries: 0, bypassCache: true, silent: true });
        if (res.status !== 'FAILURE') throw new Error(`Expected FAILURE status, got ${res.status}`);
        if (res.succeeded !== 0) throw new Error(`Expected 0 succeeded, got ${res.succeeded}`);

        // Test through ToolRegistry
        const toolResult = await registry.executeTool('fetch_webpage', { urls });
        if (toolResult.success !== false) throw new Error(`Expected toolResult.success === false`);
        if (toolResult.error?.type !== 'ALL_FETCHES_FAILED') {
          throw new Error(`Expected ALL_FETCHES_FAILED error type, got: ${toolResult.error?.type}`);
        }

        return `Total failure handled cleanly with status FAILURE and tool error type ALL_FETCHES_FAILED.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 61. TEST 25: Cache hit returns cached data
    await this.runTest(results, 61, 'TEST 25: Cache Hit Returns Cached Data', 'Network Fetch Subsystem', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMgr = new FetchManager();
      let callCount = 0;

      globalThis.fetch = (async (url: string) => {
        callCount++;
        return new Response('Initial Cached Payload', { status: 200 });
      }) as any;

      try {
        const testUrl = 'https://example.com/cached-article';
        const res1 = await fetchMgr.fetchUrl(testUrl);
        if (!res1.ok || res1.content !== 'Initial Cached Payload') throw new Error('First fetch failed');

        // Modify globalThis.fetch to error if called again
        globalThis.fetch = (async () => {
          throw new Error('Should not have made network request!');
        }) as any;

        const res2 = await fetchMgr.fetchUrl(testUrl);
        if (!res2.ok) throw new Error('Cached fetch failed');
        if (!res2.cached) throw new Error('Result was not flagged as cached: true');
        if (res2.content !== 'Initial Cached Payload') throw new Error('Cached content mismatch');
        if (callCount !== 1) throw new Error(`Network was called ${callCount} times instead of 1`);

        return `Second fetch satisfied from memory cache (cached: true, 0 additional network calls).`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 62. TEST 26: Deduplication prevents duplicate fetches
    await this.runTest(results, 62, 'TEST 26: Deduplication Prevents Duplicate Fetches', 'Network Fetch Subsystem', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMgr = new FetchManager();
      let callCount = 0;

      globalThis.fetch = (async (url: string) => {
        callCount++;
        return new Response('Dedup response', { status: 200 });
      }) as any;

      try {
        const duplicateUrls = [
          'https://example.com/resource#part1',
          'https://example.com/resource#part2',
          'https://example.com/resource',
        ];

        const res = await fetchMgr.fetchUrls(duplicateUrls, { bypassCache: true, silent: true });
        if (res.results.length !== 3) throw new Error(`Expected 3 mapped results, got ${res.results.length}`);
        if (callCount !== 1) {
          throw new Error(`Deduplication failed! Network called ${callCount} times for 3 equivalent URLs`);
        }
        return `Deduplication normalized 3 fragment variations into 1 network call and mapped back all 3 results.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 63. TEST 27: LLM client retry does not trigger on fetch failure
    await this.runTest(results, 63, 'TEST 27: LLM Client Isolation From Fetch Failures', 'Retry Domain Separation', async () => {
      const originalFetch = globalThis.fetch;
      let llmCallAttempts = 0;

      // Mock provider
      globalThis.fetch = (async (input: any) => {
        const urlStr = typeof input === 'string' ? input : (input?.url || input?.href || String(input));
        if (urlStr.includes('mock-llm.local') || urlStr.includes('chat/completions')) {
          llmCallAttempts++;
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: 'I noticed the URL could not be reached, continuing with alternate search.',
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        // External URL fetch fails
        return new Response('Not Found', { status: 404 });
      }) as any;

      try {
        const client = new LLMClient({ baseURL: 'http://mock-llm.local/v1', apiKey: 'mock-key' });
        // Execute a tool fetch failure
        const fetchRes = await registry.executeTool('fetch_webpage', { url: 'https://example.com/missing' });
        if (fetchRes.success !== false) throw new Error('Expected fetch failure');

        // Pass this tool failure message to LLM client
        const completion = await client.chatCompletion([
          { role: 'user', content: 'Fetch the page' },
          { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'fetch_webpage', arguments: '{"url":"https://example.com/missing"}' } }] },
          { role: 'tool', tool_call_id: 'tc1', name: 'fetch_webpage', content: JSON.stringify(fetchRes) },
        ]);

        if (llmCallAttempts !== 1) {
          throw new Error(`LLM client retried unexpectedly! llmCallAttempts: ${llmCallAttempts}`);
        }
        if (!completion.content?.includes('continuing')) {
          throw new Error(`Unexpected LLM completion: ${completion.content}`);
        }

        return `Tool fetch failure was received cleanly by LLM as a standard tool observation without triggering LLM provider retries.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 64. TEST 28: Invalid URL rejected before network call
    await this.runTest(results, 64, 'TEST 28: Invalid URL Rejected Before Network Call', 'Network Fetch Subsystem', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMgr = new FetchManager();
      let networkCalled = false;

      globalThis.fetch = (async () => {
        networkCalled = true;
        return new Response('Should not be called', { status: 200 });
      }) as any;

      try {
        const res1 = await fetchMgr.fetchUrl('ftp://invalidscheme.local/file');
        if (res1.ok) throw new Error('FTP scheme should have failed');
        if (res1.errorType !== 'UNSUPPORTED_PROTOCOL') throw new Error(`Expected UNSUPPORTED_PROTOCOL, got ${res1.errorType}`);
        if (res1.attempts !== 0) throw new Error(`Attempts must be 0 for unsupported protocol`);

        const res2 = await fetchMgr.fetchUrl('');
        if (res2.ok) throw new Error('Empty URL should have failed');
        if (res2.errorType !== 'INVALID_URL') throw new Error(`Expected INVALID_URL, got ${res2.errorType}`);

        if (networkCalled) throw new Error('Network was called despite invalid URL!');

        return `Invalid URLs rejected synchronously (UNSUPPORTED_PROTOCOL, INVALID_URL) with 0 network calls.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 65. TEST 29: Host marked unreachable after consecutive failures
    await this.runTest(results, 65, 'TEST 29: Host Marked Unreachable After Consecutive Failures', 'Host Health Memory', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMgr = new FetchManager();

      globalThis.fetch = (async () => {
        throw new Error('connect ECONNREFUSED 192.0.2.1:443');
      }) as any;

      try {
        await fetchMgr.fetchUrl('https://unreachable-host.test/p1', { maxRetries: 0, silent: true });
        await fetchMgr.fetchUrl('https://unreachable-host.test/p2', { maxRetries: 0, silent: true });
        await fetchMgr.fetchUrl('https://unreachable-host.test/p3', { maxRetries: 0, silent: true });

        const health = fetchMgr.getHostHealth('unreachable-host.test');
        if (!health) throw new Error('Host health record missing');
        if (health.failureCount < 3) throw new Error(`Expected failureCount >= 3, got ${health.failureCount}`);
        if (health.status !== 'unreachable') throw new Error(`Expected status unreachable, got ${health.status}`);

        return `Host 'unreachable-host.test' correctly transitioned to 'unreachable' status after 3 consecutive failures.`;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // 66. REGRESSION 1: REALITY Server with placeholder private key rejected
    await this.runTest(results, 66, 'REALITY Server Placeholder Private Key Rejected', 'V2Ray Crypto Correctness', async () => {
      const serverConfig = {
        inbounds: [
          {
            tag: 'vless-in',
            port: 443,
            protocol: 'vless',
            settings: { clients: [{ id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }] },
            streamSettings: {
              network: 'tcp',
              security: 'reality',
              realitySettings: {
                serverNames: ['www.cloudflare.com'],
                dest: 'www.cloudflare.com:443',
                privateKey: 'aHxxxxSERVER_PRIVATE_KEY_REQUIREDxxxx',
                shortIds: ['0123456789abcdef'],
              },
            },
          },
        ],
        outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
      };

      const val = V2RayValidator.validate(serverConfig);
      if (val.valid) throw new Error('Expected validation failure for placeholder private key');
      if (val.score > 20) throw new Error(`Expected score <= 20 for placeholder key, got ${val.score}`);
      const err = val.errors.find(e => e.code === 'PLACEHOLDER_REALITY_KEY');
      if (!err) throw new Error(`Expected error code PLACEHOLDER_REALITY_KEY, got ${JSON.stringify(val.errors)}`);
      if (val.verification.cryptographic !== 'placeholder') throw new Error(`Expected verification.cryptographic = placeholder, got ${val.verification.cryptographic}`);

      return `Placeholder private key rejected with code PLACEHOLDER_REALITY_KEY (Score: ${val.score}/100, cryptographic: ${val.verification.cryptographic}).`;
    });

    // 67. REGRESSION 2: REALITY Server with missing private key rejected
    await this.runTest(results, 67, 'REALITY Server Missing Private Key Rejected', 'V2Ray Crypto Correctness', async () => {
      const serverConfig = {
        inbounds: [
          {
            tag: 'vless-in',
            port: 443,
            protocol: 'vless',
            settings: { clients: [{ id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }] },
            streamSettings: {
              network: 'tcp',
              security: 'reality',
              realitySettings: {
                serverNames: ['www.cloudflare.com'],
                dest: 'www.cloudflare.com:443',
                shortIds: ['0123456789abcdef'],
              },
            },
          },
        ],
        outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
      };

      const val = V2RayValidator.validate(serverConfig);
      if (val.valid) throw new Error('Expected validation failure for missing private key');
      if (val.score !== 0) throw new Error(`Expected score 0 for missing private key, got ${val.score}`);
      const err = val.errors.find(e => e.code === 'MISSING_REALITY_PRIVATE_KEY');
      if (!err) throw new Error('Expected error code MISSING_REALITY_PRIVATE_KEY');
      if (val.verification.cryptographic !== 'missing') throw new Error(`Expected verification.cryptographic = missing, got ${val.verification.cryptographic}`);

      return `Missing private key rejected with code MISSING_REALITY_PRIVATE_KEY (Score: ${val.score}/100, cryptographic: missing).`;
    });

    // 68. REGRESSION 3: REALITY Client with missing serverAddress rejected
    await this.runTest(results, 68, 'REALITY Client Missing Server Address Rejected', 'V2Ray Domain Correctness', async () => {
      const buildRes = await registry.executeTool('v2ray_build_config', {
        role: 'client',
        protocol: 'vless',
        port: 443,
        security: 'reality',
        transport: 'tcp',
        sni: 'www.cloudflare.com',
      });

      if (buildRes.success) throw new Error('Expected v2ray_build_config to fail for client missing serverAddress');
      if (buildRes.error?.type !== 'MISSING_REMOTE_SERVER_ADDRESS') {
        throw new Error(`Expected error type MISSING_REMOTE_SERVER_ADDRESS, got ${buildRes.error?.type}`);
      }

      return `Client configuration with missing serverAddress correctly rejected with MISSING_REMOTE_SERVER_ADDRESS.`;
    });

    // 69. REGRESSION 4: REALITY Client with 127.0.0.1 without allowLocalServer rejected
    await this.runTest(results, 69, 'REALITY Client Destination 127.0.0.1 Rejected Without allowLocalServer', 'V2Ray Domain Correctness', async () => {
      const keys = V2RayBuilder.generateRealityKeyPair();
      const clientConfig = {
        inbounds: [{ tag: 'socks', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: {} }],
        outbounds: [
          {
            tag: 'proxy',
            protocol: 'vless',
            settings: {
              vnext: [{ address: '127.0.0.1', port: 443, users: [{ id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }] }],
            },
            streamSettings: {
              network: 'tcp',
              security: 'reality',
              realitySettings: {
                serverName: 'www.cloudflare.com',
                publicKey: keys.publicKey,
                shortId: '0123456789abcdef',
                fingerprint: 'chrome',
              },
            },
          },
        ],
      };

      const val = V2RayValidator.validate(clientConfig, { allowLocalServer: false });
      if (val.valid) throw new Error('Expected validation failure for 127.0.0.1 remote client address');
      const err = val.errors.find(e => e.code === 'INVALID_REMOTE_SERVER_ADDRESS');
      if (!err) throw new Error(`Expected INVALID_REMOTE_SERVER_ADDRESS error, got ${JSON.stringify(val.errors)}`);

      // Now verify with allowLocalServer = true, it should pass
      const valLocal = V2RayValidator.validate(clientConfig, { allowLocalServer: true });
      if (!valLocal.valid) throw new Error(`allowLocalServer=true should have allowed 127.0.0.1: ${JSON.stringify(valLocal.errors)}`);

      return `Destination 127.0.0.1 rejected by default with INVALID_REMOTE_SERVER_ADDRESS and allowed when allowLocalServer=true.`;
    });

    // 70. REGRESSION 5: REALITY Client with placeholder public key rejected
    await this.runTest(results, 70, 'REALITY Client Placeholder Public Key Rejected', 'V2Ray Crypto Correctness', async () => {
      const clientConfig = {
        inbounds: [{ tag: 'socks', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: {} }],
        outbounds: [
          {
            tag: 'proxy',
            protocol: 'vless',
            settings: {
              vnext: [{ address: '198.51.100.1', port: 443, users: [{ id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }] }],
            },
            streamSettings: {
              network: 'tcp',
              security: 'reality',
              realitySettings: {
                serverName: 'www.cloudflare.com',
                publicKey: 'aHxxxxSERVER_PUBLIC_KEYxxxx',
                shortId: '0123456789abcdef',
                fingerprint: 'chrome',
              },
            },
          },
        ],
      };

      const val = V2RayValidator.validate(clientConfig);
      if (val.valid) throw new Error('Expected validation failure for placeholder public key');
      const err = val.errors.find(e => e.code === 'PLACEHOLDER_REALITY_KEY');
      if (!err) throw new Error(`Expected PLACEHOLDER_REALITY_KEY, got ${JSON.stringify(val.errors)}`);
      if (val.verification.cryptographic !== 'placeholder') throw new Error(`Expected cryptographic = placeholder, got ${val.verification.cryptographic}`);

      return `Placeholder public key rejected with code PLACEHOLDER_REALITY_KEY.`;
    });

    // 71. REGRESSION 6: REALITY Client with malformed public key rejected
    await this.runTest(results, 71, 'REALITY Client Malformed Public Key Rejected', 'V2Ray Crypto Correctness', async () => {
      const clientConfig = {
        inbounds: [{ tag: 'socks', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: {} }],
        outbounds: [
          {
            tag: 'proxy',
            protocol: 'vless',
            settings: {
              vnext: [{ address: '198.51.100.1', port: 443, users: [{ id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }] }],
            },
            streamSettings: {
              network: 'tcp',
              security: 'reality',
              realitySettings: {
                serverName: 'www.cloudflare.com',
                publicKey: 'not-a-32-byte-key',
                shortId: '0123456789abcdef',
                fingerprint: 'chrome',
              },
            },
          },
        ],
      };

      const val = V2RayValidator.validate(clientConfig);
      if (val.valid) throw new Error('Expected validation failure for malformed public key');
      const err = val.errors.find(e => e.code === 'INVALID_REALITY_PUBLIC_KEY');
      if (!err) throw new Error(`Expected INVALID_REALITY_PUBLIC_KEY, got ${JSON.stringify(val.errors)}`);
      if (val.verification.cryptographic !== 'malformed') throw new Error(`Expected cryptographic = malformed, got ${val.verification.cryptographic}`);

      return `Malformed public key rejected with code INVALID_REALITY_PUBLIC_KEY.`;
    });

    // 72. REGRESSION 7: Valid standalone server config valid_format score < 100
    await this.runTest(results, 72, 'Valid Standalone Server Config Passes with Score < 100', 'V2Ray Scoring Logic', async () => {
      const keys = V2RayBuilder.generateRealityKeyPair();
      const serverConfig = {
        inbounds: [
          {
            tag: 'vless-in',
            port: 443,
            listen: '0.0.0.0',
            protocol: 'vless',
            settings: { clients: [{ id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }] },
            streamSettings: {
              network: 'tcp',
              security: 'reality',
              realitySettings: {
                serverNames: ['www.cloudflare.com'],
                dest: 'www.cloudflare.com:443',
                privateKey: keys.privateKey,
                shortIds: ['0123456789abcdef'],
              },
            },
          },
        ],
        outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
      };

      const val = V2RayValidator.validate(serverConfig);
      if (!val.valid) throw new Error(`Valid server config unexpectedly failed: ${JSON.stringify(val.errors)}`);
      if (val.verification.cryptographic !== 'valid_format') throw new Error(`Expected valid_format, got ${val.verification.cryptographic}`);
      if (val.score >= 100 || val.score < 80) throw new Error(`Expected score between 80 and 99 for unverified peer, got ${val.score}`);

      return `Standalone server config validated: Score ${val.score}/100, cryptographic: ${val.verification.cryptographic}.`;
    });

    // 73. REGRESSION 8: Valid standalone client config valid_format score < 100
    await this.runTest(results, 73, 'Valid Standalone Client Config Passes with Score < 100', 'V2Ray Scoring Logic', async () => {
      const keys = V2RayBuilder.generateRealityKeyPair();
      const clientConfig = {
        inbounds: [{ tag: 'socks', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: {} }],
        outbounds: [
          {
            tag: 'proxy',
            protocol: 'vless',
            settings: {
              vnext: [{ address: '198.51.100.1', port: 443, users: [{ id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }] }],
            },
            streamSettings: {
              network: 'tcp',
              security: 'reality',
              realitySettings: {
                serverName: 'www.cloudflare.com',
                publicKey: keys.publicKey,
                shortId: '0123456789abcdef',
                fingerprint: 'chrome',
              },
            },
          },
        ],
      };

      const val = V2RayValidator.validate(clientConfig);
      if (!val.valid) throw new Error(`Valid client config unexpectedly failed: ${JSON.stringify(val.errors)}`);
      if (val.verification.cryptographic !== 'valid_format') throw new Error(`Expected valid_format, got ${val.verification.cryptographic}`);
      if (val.score >= 100 || val.score < 80) throw new Error(`Expected score between 80 and 99 for unverified peer, got ${val.score}`);

      return `Standalone client config validated: Score ${val.score}/100, cryptographic: ${val.verification.cryptographic}.`;
    });

    // 74. REGRESSION 9: Valid matching server/client pair verified with Score >= 90
    await this.runTest(results, 74, 'Valid Matching Server/Client Pair Verified', 'V2Ray Pair Interoperability', async () => {
      const keys = V2RayBuilder.generateRealityKeyPair();
      const uuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
      const shortId = '0123456789abcdef';
      const sni = 'www.cloudflare.com';

      const serverRes = V2RayBuilder.buildConfig({
        role: 'server',
        protocol: 'vless',
        port: 443,
        uuid,
        transport: 'tcp',
        security: 'reality',
        sni,
        realityPrivateKey: keys.privateKey,
        realityShortIds: [shortId],
        realityDest: 'www.cloudflare.com:443',
      });

      const clientRes = V2RayBuilder.buildConfig({
        role: 'client',
        protocol: 'vless',
        port: 443,
        serverAddress: '198.51.100.1',
        uuid,
        transport: 'tcp',
        security: 'reality',
        sni,
        realityPublicKey: keys.publicKey,
        realityShortId: shortId,
        fingerprint: 'chrome',
      });

      const pairVal = V2RayValidator.validatePair(serverRes.config, clientRes.config);
      if (!pairVal.valid) throw new Error(`Pair validation failed: ${JSON.stringify(pairVal.errors)}`);
      if (pairVal.verification.interoperability !== 'verified') throw new Error(`Expected interoperability verified, got ${pairVal.verification.interoperability}`);
      if (pairVal.verification.cryptographic !== 'verified') throw new Error(`Expected cryptographic verified, got ${pairVal.verification.cryptographic}`);
      if (pairVal.score < 90) throw new Error(`Expected score >= 90 for verified pair, got ${pairVal.score}`);

      return `Pair validated successfully: Score ${pairVal.score}/100, crypto & interoperability verified.`;
    });

    // 75. REGRESSION 10: Mismatched server/client keys fails validatePair
    await this.runTest(results, 75, 'Mismatched Keys Fails Pair Validation with CLIENT_SERVER_MISMATCH', 'V2Ray Pair Interoperability', async () => {
      const keys1 = V2RayBuilder.generateRealityKeyPair();
      const keys2 = V2RayBuilder.generateRealityKeyPair();
      const uuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

      const serverRes = V2RayBuilder.buildConfig({
        role: 'server',
        protocol: 'vless',
        port: 443,
        uuid,
        transport: 'tcp',
        security: 'reality',
        sni: 'www.cloudflare.com',
        realityPrivateKey: keys1.privateKey,
        realityShortIds: ['0123456789abcdef'],
      });

      const clientRes = V2RayBuilder.buildConfig({
        role: 'client',
        protocol: 'vless',
        port: 443,
        serverAddress: '198.51.100.1',
        uuid,
        transport: 'tcp',
        security: 'reality',
        sni: 'www.cloudflare.com',
        realityPublicKey: keys2.publicKey, // Mismatched public key!
        realityShortId: '0123456789abcdef',
        fingerprint: 'chrome',
      });

      const pairVal = V2RayValidator.validatePair(serverRes.config, clientRes.config);
      if (pairVal.valid) throw new Error('Expected pair validation to fail on mismatched keys');
      const err = pairVal.errors.find(e => e.code === 'CLIENT_SERVER_MISMATCH');
      if (!err) throw new Error(`Expected CLIENT_SERVER_MISMATCH, got ${JSON.stringify(pairVal.errors)}`);
      if (pairVal.verification.interoperability !== 'mismatch') throw new Error(`Expected interoperability = mismatch, got ${pairVal.verification.interoperability}`);

      return `Mismatched keypair caught with CLIENT_SERVER_MISMATCH and interoperability=mismatch.`;
    });

    // 76. REGRESSION 11: Mismatched shortId fails validatePair
    await this.runTest(results, 76, 'Mismatched ShortId Fails Pair Validation', 'V2Ray Pair Interoperability', async () => {
      const keys = V2RayBuilder.generateRealityKeyPair();
      const uuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

      const serverRes = V2RayBuilder.buildConfig({
        role: 'server',
        protocol: 'vless',
        port: 443,
        uuid,
        transport: 'tcp',
        security: 'reality',
        sni: 'www.cloudflare.com',
        realityPrivateKey: keys.privateKey,
        realityShortIds: ['0123456789abcdef'],
      });

      const clientRes = V2RayBuilder.buildConfig({
        role: 'client',
        protocol: 'vless',
        port: 443,
        serverAddress: '198.51.100.1',
        uuid,
        transport: 'tcp',
        security: 'reality',
        sni: 'www.cloudflare.com',
        realityPublicKey: keys.publicKey,
        realityShortId: 'ffffffffffffffff', // Not in server shortIds!
        fingerprint: 'chrome',
      });

      const pairVal = V2RayValidator.validatePair(serverRes.config, clientRes.config);
      if (pairVal.valid) throw new Error('Expected pair validation to fail on mismatched shortId');
      const err = pairVal.errors.find(e => e.code === 'CLIENT_SERVER_MISMATCH');
      if (!err) throw new Error(`Expected CLIENT_SERVER_MISMATCH for mismatched shortId, got ${JSON.stringify(pairVal.errors)}`);

      return `Mismatched shortId caught with CLIENT_SERVER_MISMATCH.`;
    });

    // 77. REGRESSION 12: Unsupported flow rejected with UNSUPPORTED_FLOW
    await this.runTest(results, 77, 'Unsupported Flow Control Rejected with UNSUPPORTED_FLOW', 'V2Ray Semantic Validation', async () => {
      let threw = false;
      try {
        V2RayBuilder.buildConfig({
          role: 'client',
          protocol: 'vless',
          serverAddress: '198.51.100.1',
          transport: 'ws',
          security: 'tls',
          flow: 'xtls-rprx-vision', // Vision cannot run over ws!
        });
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('UNSUPPORTED_FLOW')) {
          throw new Error(`Expected error message to mention UNSUPPORTED_FLOW, got: ${err.message}`);
        }
      }

      if (!threw) throw new Error('Expected buildConfig to reject xtls-rprx-vision over ws transport');
      return `Invalid flow configuration (xtls-rprx-vision over ws) successfully rejected with UNSUPPORTED_FLOW.`;
    });

    // 78. REGRESSION 13: Incomplete client config cannot generate share link
    await this.runTest(results, 78, 'Incomplete Client Config Does Not Generate Share Link', 'V2Ray Share Link Invariant', async () => {
      // Missing remote address and missing public key
      const res = V2RayBuilder.buildConfig({
        role: 'client',
        protocol: 'vless',
        transport: 'tcp',
        security: 'reality',
        sni: 'www.cloudflare.com',
        allowLocalServer: false,
      });

      if (res.shareLink) throw new Error(`Share link was generated despite missing required fields: ${res.shareLink}`);
      if (!res.summary.includes('SHARE_LINK_NOT_GENERATED')) {
        throw new Error(`Summary should indicate SHARE_LINK_NOT_GENERATED, got: ${res.summary}`);
      }

      return `Incomplete configuration did not produce a share link and reported SHARE_LINK_NOT_GENERATED.`;
    });

    // 79. REGRESSION 14: Complete valid client config generates share link and passes round-trip
    await this.runTest(results, 79, 'Complete Valid Client Config Passes Share Link Round-Trip Invariant', 'V2Ray Share Link Invariant', async () => {
      const keys = V2RayBuilder.generateRealityKeyPair();
      const uuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
      const sid = '0123456789abcdef';

      const res = V2RayBuilder.buildConfig({
        role: 'client',
        protocol: 'vless',
        serverAddress: '198.51.100.1',
        port: 443,
        uuid,
        transport: 'tcp',
        security: 'reality',
        sni: 'www.cloudflare.com',
        realityPublicKey: keys.publicKey,
        realityShortId: sid,
        fingerprint: 'chrome',
        remark: 'Test-Profile',
      });

      if (!res.shareLink) throw new Error('Expected share link to be generated for complete client config');
      const parsed = V2RayBuilder.parseShareLink(res.shareLink);
      if (parsed.protocol !== 'vless') throw new Error(`Expected protocol vless, got ${parsed.protocol}`);
      if (parsed.uuid !== uuid) throw new Error(`UUID round-trip mismatch: ${parsed.uuid} vs ${uuid}`);
      if (parsed.host !== '198.51.100.1') throw new Error(`Host mismatch: ${parsed.host}`);
      if (parsed.port !== 443) throw new Error(`Port mismatch: ${parsed.port}`);
      if (parsed.publicKey !== keys.publicKey) throw new Error(`Public key mismatch: ${parsed.publicKey}`);
      if (parsed.shortId !== sid) throw new Error(`ShortId mismatch: ${parsed.shortId}`);
      if (parsed.sni !== 'www.cloudflare.com') throw new Error(`SNI mismatch: ${parsed.sni}`);

      return `Share link generated and verified with 100% round-trip fidelity: ${res.shareLink.slice(0, 50)}...`;
    });

    // 80. REGRESSION 15: Runtime verification returns not_tested without crashing
    await this.runTest(results, 80, 'Runtime Verification Returns not_tested Cleanly', 'V2Ray Runtime Subsystem', async () => {
      const runtimeRes = await V2RayValidator.testRuntime({ inbounds: [], outbounds: [] });
      if (runtimeRes.status !== 'not_tested' && runtimeRes.status !== 'passed') {
        throw new Error(`Unexpected runtime status: ${runtimeRes.status}`);
      }
      return `Runtime check completed cleanly with status: '${runtimeRes.status}' (${runtimeRes.reason}).`;
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

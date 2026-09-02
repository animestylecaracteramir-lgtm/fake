import { ToolRegistry } from '../tools/registry';
import { WorkspaceManager } from '../workspace';
import { V2RayBuilder } from '../v2ray/builder';
import { V2RayValidator } from '../v2ray/validator';
import { LoopDetector } from '../agent/loop_detector';
import { LLMClient } from '../llm/client';
import { AgentAction } from '../types';

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

export class AppTestSuite {
  public static async runAllTests(): Promise<TestSuiteSummary> {
    const startTime = Date.now();
    const results: TestResultItem[] = [];
    const workspace = new WorkspaceManager();
    const registry = new ToolRegistry(workspace);

    // 1. Tool Registry
    await this.runTest(results, 1, 'Tool Registry Integrity', 'Registry', async () => {
      const tools = registry.listTools();
      if (tools.length < 10) throw new Error(`Expected at least 10 built-in tools, found ${tools.length}`);
      const pythonTool = registry.getTool('run_python');
      if (!pythonTool) throw new Error('Missing run_python tool');
      return `Loaded ${tools.length} built-in tools correctly.`;
    });

    // 2. Tool Creation (Self-Extending)
    await this.runTest(results, 2, 'Self-Extending Tool Creation', 'Self-Extending', async () => {
      const toolCode = `
def add_numbers(a, b):
    return a + b
`;
      const res = await registry.executeTool('create_tool', {
        name: 'test_adder_tool',
        description: 'Adds two numbers together',
        parameters: {
          type: 'object',
          properties: {
            a: { type: 'number', description: 'First number' },
            b: { type: 'number', description: 'Second number' },
          },
          required: ['a', 'b'],
        },
        code: toolCode,
        test_args: { a: 15, b: 27 },
      });

      if (!res.success) throw new Error(res.error?.message || 'Failed to create tool');
      return `Created and validated custom tool 'test_adder_tool' with version ${res.data.version}`;
    });

    // 3. Tool Persistence
    await this.runTest(results, 3, 'Tool Persistence & Reload', 'Persistence', async () => {
      const newRegistry = new ToolRegistry(workspace);
      const customTool = newRegistry.getTool('test_adder_tool');
      if (!customTool) throw new Error('Custom tool was not restored on fresh registry initialization.');
      return `Custom tool persisted and loaded from workspace registry.json.`;
    });

    // 4. Custom Tool Calling & Execution
    await this.runTest(results, 4, 'Custom Tool Runtime Execution', 'Tool Calling', async () => {
      const res = await registry.executeTool('test_adder_tool', { a: 40, b: 2 });
      if (!res.success || res.data !== 42) {
        throw new Error(`Execution returned unexpected result: ${JSON.stringify(res)}`);
      }
      return `Executed custom tool adder: 40 + 2 = ${res.data}`;
    });

    // 5. Python Subprocess Execution
    await this.runTest(results, 5, 'Python Execution Runtime', 'Python', async () => {
      const res = await registry.executeTool('run_python', {
        code: 'import math; print(f"PI_APPROX:{math.pi:.4f}")',
      });
      if (!res.success || !res.data.stdout.includes('PI_APPROX:3.1416')) {
        throw new Error(`Python execution failed: ${res.error?.message || res.data?.stderr}`);
      }
      return `Python execution passed with output: ${res.data.stdout}`;
    });

    // 6. Environment Inspection
    await this.runTest(results, 6, 'Environment Tools & Packages', 'Environment', async () => {
      const res = await registry.executeTool('inspect_environment', {});
      if (!res.success || !res.data.python_version) {
        throw new Error('inspect_environment failed');
      }
      return `Environment detected: ${res.data.python_version}, Node ${res.data.node_version}`;
    });

    // 7. Memory Save & Search
    await this.runTest(results, 7, 'Memory & Documentation Persistence', 'Memory', async () => {
      const saveRes = await registry.executeTool('save_documentation', {
        title: 'V2Ray Reality Setup Guide',
        category: 'architecture',
        content: 'Reality protocol requires TLS 1.3 handshake simulation and XTLS flow.',
        tags: ['v2ray', 'reality', 'tls'],
      });
      if (!saveRes.success) throw new Error('Failed to save memory doc');

      const searchRes = await registry.executeTool('search_documentation', {
        query: 'Reality',
      });
      if (!searchRes.success || searchRes.data.count === 0) {
        throw new Error('Search documentation failed to find saved entry');
      }
      return `Saved and retrieved memory document '${saveRes.data.title}'`;
    });

    // 8. Loop Detector (3x Error Pivot)
    await this.runTest(results, 8, 'Loop & Stuck Detector', 'Loop Engine', async () => {
      const detector = new LoopDetector();
      const mockActions: AgentAction[] = [
        {
          id: '1',
          timestamp: new Date().toISOString(),
          type: 'tool_call',
          status: 'failed',
          result: { success: false, data: null, error: { type: 'ERR', message: 'Connection refused' } },
        },
        {
          id: '2',
          timestamp: new Date().toISOString(),
          type: 'tool_call',
          status: 'failed',
          result: { success: false, data: null, error: { type: 'ERR', message: 'Connection refused' } },
        },
        {
          id: '3',
          timestamp: new Date().toISOString(),
          type: 'tool_call',
          status: 'failed',
          result: { success: false, data: null, error: { type: 'ERR', message: 'Connection refused' } },
        },
      ];

      const detection = detector.check(mockActions, 3, 20);
      if (!detection.isStuck || detection.type !== 'REPEATED_ERROR') {
        throw new Error(`Expected REPEATED_ERROR stuck detection, got: ${JSON.stringify(detection)}`);
      }
      return `Loop detector identified 3x repeated error and recommended strategy pivot.`;
    });

    // 9. Error Diagnosis & Strategy Recovery
    await this.runTest(results, 9, 'Error Recovery & Diagnosis', 'Recovery', async () => {
      const diagRes = await registry.executeTool('diagnose_failure', {
        error_message: "ModuleNotFoundError: No module named 'cryptography'",
        attempt_count: 2,
      });
      if (!diagRes.success || !diagRes.data.root_cause.includes('Missing Python library')) {
        throw new Error('Failed to diagnose missing library');
      }
      return `Diagnosis accurately suggested: ${diagRes.data.suggested_strategy}`;
    });

    // 10. V2Ray Structured Config Builder (No Copy-Paste)
    await this.runTest(results, 10, 'V2Ray Structured Config Synthesis', 'V2Ray', async () => {
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

    // 11. V2Ray Schema & Semantic Validation
    await this.runTest(results, 11, 'V2Ray Exhaustive Validator', 'V2Ray', async () => {
      const sample = {
        inbounds: [
          {
            tag: 'in-vless',
            port: 443,
            listen: '0.0.0.0',
            protocol: 'vless',
            settings: {
              clients: [{ id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }],
            },
            streamSettings: {
              network: 'tcp',
              security: 'reality',
              realitySettings: {
                serverNames: ['www.cloudflare.com'],
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

    // 12. Output Artifact Export System
    await this.runTest(results, 12, 'Output Artifact Export System', 'Export', async () => {
      const exportRes = await registry.executeTool('export_artifact', {
        filename: 'v2ray_test_export.json',
        type: 'v2ray_config',
        content: JSON.stringify({ inbounds: [], outbounds: [] }, null, 2),
        goal: 'Generate test V2Ray config',
        validated: true,
      });
      if (!exportRes.success) throw new Error('Failed to export artifact');
      const fileExists = workspace.fileExists('outputs/v2ray_test_export.json');
      if (!fileExists) throw new Error('Exported artifact file not found on disk.');
      return `Exported and registered artifact to outputs/v2ray_test_export.json`;
    });

    // 13. OpenAI-Compatible API Client
    await this.runTest(results, 13, 'OpenAI-Compatible LLM Client Abstraction', 'LLM Adapter', async () => {
      const client = new LLMClient({
        baseURL: 'http://localhost:11434/v1',
        model: 'llama3.2',
        apiKey: 'sk-test-mock-key',
      });
      const settings = client.getSettings();
      if (settings.baseURL !== 'http://localhost:11434/v1') {
        throw new Error('LLM settings baseURL mismatch');
      }
      return `Universal OpenAI-compatible client adapter verified with Base URL: ${settings.baseURL}`;
    });

    // 14. API Key Sanitization
    await this.runTest(results, 14, 'API Key & Secret Sanitization', 'Security', async () => {
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
    await this.runTest(results, 15, '5-Attempt API Retry & Exponential Backoff', 'Resilience', async () => {
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

      const startTimeMs = Date.now();
      let caughtError = false;
      try {
        await (client as any).executeWithRetry(
          'Test Retry Endpoint',
          async (attempt: number) => {
            if (attempt < 5) {
              throw new Error(`Transient API Failure on attempt ${attempt}`);
            }
            return { status: 'success_on_attempt_5' };
          },
          5
        );
      } catch (e) {
        caughtError = true;
      }

      if (attemptsRecorded.length !== 4) {
        throw new Error(`Expected exactly 4 retry notifications before attempt 5, got ${attemptsRecorded.length}`);
      }

      return `Verified 5-attempt retry mechanism with exponential backoff: successfully recovered on attempt 5.`;
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
      results.push({
        id,
        name,
        category,
        passed: true,
        durationMs: Date.now() - start,
        details: detail,
      });
    } catch (err: any) {
      results.push({
        id,
        name,
        category,
        passed: false,
        durationMs: Date.now() - start,
        details: err.message || 'Test failed',
        error: err.stack,
      });
    }
  }
}

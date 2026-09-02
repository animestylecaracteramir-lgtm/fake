import fs from 'fs';
import path from 'path';
import {
  ToolMetadata,
  CapabilityGap,
  PermissionScope,
  EvaluationReport,
  ToolQualityMetrics,
} from '../types';
import { WorkspaceManager, defaultWorkspace } from '../workspace';
import { ToolSandbox, defaultToolSandbox } from './sandbox';
import { EvaluatorCore, defaultEvaluator } from '../evaluator/evaluator_core';

export interface ToolTestCase {
  name: string;
  args: Record<string, any>;
  expectedOutput: any;
}

export interface GeneratedToolCandidate {
  name: string;
  description: string;
  parameters: any;
  code: string;
  runtime: 'python' | 'javascript';
  permissions: PermissionScope[];
  testCases: ToolTestCase[];
  version: string;
  isCustom: boolean;
}

export class ToolBuilder {
  private workspace: WorkspaceManager;
  private sandbox: ToolSandbox;
  private evaluator: EvaluatorCore;

  constructor(
    workspace?: WorkspaceManager,
    sandbox?: ToolSandbox,
    evaluator?: EvaluatorCore
  ) {
    this.workspace = workspace || defaultWorkspace;
    this.sandbox = sandbox || defaultToolSandbox;
    this.evaluator = evaluator || defaultEvaluator;
  }

  public detectCapabilityGap(
    goal: string,
    existingTools: ToolMetadata[]
  ): CapabilityGap | null {
    const goalLower = goal.toLowerCase();
    const toolNames = new Set(existingTools.map(t => t.name.toLowerCase()));

    // Check common capability requirements
    if (goalLower.includes('celsius') || goalLower.includes('fahrenheit') || goalLower.includes('temperature conversion')) {
      if (!toolNames.has('convert_temperature') && !toolNames.has('temperature_converter')) {
        return {
          requiredCapability: 'temperature_conversion',
          currentCapabilities: Array.from(toolNames),
          missingAspect: 'No tool available to convert temperatures between Celsius, Fahrenheit, and Kelvin',
          taskType: 'math_conversion',
          suggestedToolName: 'convert_temperature',
          expectedBenefit: 'Accurate, repeatable temperature calculations without LLM floating point hallucinations',
          permissionsRequired: [],
        };
      }
    }

    if (goalLower.includes('sha256') || goalLower.includes('hash string') || goalLower.includes('compute hash')) {
      if (!toolNames.has('hash_text') && !toolNames.has('compute_hash')) {
        return {
          requiredCapability: 'cryptographic_hashing',
          currentCapabilities: Array.from(toolNames),
          missingAspect: 'Missing deterministic cryptographic hash computation tool',
          taskType: 'security_crypto',
          suggestedToolName: 'compute_hash',
          expectedBenefit: 'Generates bit-exact SHA-256 and MD5 hashes',
          permissionsRequired: [],
        };
      }
    }

    if (goalLower.includes('cidr') || goalLower.includes('subnet') || goalLower.includes('ip range calculator')) {
      if (!toolNames.has('calc_ip_subnet')) {
        return {
          requiredCapability: 'ip_subnet_math',
          currentCapabilities: Array.from(toolNames),
          missingAspect: 'No tool exists to compute CIDR boundaries and IP block ranges',
          taskType: 'network_math',
          suggestedToolName: 'calc_ip_subnet',
          expectedBenefit: 'Calculates network addresses and host ranges for routing configurations',
          permissionsRequired: [],
        };
      }
    }

    return null;
  }

  public synthesizeCandidateTool(gap: CapabilityGap): GeneratedToolCandidate {
    if (gap.suggestedToolName === 'convert_temperature') {
      const code = `import sys
import json

def run(args):
    val = float(args.get("value", 0))
    from_unit = args.get("from_unit", "celsius").lower()
    to_unit = args.get("to_unit", "fahrenheit").lower()
    
    # Convert to Celsius first
    if from_unit in ["c", "celsius"]:
        c = val
    elif from_unit in ["f", "fahrenheit"]:
        c = (val - 32) * 5 / 9
    elif from_unit in ["k", "kelvin"]:
        c = val - 273.15
    else:
        return {"error": f"Unsupported unit: {from_unit}"}
        
    # Convert from Celsius to target
    if to_unit in ["c", "celsius"]:
        res = c
    elif to_unit in ["f", "fahrenheit"]:
        res = (c * 9 / 5) + 32
    elif to_unit in ["k", "kelvin"]:
        res = c + 273.15
    else:
        return {"error": f"Unsupported unit: {to_unit}"}
        
    return {"result": round(res, 2), "from_unit": from_unit, "to_unit": to_unit, "original_value": val}

if __name__ == "__main__":
    raw = sys.argv[1] if len(sys.argv) > 1 else "{}"
    try:
        parsed = json.loads(raw)
        out = run(parsed)
        print(json.dumps(out))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
`;

      return {
        name: 'convert_temperature',
        description: 'Converts temperature values between Celsius, Fahrenheit, and Kelvin with verified accuracy.',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'number', description: 'Numeric temperature value to convert.' },
            from_unit: { type: 'string', enum: ['celsius', 'fahrenheit', 'kelvin'], description: 'Source unit.' },
            to_unit: { type: 'string', enum: ['celsius', 'fahrenheit', 'kelvin'], description: 'Target unit.' },
          },
          required: ['value', 'from_unit', 'to_unit'],
        },
        code,
        runtime: 'python',
        permissions: [],
        version: 'v1.0.0',
        isCustom: true,
        testCases: [
          {
            name: '0C to Fahrenheit',
            args: { value: 0, from_unit: 'celsius', to_unit: 'fahrenheit' },
            expectedOutput: { result: 32, from_unit: 'celsius', to_unit: 'fahrenheit', original_value: 0 },
          },
          {
            name: '100C to Fahrenheit',
            args: { value: 100, from_unit: 'celsius', to_unit: 'fahrenheit' },
            expectedOutput: { result: 212, from_unit: 'celsius', to_unit: 'fahrenheit', original_value: 100 },
          },
        ],
      };
    }

    if (gap.suggestedToolName === 'compute_hash') {
      const code = `import sys
import json
import hashlib

def run(args):
    text = str(args.get("text", ""))
    algo = args.get("algorithm", "sha256").lower()
    
    if algo == "sha256":
        digest = hashlib.sha256(text.encode('utf-8')).hexdigest()
    elif algo == "md5":
        digest = hashlib.md5(text.encode('utf-8')).hexdigest()
    elif algo == "sha1":
        digest = hashlib.sha1(text.encode('utf-8')).hexdigest()
    else:
        return {"error": f"Unsupported algorithm: {algo}"}
        
    return {"hash": digest, "algorithm": algo, "length": len(text)}

if __name__ == "__main__":
    raw = sys.argv[1] if len(sys.argv) > 1 else "{}"
    try:
        parsed = json.loads(raw)
        out = run(parsed)
        print(json.dumps(out))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
`;

      return {
        name: 'compute_hash',
        description: 'Computes deterministic cryptographic hashes (SHA-256, MD5, SHA-1) for given text input.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Input text to hash.' },
            algorithm: { type: 'string', enum: ['sha256', 'md5', 'sha1'], description: 'Hash algorithm.' },
          },
          required: ['text'],
        },
        code,
        runtime: 'python',
        permissions: [],
        version: 'v1.0.0',
        isCustom: true,
        testCases: [
          {
            name: 'SHA256 of "hello"',
            args: { text: 'hello', algorithm: 'sha256' },
            expectedOutput: {
              hash: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
              algorithm: 'sha256',
              length: 5,
            },
          },
        ],
      };
    }

    // Generic fallback candidate
    return {
      name: gap.suggestedToolName,
      description: `Custom generated tool for ${gap.requiredCapability}`,
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter.' },
        },
        required: ['input'],
      },
      code: `import sys, json\nprint(json.dumps({"result": "processed", "input": sys.argv[1] if len(sys.argv) > 1 else ""}))`,
      runtime: 'python',
      permissions: gap.permissionsRequired,
      version: 'v1.0.0',
      isCustom: true,
      testCases: [
        {
          name: 'Basic processing test',
          args: { input: 'test_val' },
          expectedOutput: 'processed',
        },
      ],
    };
  }

  public async testCandidateInSandbox(candidate: GeneratedToolCandidate): Promise<{
    passed: boolean;
    evaluationScore: number;
    testResults: Array<{ name: string; passed: boolean; output: any; error?: string }>;
    evaluationReport: EvaluationReport;
  }> {
    const testResults: Array<{ name: string; passed: boolean; output: any; error?: string }> = [];
    let allPassed = true;

    for (const testCase of candidate.testCases) {
      const sandboxRes = await this.sandbox.runPythonSandboxed(
        { code: candidate.code },
        [testCase.args],
        { timeoutMs: 5000, permissions: candidate.permissions }
      );

      if (sandboxRes.exitCode !== 0 || sandboxRes.timedOut) {
        allPassed = false;
        testResults.push({
          name: testCase.name,
          passed: false,
          output: sandboxRes.stdout,
          error: sandboxRes.stderr || 'Non-zero exit code or timeout',
        });
      } else {
        let parsedOutput: any = null;
        try {
          parsedOutput = JSON.parse(sandboxRes.stdout);
        } catch {
          parsedOutput = sandboxRes.stdout;
        }

        // Compare with expected output
        const isMatch = JSON.stringify(parsedOutput) === JSON.stringify(testCase.expectedOutput) ||
          (typeof testCase.expectedOutput === 'string' && String(parsedOutput).includes(testCase.expectedOutput));

        if (!isMatch) {
          allPassed = false;
        }

        testResults.push({
          name: testCase.name,
          passed: isMatch,
          output: parsedOutput,
          error: isMatch ? undefined : `Expected ${JSON.stringify(testCase.expectedOutput)} but got ${JSON.stringify(parsedOutput)}`,
        });
      }
    }

    const passedRatio = testResults.filter(t => t.passed).length / Math.max(1, testResults.length);
    const evalReport = this.evaluator.evaluateToolExecution(
      candidate.name,
      candidate.testCases[0]?.args || {},
      { success: allPassed, data: testResults[0]?.output },
      candidate.testCases[0]?.expectedOutput
    );

    return {
      passed: allPassed && evalReport.passed,
      evaluationScore: evalReport.overallScore,
      testResults,
      evaluationReport: evalReport,
    };
  }
}

export const defaultToolBuilder = new ToolBuilder();

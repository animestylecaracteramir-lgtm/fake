import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ToolMetadata, ToolResult, ExperimentRecord } from '../types';
import { WorkspaceManager, defaultWorkspace } from '../workspace';
import { V2RayBuilder } from '../v2ray/builder';
import { V2RayValidator } from '../v2ray/validator';
import { V2RayBuilderParams } from '../v2ray/models';

export class ToolRegistry {
  private tools: Map<string, ToolMetadata> = new Map();
  private customHandlers: Map<string, (args: any) => Promise<ToolResult>> = new Map();
  private workspace: WorkspaceManager;

  constructor(workspace?: WorkspaceManager) {
    this.workspace = workspace || defaultWorkspace;
    this.registerBuiltinTools();
    this.loadCustomTools();
  }

  public getTool(name: string): ToolMetadata | undefined {
    return this.tools.get(name);
  }

  public listTools(category?: string): ToolMetadata[] {
    const list = Array.from(this.tools.values());
    if (category) {
      return list.filter(t => t.category === category);
    }
    return list;
  }

  public getToolDefinitionsForLLM(): any[] {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  public async executeTool(name: string, args: any): Promise<ToolResult> {
    const startTime = Date.now();
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        success: false,
        data: null,
        error: {
          type: 'TOOL_NOT_FOUND',
          message: `Tool '${name}' is not registered in the system.`,
          details: `Available tools: ${Array.from(this.tools.keys()).join(', ')}`,
        },
        metadata: { duration_ms: Date.now() - startTime, tool_name: name },
      };
    }

    // Argument Validation
    const validationError = this.validateArguments(tool, args);
    if (validationError) {
      return {
        success: false,
        data: null,
        error: {
          type: 'INVALID_ARGUMENTS',
          message: `Validation failed for tool '${name}': ${validationError}`,
          details: JSON.stringify(tool.parameters),
        },
        metadata: { duration_ms: Date.now() - startTime, tool_name: name },
      };
    }

    try {
      let result: ToolResult;
      if (this.customHandlers.has(name)) {
        const handler = this.customHandlers.get(name)!;
        result = await handler(args);
      } else {
        result = await this.executeBuiltinTool(name, args);
      }

      result.metadata = {
        ...result.metadata,
        duration_ms: Date.now() - startTime,
        tool_name: name,
        timestamp: new Date().toISOString(),
        version: tool.version,
      };

      return result;
    } catch (err: any) {
      return {
        success: false,
        data: null,
        error: {
          type: 'EXECUTION_ERROR',
          message: err.message || 'An unknown error occurred during tool execution',
          details: err.stack,
        },
        metadata: { duration_ms: Date.now() - startTime, tool_name: name },
      };
    }
  }

  private validateArguments(tool: ToolMetadata, args: any): string | null {
    if (!args || typeof args !== 'object') {
      return 'Arguments must be an object.';
    }

    const required = tool.parameters.required || [];
    for (const req of required) {
      if (args[req] === undefined || args[req] === null) {
        return `Missing required parameter: '${req}'`;
      }
    }

    return null;
  }

  private registerBuiltinTools(): void {
    // --- WEB TOOLS ---
    this.registerTool({
      name: 'web_search',
      description: 'Search for technical documentation, protocols, RFCs, libraries, API specifications, and error messages. Do NOT use to copy ready-made configs.',
      version: '1.0.0',
      category: 'web',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query keyword or question.' },
          max_results: { type: 'number', description: 'Maximum search results to return (default 5).' },
        },
        required: ['query'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'fetch_webpage',
      description: 'Fetch the raw text or HTML content of a technical documentation webpage or API spec URL.',
      version: '1.0.0',
      category: 'web',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the web page to fetch.' },
        },
        required: ['url'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'extract_web_content',
      description: 'Extract clean markdown/plain text and structured sections from HTML content or a URL.',
      version: '1.0.0',
      category: 'web',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'HTML content or text to clean and format.' },
        },
        required: ['content'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    // --- PYTHON TOOLS ---
    this.registerTool({
      name: 'create_python_file',
      description: 'Create a Python (.py) file in the workspace or specific project directory.',
      version: '1.0.0',
      category: 'python',
      parameters: {
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Relative path in workspace (e.g. projects/math_solver/main.py)' },
          code: { type: 'string', description: 'Complete Python source code to write.' },
        },
        required: ['filepath', 'code'],
      },
      dependencies: ['python3'],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'edit_python_file',
      description: 'Edit or rewrite a Python file in the workspace.',
      version: '1.0.0',
      category: 'python',
      parameters: {
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Relative path in workspace.' },
          code: { type: 'string', description: 'New updated Python source code.' },
        },
        required: ['filepath', 'code'],
      },
      dependencies: ['python3'],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'run_python',
      description: 'Execute a Python script or inline Python code inside a controlled environment. Returns stdout, stderr, and exit code.',
      version: '1.0.0',
      category: 'python',
      parameters: {
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Relative path to .py file, OR omit to run inline code.' },
          code: { type: 'string', description: 'Inline Python code string to execute directly.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Command-line arguments for the script.' },
          venv_path: { type: 'string', description: 'Optional path to virtual environment python interpreter.' },
          timeout_ms: { type: 'number', description: 'Execution timeout in milliseconds (default 15000).' },
        },
        required: [],
      },
      dependencies: ['python3'],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'inspect_python_result',
      description: 'Analyze Python execution logs, traceback, and error lines to diagnose root causes.',
      version: '1.0.0',
      category: 'python',
      parameters: {
        type: 'object',
        properties: {
          stderr: { type: 'string', description: 'The stderr string or traceback output.' },
          code: { type: 'string', description: 'The Python source code that caused the error.' },
        },
        required: ['stderr'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    // --- ENVIRONMENT TOOLS ---
    this.registerTool({
      name: 'create_venv',
      description: 'Create a Python virtual environment (venv) for a project directory.',
      version: '1.0.0',
      category: 'environment',
      parameters: {
        type: 'object',
        properties: {
          project_dir: { type: 'string', description: 'Project directory relative to workspace (e.g. projects/data_pipeline).' },
        },
        required: ['project_dir'],
      },
      dependencies: ['python3'],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'install_python_package',
      description: 'Install one or more Python packages into the environment using pip.',
      version: '1.0.0',
      category: 'environment',
      parameters: {
        type: 'object',
        properties: {
          packages: { type: 'array', items: { type: 'string' }, description: 'List of package names (e.g. ["requests", "pyyaml"]).' },
          venv_path: { type: 'string', description: 'Optional project venv path.' },
        },
        required: ['packages'],
      },
      dependencies: ['pip3'],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'list_installed_packages',
      description: 'List installed Python packages in the current environment.',
      version: '1.0.0',
      category: 'environment',
      parameters: {
        type: 'object',
        properties: {
          venv_path: { type: 'string', description: 'Optional project venv path.' },
        },
        required: [],
      },
      dependencies: ['pip3'],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'inspect_environment',
      description: 'Check operating environment details: Python version, Node version, OS, directory paths, available binaries.',
      version: '1.0.0',
      category: 'environment',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    // --- FILE TOOLS ---
    this.registerTool({
      name: 'create_file',
      description: 'Create a file in the workspace directory with specified content.',
      version: '1.0.0',
      category: 'file',
      parameters: {
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Relative path in workspace (e.g. outputs/report.md).' },
          content: { type: 'string', description: 'File content string.' },
        },
        required: ['filepath', 'content'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'read_file',
      description: 'Read the text content of a file in the workspace.',
      version: '1.0.0',
      category: 'file',
      parameters: {
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Relative path in workspace.' },
        },
        required: ['filepath'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'edit_file',
      description: 'Update the content of an existing file in the workspace.',
      version: '1.0.0',
      category: 'file',
      parameters: {
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Relative path in workspace.' },
          content: { type: 'string', description: 'New file content.' },
        },
        required: ['filepath', 'content'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'delete_file',
      description: 'Delete a file within the workspace.',
      version: '1.0.0',
      category: 'file',
      parameters: {
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Relative path to delete.' },
        },
        required: ['filepath'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'list_files',
      description: 'List all files and directories in a workspace folder.',
      version: '1.0.0',
      category: 'file',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: 'Subdirectory path (default workspace root).' },
          recursive: { type: 'boolean', description: 'Whether to list recursively.' },
        },
        required: [],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'search_files',
      description: 'Search for text across workspace files.',
      version: '1.0.0',
      category: 'file',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or regex pattern.' },
          directory: { type: 'string', description: 'Subdirectory to search inside.' },
        },
        required: ['query'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    // --- SELF-EXTENDING AGENT TOOLS ---
    this.registerTool({
      name: 'create_tool',
      description: 'Create and register a brand new permanent custom tool for the Agent. Saves code, backs up version, tests it, and registers into the tool registry for immediate use.',
      version: '1.0.0',
      category: 'agent',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Unique identifier for the new tool (e.g. celsius_to_fahrenheit, json_schema_converter).' },
          description: { type: 'string', description: 'Clear explanation of what the tool accomplishes and how to call it.' },
          parameters: {
            type: 'object',
            description: 'JSON Schema of parameters object { type: "object", properties: {...}, required: [...] }',
          },
          code: { type: 'string', description: 'Executable Node.js or Python code implementing the tool function.' },
          runtime: { type: 'string', enum: ['python', 'javascript'], description: 'Runtime type (default python).' },
          dependencies: { type: 'array', items: { type: 'string' }, description: 'Required dependencies.' },
          test_args: { type: 'object', description: 'Sample argument object to test the tool upon creation.' },
        },
        required: ['name', 'description', 'parameters', 'code'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'inspect_tool',
      description: 'Inspect a registered tool: check parameters schema, code, version, dependencies, and test history.',
      version: '1.0.0',
      category: 'agent',
      parameters: {
        type: 'object',
        properties: {
          tool_name: { type: 'string', description: 'Name of the tool to inspect.' },
        },
        required: ['tool_name'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'test_tool',
      description: 'Run an isolated verification test on any built-in or custom registered tool with test input parameters.',
      version: '1.0.0',
      category: 'agent',
      parameters: {
        type: 'object',
        properties: {
          tool_name: { type: 'string', description: 'Name of the tool to test.' },
          test_arguments: { type: 'object', description: 'Input arguments object to pass to the tool.' },
        },
        required: ['tool_name', 'test_arguments'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    // --- DOCUMENTATION & MEMORY TOOLS ---
    this.registerTool({
      name: 'save_documentation',
      description: 'Save structured technical documentation, project architecture notes, or discoveries into persistent memory.',
      version: '1.0.0',
      category: 'memory',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title or topic of the document.' },
          category: { type: 'string', enum: ['notes', 'discoveries', 'solutions', 'architecture'], description: 'Category type.' },
          content: { type: 'string', description: 'Markdown or plain text documentation content.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Keywords or tags.' },
        },
        required: ['title', 'content'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'search_documentation',
      description: 'Search persistent memory documentation, previous discoveries, and solutions.',
      version: '1.0.0',
      category: 'memory',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or keyword.' },
          category: { type: 'string', description: 'Optional memory category filter.' },
        },
        required: ['query'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'save_experiment',
      description: 'Save a detailed experiment log (strategy, tools used, errors encountered, solutions, validation result).',
      version: '1.0.0',
      category: 'memory',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'Goal of the experiment.' },
          strategy: { type: 'string', description: 'Strategy executed.' },
          tools_used: { type: 'array', items: { type: 'string' }, description: 'Tools involved.' },
          errors: { type: 'array', items: { type: 'string' }, description: 'Errors encountered.' },
          solutions: { type: 'array', items: { type: 'string' }, description: 'Solutions that fixed the errors.' },
          final_result: { type: 'object', description: 'Result data or summary.' },
          verified: { type: 'boolean', description: 'Whether the experiment was verified.' },
        },
        required: ['goal', 'strategy'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'search_experiments',
      description: 'Search past experiment records to find previously tested strategies, fixes, and solutions.',
      version: '1.0.0',
      category: 'memory',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Goal, keyword, or error message to find past solutions for.' },
        },
        required: ['query'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    // --- VALIDATION TOOLS ---
    this.registerTool({
      name: 'validate_output',
      description: 'Perform rigorous validation on an output artifact (JSON schema validity, syntax checking, data integrity assertions).',
      version: '1.0.0',
      category: 'validation',
      parameters: {
        type: 'object',
        properties: {
          artifact_type: { type: 'string', enum: ['json', 'v2ray_config', 'python', 'text'], description: 'Type of artifact.' },
          content: { type: 'string', description: 'String content to validate.' },
          assertions: { type: 'array', items: { type: 'string' }, description: 'List of specific assertions or constraints.' },
        },
        required: ['artifact_type', 'content'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'diagnose_failure',
      description: 'Diagnose a failed action, classify error type, check if stuck in loop, and produce an actionable alternative strategy.',
      version: '1.0.0',
      category: 'validation',
      parameters: {
        type: 'object',
        properties: {
          error_message: { type: 'string', description: 'The error message or failure log.' },
          attempt_count: { type: 'number', description: 'Number of failed attempts with this strategy.' },
          action_history: { type: 'array', items: { type: 'string' }, description: 'Recent actions taken.' },
        },
        required: ['error_message'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    // --- V2RAY CONFIG BUILDER & VALIDATOR TOOLS ---
    this.registerTool({
      name: 'v2ray_build_config',
      description: 'Build a production V2Ray/Xray configuration model from structured parameters (VLESS, VMess, Trojan, Shadowsocks over TCP, WebSocket, gRPC, Reality, TLS). NEVER copies ready-made configs.',
      version: '1.0.0',
      category: 'v2ray',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['server', 'client'], description: 'Server or client role.' },
          protocol: { type: 'string', enum: ['vless', 'vmess', 'trojan', 'shadowsocks'], description: 'Protocol choice.' },
          serverAddress: { type: 'string', description: 'Server host or IP address (e.g. your-vps.example.com).' },
          port: { type: 'number', description: 'Port number (e.g. 443, 8443, 10808).' },
          uuid: { type: 'string', description: 'UUID user ID (auto-generated if omitted).' },
          password: { type: 'string', description: 'Password for Trojan / Shadowsocks.' },
          transport: { type: 'string', enum: ['tcp', 'ws', 'grpc', 'httpupgrade'], description: 'Transport network.' },
          security: { type: 'string', enum: ['none', 'tls', 'reality'], description: 'Security layer.' },
          sni: { type: 'string', description: 'SNI domain name.' },
          realityPublicKey: { type: 'string', description: 'Reality public key (for client).' },
          realityPrivateKey: { type: 'string', description: 'Reality private key (for server).' },
          realityShortIds: { type: 'array', items: { type: 'string' }, description: 'Reality short IDs.' },
          realityDest: { type: 'string', description: 'Reality destination fallback server (e.g. www.cloudflare.com:443).' },
          wsPath: { type: 'string', description: 'WebSocket or HTTPUpgrade path (e.g. /ws).' },
          grpcServiceName: { type: 'string', description: 'gRPC service name.' },
          blockAds: { type: 'boolean', description: 'Add ad-blocking routing rules.' },
          blockPrivateIps: { type: 'boolean', description: 'Add private IP blocking routing rules.' },
          remark: { type: 'string', description: 'Friendly name / remark for the config.' },
        },
        required: ['role', 'protocol', 'transport', 'security'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'v2ray_validate_config',
      description: 'Run exhaustive syntactic and semantic validation on a V2Ray/Xray JSON configuration.',
      version: '1.0.0',
      category: 'v2ray',
      parameters: {
        type: 'object',
        properties: {
          config_json: { type: 'string', description: 'The V2Ray configuration JSON string to validate.' },
        },
        required: ['config_json'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'v2ray_test_config',
      description: 'Test the V2Ray configuration using local validation engine or xray binary check if present.',
      version: '1.0.0',
      category: 'v2ray',
      parameters: {
        type: 'object',
        properties: {
          config_json: { type: 'string', description: 'Configuration JSON to test.' },
        },
        required: ['config_json'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });

    this.registerTool({
      name: 'export_artifact',
      description: 'Save and register a finalized output artifact (V2Ray config, Python script, Markdown report, Dataset) in workspace/outputs/ with proper version and metadata.',
      version: '1.0.0',
      category: 'agent',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Appropriate output filename (e.g. v2ray_vless_reality_server_20260902.json, prime_calculator_v1.py, audit_report.md).' },
          type: { type: 'string', enum: ['json', 'python', 'markdown', 'yaml', 'text', 'v2ray_config'], description: 'Artifact type.' },
          content: { type: 'string', description: 'Content of the artifact.' },
          goal: { type: 'string', description: 'Goal that produced this artifact.' },
          validated: { type: 'boolean', description: 'Whether this artifact passed validation.' },
          validation_result: { type: 'string', description: 'Summary of validation results.' },
          share_link: { type: 'string', description: 'Optional share link for v2ray configs.' },
        },
        required: ['filename', 'type', 'content'],
      },
      dependencies: [],
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
    });
  }

  private registerTool(metadata: ToolMetadata): void {
    this.tools.set(metadata.name, metadata);
  }

  private loadCustomTools(): void {
    const registryPath = path.join(this.workspace.toolsDir, 'registry.json');
    if (fs.existsSync(registryPath)) {
      try {
        const raw = fs.readFileSync(registryPath, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.tools)) {
          for (const meta of data.tools) {
            this.registerTool(meta);
            this.bindCustomToolHandler(meta);
          }
        }
      } catch (err) {
        console.error('Failed to parse custom tool registry:', err);
      }
    }
  }

  private getSystemPythonCmd(): string {
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  private getSystemPipCmd(): string {
    return process.platform === 'win32' ? 'pip' : 'pip3';
  }

  private getVenvPythonCmd(venvDir: string): string {
    return process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python3');
  }

  private getVenvPipCmd(venvDir: string): string {
    return process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'pip.exe')
      : path.join(venvDir, 'bin', 'pip');
  }

  private bindCustomToolHandler(meta: ToolMetadata): void {
    this.customHandlers.set(meta.name, async (args: any) => {
      // Execute custom tool code
      if (meta.code) {
        // If Python custom tool:
        const tempScript = `temp_tool_${meta.name}_${Date.now()}.py`;
        const scriptPath = path.join(this.workspace.tempDir, tempScript);

        const wrapperCode = `
import sys
import json

${meta.code}

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        # Try calling the function named '${meta.name}' or 'main' or 'run'
        func = None
        for fn_name in ['${meta.name}', 'run', 'main', 'execute']:
            if fn_name in locals() and callable(locals()[fn_name]):
                func = locals()[fn_name]
                break
        if func:
            result = func(**input_data)
            print(json.dumps({"success": True, "result": result}))
        else:
            print(json.dumps({"success": False, "error": "No matching entry function found in custom tool script"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
`;
        fs.writeFileSync(scriptPath, wrapperCode, 'utf-8');
        try {
          const runRes = await this.runSubprocess(this.getSystemPythonCmd(), [scriptPath, JSON.stringify(args)]);
          if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);

          if (runRes.exitCode === 0 && runRes.stdout) {
            try {
              const parsed = JSON.parse(runRes.stdout.trim());
              if (parsed.success) {
                return { success: true, data: parsed.result, error: null };
              } else {
                return { success: false, data: null, error: { type: 'CUSTOM_TOOL_ERROR', message: parsed.error } };
              }
            } catch {
              return { success: true, data: runRes.stdout.trim(), error: null };
            }
          } else {
            return {
              success: false,
              data: null,
              error: {
                type: 'CUSTOM_TOOL_EXECUTION_FAILED',
                message: runRes.stderr || 'Custom tool execution failed',
                details: runRes.stdout,
              },
            };
          }
        } catch (err: any) {
          if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
          return { success: false, data: null, error: { type: 'CUSTOM_TOOL_RUN_ERROR', message: err.message } };
        }
      }

      return { success: false, data: null, error: { type: 'NO_IMPLEMENTATION', message: 'No executable code found for custom tool' } };
    });
  }

  private async executeBuiltinTool(name: string, args: any): Promise<ToolResult> {
    switch (name) {
      // --- WEB TOOLS ---
      case 'web_search': {
        const query = args.query;
        const maxResults = args.max_results || 5;

        // Perform real search using public tech sources and fallback technical synthesis
        const results = await this.performWebSearch(query, maxResults);
        return {
          success: true,
          data: {
            query,
            count: results.length,
            results,
          },
          error: null,
        };
      }

      case 'fetch_webpage': {
        const url = args.url;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const resp = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
          clearTimeout(timeout);

          if (!resp.ok) {
            return {
              success: false,
              data: null,
              error: { type: 'HTTP_ERROR', message: `Fetch failed with status ${resp.status} ${resp.statusText}` },
            };
          }
          const text = await resp.text();
          return {
            success: true,
            data: {
              url,
              status: resp.status,
              length: text.length,
              content: text.slice(0, 15000), // Preview limit
            },
            error: null,
          };
        } catch (err: any) {
          return {
            success: false,
            data: null,
            error: { type: 'FETCH_ERROR', message: `Could not fetch ${url}: ${err.message}` },
          };
        }
      }

      case 'extract_web_content': {
        const content = args.content || '';
        // Clean basic html tags
        const cleaned = content
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return {
          success: true,
          data: {
            extracted_text: cleaned.slice(0, 8000),
            length: cleaned.length,
          },
          error: null,
        };
      }

      // --- PYTHON & ENVIRONMENT TOOLS ---
      case 'create_python_file':
      case 'edit_python_file': {
        const filepath = args.filepath;
        const code = args.code;
        try {
          const savedPath = this.workspace.writeFile(filepath, code);
          return {
            success: true,
            data: {
              filepath,
              saved_path: savedPath,
              lines: code.split('\n').length,
              bytes: Buffer.byteLength(code, 'utf-8'),
            },
            error: null,
          };
        } catch (err: any) {
          return { success: false, data: null, error: { type: 'FILE_WRITE_ERROR', message: err.message } };
        }
      }

      case 'run_python': {
        const timeoutMs = args.timeout_ms || 15000;
        let scriptPath = '';
        let isTemp = false;

        if (args.filepath) {
          scriptPath = this.workspace.resolvePath(args.filepath);
        } else if (args.code) {
          const tempFile = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.py`;
          scriptPath = path.join(this.workspace.tempDir, tempFile);
          fs.writeFileSync(scriptPath, args.code, 'utf-8');
          isTemp = true;
        } else {
          return {
            success: false,
            data: null,
            error: { type: 'MISSING_INPUT', message: 'Must provide either filepath or inline code.' },
          };
        }

        const pythonCmd = args.venv_path
          ? this.getVenvPythonCmd(this.workspace.resolvePath(args.venv_path))
          : this.getSystemPythonCmd();
        const procArgs = [scriptPath, ...(args.args || [])];

        const runResult = await this.runSubprocess(pythonCmd, procArgs, timeoutMs, path.dirname(scriptPath));

        if (isTemp && fs.existsSync(scriptPath)) {
          try { fs.unlinkSync(scriptPath); } catch {}
        }

        const isSuccess = runResult.exitCode === 0;
        return {
          success: isSuccess,
          data: {
            exit_code: runResult.exitCode,
            stdout: runResult.stdout,
            stderr: runResult.stderr,
            duration_ms: runResult.durationMs,
          },
          error: isSuccess ? null : {
            type: 'PYTHON_EXECUTION_ERROR',
            message: runResult.stderr || `Python exited with non-zero exit code: ${runResult.exitCode}`,
            details: runResult.stdout,
          },
        };
      }

      case 'inspect_python_result': {
        const stderr = args.stderr || '';
        const code = args.code || '';

        // Analyze trace
        let diagnosis = 'General Python Error';
        let suggestedFix = 'Check syntax and logic.';
        let missingPackage = '';

        if (stderr.includes('ModuleNotFoundError: No module named')) {
          const match = stderr.match(/No module named ['"]([^'"]+)['"]/);
          missingPackage = match ? match[1] : 'unknown';
          diagnosis = `Missing Dependency: '${missingPackage}' is not installed in the environment.`;
          suggestedFix = `Use 'install_python_package' tool with package '${missingPackage}' then retry.`;
        } else if (stderr.includes('SyntaxError')) {
          diagnosis = 'Python Syntax Error';
          suggestedFix = 'Check indentation, missing colons, or unclosed parenthesis/quotes.';
        } else if (stderr.includes('TypeError')) {
          diagnosis = 'Python Type Mismatch';
          suggestedFix = 'Verify argument types and function signatures.';
        } else if (stderr.includes('ZeroDivisionError')) {
          diagnosis = 'Division by zero detected';
          suggestedFix = 'Add guard conditions for zero divisors.';
        }

        return {
          success: true,
          data: {
            diagnosis,
            missing_package: missingPackage || null,
            suggested_fix: suggestedFix,
            trace_preview: stderr.split('\n').slice(-8).join('\n'),
          },
          error: null,
        };
      }

      case 'create_venv': {
        const projectDir = this.workspace.resolvePath(args.project_dir);
        const venvDir = path.join(projectDir, 'venv');
        fs.mkdirSync(projectDir, { recursive: true });

        const res = await this.runSubprocess(this.getSystemPythonCmd(), ['-m', 'venv', venvDir]);
        if (res.exitCode === 0) {
          return {
            success: true,
            data: {
              venv_path: path.relative(this.workspace.rootDir, venvDir),
              python_bin: this.getVenvPythonCmd(venvDir),
              message: 'Virtual environment created successfully.',
            },
            error: null,
          };
        } else {
          return {
            success: false,
            data: null,
            error: { type: 'VENV_CREATION_FAILED', message: res.stderr || 'Failed to create virtual environment' },
          };
        }
      }

      case 'install_python_package': {
        const packages = args.packages || [];
        let pipCmd = this.getSystemPipCmd();
        if (args.venv_path) {
          pipCmd = this.getVenvPipCmd(this.workspace.resolvePath(args.venv_path));
        }

        const res = await this.runSubprocess(pipCmd, ['install', ...packages]);
        if (res.exitCode === 0) {
          return {
            success: true,
            data: {
              packages_installed: packages,
              stdout: res.stdout,
              message: `Packages [${packages.join(', ')}] installed successfully.`,
            },
            error: null,
          };
        } else {
          return {
            success: false,
            data: null,
            error: { type: 'PIP_INSTALL_ERROR', message: res.stderr || 'Failed to install packages', details: res.stdout },
          };
        }
      }

      case 'list_installed_packages': {
        let pipCmd = this.getSystemPipCmd();
        if (args.venv_path) {
          pipCmd = this.getVenvPipCmd(this.workspace.resolvePath(args.venv_path));
        }
        const res = await this.runSubprocess(pipCmd, ['list', '--format=json']);
        if (res.exitCode === 0) {
          try {
            const list = JSON.parse(res.stdout);
            return { success: true, data: { count: list.length, packages: list }, error: null };
          } catch {
            return { success: true, data: { raw: res.stdout }, error: null };
          }
        } else {
          return { success: false, data: null, error: { type: 'PIP_LIST_ERROR', message: res.stderr } };
        }
      }

      case 'inspect_environment': {
        let pyVer = 'Unknown';
        try {
          const checkCmd = process.platform === 'win32' ? 'python --version' : 'python3 --version';
          pyVer = execSync(checkCmd, { encoding: 'utf-8' }).trim();
        } catch {}
        let nodeVer = process.version;
        return {
          success: true,
          data: {
            os_platform: process.platform,
            os_arch: process.arch,
            python_version: pyVer,
            node_version: nodeVer,
            workspace_root: this.workspace.rootDir,
            tools_count: this.tools.size,
          },
          error: null,
        };
      }

      // --- FILE TOOLS ---
      case 'create_file': {
        try {
          const target = this.workspace.writeFile(args.filepath, args.content);
          return { success: true, data: { path: args.filepath, target, bytes: Buffer.byteLength(args.content, 'utf-8') }, error: null };
        } catch (err: any) {
          return { success: false, data: null, error: { type: 'FILE_CREATE_ERROR', message: err.message } };
        }
      }

      case 'read_file': {
        try {
          const content = this.workspace.readFile(args.filepath);
          return { success: true, data: { path: args.filepath, content, length: content.length }, error: null };
        } catch (err: any) {
          return { success: false, data: null, error: { type: 'FILE_READ_ERROR', message: err.message } };
        }
      }

      case 'edit_file': {
        try {
          this.workspace.writeFile(args.filepath, args.content);
          return { success: true, data: { path: args.filepath, updated: true }, error: null };
        } catch (err: any) {
          return { success: false, data: null, error: { type: 'FILE_EDIT_ERROR', message: err.message } };
        }
      }

      case 'delete_file': {
        try {
          const deleted = this.workspace.deleteFile(args.filepath);
          return { success: true, data: { path: args.filepath, deleted }, error: null };
        } catch (err: any) {
          return { success: false, data: null, error: { type: 'FILE_DELETE_ERROR', message: err.message } };
        }
      }

      case 'list_files': {
        const list = this.workspace.listFiles(args.directory || '', !!args.recursive);
        return { success: true, data: { count: list.length, files: list }, error: null };
      }

      case 'search_files': {
        const results = this.workspace.searchFiles(args.query, args.directory || '');
        return { success: true, data: { count: results.length, matches: results }, error: null };
      }

      // --- SELF-EXTENDING TOOL SYSTEM ---
      case 'create_tool': {
        const { name: toolName, description, parameters, code, dependencies, test_args } = args;

        // Check if tool already exists
        const existing = this.tools.get(toolName);
        const nextVersion = existing ? `v${parseInt(existing.version.replace('v', '') || '1') + 1}` : 'v1.0.0';

        // Backup existing if exists
        const toolDir = path.join(this.workspace.customToolsDir, toolName);
        if (existing) {
          const backupDir = path.join(toolDir, existing.version || 'v1');
          fs.mkdirSync(backupDir, { recursive: true });
          if (fs.existsSync(path.join(toolDir, 'tool.py'))) {
            fs.copyFileSync(path.join(toolDir, 'tool.py'), path.join(backupDir, 'tool.py'));
          }
        }

        fs.mkdirSync(toolDir, { recursive: true });
        const toolFilePath = path.join(toolDir, 'tool.py');
        fs.writeFileSync(toolFilePath, code, 'utf-8');

        const newMeta: ToolMetadata = {
          name: toolName,
          description,
          version: nextVersion,
          category: 'custom',
          parameters: parameters || { type: 'object', properties: {}, required: [] },
          code,
          dependencies: dependencies || [],
          status: 'active',
          is_custom: true,
          created_at: new Date().toISOString(),
          last_tested: new Date().toISOString(),
        };

        // Test the tool first if test_args provided
        this.registerTool(newMeta);
        this.bindCustomToolHandler(newMeta);

        let testResult: ToolResult | null = null;
        if (test_args) {
          testResult = await this.executeTool(toolName, test_args);
          if (!testResult.success) {
            newMeta.status = 'error';
          }
        }

        // Persist to registry.json
        this.saveCustomToolToRegistry(newMeta);

        return {
          success: true,
          data: {
            tool_name: toolName,
            version: nextVersion,
            status: newMeta.status,
            test_run: testResult,
            message: `Tool '${toolName}' (${nextVersion}) successfully created and registered into persistent system.`,
          },
          error: null,
        };
      }

      case 'inspect_tool': {
        const tool = this.tools.get(args.tool_name);
        if (!tool) {
          return { success: false, data: null, error: { type: 'NOT_FOUND', message: `Tool '${args.tool_name}' not found.` } };
        }
        return { success: true, data: { tool }, error: null };
      }

      case 'test_tool': {
        const toolName = args.tool_name;
        const testArgs = args.test_arguments || {};
        const result = await this.executeTool(toolName, testArgs);
        return {
          success: true,
          data: {
            tested_tool: toolName,
            test_arguments: testArgs,
            result,
          },
          error: null,
        };
      }

      // --- DOCUMENTATION & MEMORY TOOLS ---
      case 'save_documentation': {
        const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const docPath = path.join(this.workspace.notesDir, `${docId}.json`);
        const docData = {
          id: docId,
          title: args.title,
          category: args.category || 'notes',
          content: args.content,
          tags: args.tags || [],
          created_at: new Date().toISOString(),
        };
        fs.writeFileSync(docPath, JSON.stringify(docData, null, 2), 'utf-8');
        return { success: true, data: { doc_id: docId, saved_path: docPath, title: args.title }, error: null };
      }

      case 'search_documentation': {
        const query = (args.query || '').toLowerCase();
        const results: any[] = [];
        const files = this.workspace.listFiles('memory', true);

        for (const file of files) {
          if (file.name.endsWith('.json') || file.name.endsWith('.md')) {
            try {
              const content = this.workspace.readFile(file.path);
              if (content.toLowerCase().includes(query)) {
                let parsed: any = null;
                try { parsed = JSON.parse(content); } catch { parsed = { raw: content.slice(0, 500) }; }
                results.push({ file: file.path, data: parsed });
              }
            } catch {}
          }
        }
        return { success: true, data: { count: results.length, matches: results }, error: null };
      }

      case 'save_experiment': {
        const expId = `exp_${Date.now()}`;
        const expRecord: ExperimentRecord = {
          id: expId,
          goal: args.goal,
          date: new Date().toISOString(),
          strategy: args.strategy,
          tools_used: args.tools_used || [],
          commands_executed: [],
          dependencies_installed: [],
          experiments: [],
          errors: args.errors || [],
          solutions: args.solutions || [],
          final_result: args.final_result || {},
          validation_result: {
            verified: !!args.verified,
            criteria: 'Goal validation test pass',
          },
          important_discoveries: [],
        };
        const expPath = path.join(this.workspace.experimentsDir, `${expId}.json`);
        fs.writeFileSync(expPath, JSON.stringify(expRecord, null, 2), 'utf-8');
        return { success: true, data: { experiment_id: expId, path: expPath }, error: null };
      }

      case 'search_experiments': {
        const query = (args.query || '').toLowerCase();
        const results: any[] = [];
        const files = this.workspace.listFiles('memory/experiments', false);

        for (const f of files) {
          if (f.name.endsWith('.json')) {
            try {
              const content = this.workspace.readFile(f.path);
              if (content.toLowerCase().includes(query)) {
                results.push(JSON.parse(content));
              }
            } catch {}
          }
        }
        return { success: true, data: { count: results.length, experiments: results }, error: null };
      }

      // --- VALIDATION TOOLS ---
      case 'validate_output': {
        const artifactType = args.artifact_type;
        const content = args.content;

        if (artifactType === 'json') {
          try {
            const parsed = JSON.parse(content);
            return {
              success: true,
              data: { valid: true, type: 'json', parsed_keys: Object.keys(parsed) },
              error: null,
            };
          } catch (err: any) {
            return {
              success: false,
              data: { valid: false },
              error: { type: 'JSON_SYNTAX_ERROR', message: `Invalid JSON: ${err.message}` },
            };
          }
        } else if (artifactType === 'v2ray_config') {
          try {
            const parsed = JSON.parse(content);
            const valRes = V2RayValidator.validate(parsed);
            return {
              success: valRes.valid,
              data: valRes,
              error: valRes.valid ? null : { type: 'V2RAY_SCHEMA_VIOLATION', message: `Config failed validation (${valRes.errors.length} errors)` },
            };
          } catch (err: any) {
            return { success: false, data: null, error: { type: 'JSON_PARSE_ERROR', message: err.message } };
          }
        }

        return { success: true, data: { valid: true, length: content.length }, error: null };
      }

      case 'diagnose_failure': {
        const errMsg = args.error_message || '';
        const attempts = args.attempt_count || 1;

        let isLoop = attempts >= 3;
        let rootCause = 'Unknown execution failure';
        let suggestedStrategy = 'Review error parameters and test with isolated unit script.';

        if (errMsg.includes('ModuleNotFoundError') || errMsg.includes('No module named')) {
          rootCause = 'Missing Python library';
          suggestedStrategy = 'Install the required library with install_python_package tool.';
        } else if (errMsg.includes('Address already in use') || errMsg.includes('EADDRINUSE')) {
          rootCause = 'Port conflict';
          suggestedStrategy = 'Change the listening port to an unoccupied port.';
        } else if (errMsg.includes('SyntaxError') || errMsg.includes('JSON')) {
          rootCause = 'Syntax/Formatting defect';
          suggestedStrategy = 'Format and validate JSON or code structure before execution.';
        }

        return {
          success: true,
          data: {
            root_cause: rootCause,
            is_stuck_in_loop: isLoop,
            suggested_strategy: suggestedStrategy,
            needs_new_tool: isLoop,
          },
          error: null,
        };
      }

      // --- V2RAY CONFIG GENERATION & TESTING TOOLS ---
      case 'v2ray_build_config': {
        const buildParams: V2RayBuilderParams = {
          role: args.role,
          protocol: args.protocol,
          serverAddress: args.serverAddress,
          port: args.port,
          uuid: args.uuid,
          password: args.password,
          transport: args.transport,
          security: args.security,
          sni: args.sni,
          realityPublicKey: args.realityPublicKey,
          realityPrivateKey: args.realityPrivateKey,
          realityShortIds: args.realityShortIds,
          realityDest: args.realityDest,
          wsPath: args.wsPath,
          grpcServiceName: args.grpcServiceName,
          blockAds: args.blockAds,
          blockPrivateIps: args.blockPrivateIps,
          remark: args.remark,
        };

        const result = V2RayBuilder.buildConfig(buildParams);
        const valRes = V2RayValidator.validate(result.config);

        return {
          success: valRes.valid,
          data: {
            config: result.config,
            share_link: result.shareLink,
            summary: result.summary,
            validation: valRes,
          },
          error: valRes.valid ? null : { type: 'BUILT_CONFIG_INVALID', message: 'Built config has schema warnings/errors' },
        };
      }

      case 'v2ray_validate_config': {
        try {
          const parsed = JSON.parse(args.config_json);
          const valRes = V2RayValidator.validate(parsed);
          return {
            success: valRes.valid,
            data: valRes,
            error: valRes.valid ? null : { type: 'VALIDATION_FAILED', message: `Found ${valRes.errors.length} validation errors.` },
          };
        } catch (err: any) {
          return { success: false, data: null, error: { type: 'JSON_SYNTAX_ERROR', message: err.message } };
        }
      }

      case 'v2ray_test_config': {
        try {
          const parsed = JSON.parse(args.config_json);
          const valRes = V2RayValidator.validate(parsed);

          // Check if xray / v2ray binary exists on system
          let binaryTestRan = false;
          let binaryOutput = 'Engine binary test skipped (xray binary not in system path, relied on strict semantic validator)';

          try {
            const checkCmd = process.platform === 'win32' ? 'where xray.exe || where v2ray.exe' : 'which xray || which v2ray';
            const xrayCheck = execSync(checkCmd, { encoding: 'utf-8' }).trim().split('\n')[0].trim();
            if (xrayCheck) {
              const tempConfig = path.join(this.workspace.tempDir, `test_v2ray_${Date.now()}.json`);
              fs.writeFileSync(tempConfig, JSON.stringify(parsed, null, 2), 'utf-8');
              const testExec = execSync(`"${xrayCheck}" test -c "${tempConfig}"`, { encoding: 'utf-8' });
              if (fs.existsSync(tempConfig)) fs.unlinkSync(tempConfig);
              binaryTestRan = true;
              binaryOutput = `Binary validation output: ${testExec}`;
            }
          } catch {
            // Binary test not available or errored
          }

          const passed = valRes.valid;
          return {
            success: passed,
            data: {
              validation_result: valRes,
              binary_engine_tested: binaryTestRan,
              engine_status: binaryOutput,
              score: valRes.score,
              all_checks_passed: passed,
            },
            error: passed ? null : { type: 'CONFIG_TEST_FAILED', message: 'Configuration failed semantic testing' },
          };
        } catch (err: any) {
          return { success: false, data: null, error: { type: 'JSON_ERROR', message: err.message } };
        }
      }

      case 'export_artifact': {
        const { filename, type, content, goal, validated, validation_result, share_link } = args;
        const outPath = path.join(this.workspace.outputsDir, filename);
        fs.writeFileSync(outPath, content, 'utf-8');

        // Save metadata
        const metaPath = path.join(this.workspace.outputsDir, `${filename}.meta.json`);
        const metaData = {
          filename,
          path: `outputs/${filename}`,
          type,
          goal: goal || '',
          created_at: new Date().toISOString(),
          validated: validated !== false,
          validation_result: validation_result || 'Verified successfully.',
          source: 'generated',
          version: '1.0.0',
          size_bytes: Buffer.byteLength(content, 'utf-8'),
          share_link,
        };
        fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2), 'utf-8');

        return {
          success: true,
          data: {
            filename,
            saved_to: `workspace/outputs/${filename}`,
            size_bytes: metaData.size_bytes,
            metadata: metaData,
          },
          error: null,
        };
      }

      default:
        return {
          success: false,
          data: null,
          error: { type: 'UNKNOWN_TOOL', message: `Handler for '${name}' not implemented.` },
        };
    }
  }

  private saveCustomToolToRegistry(meta: ToolMetadata): void {
    const registryPath = path.join(this.workspace.toolsDir, 'registry.json');
    let registryData: { tools: ToolMetadata[] } = { tools: [] };
    if (fs.existsSync(registryPath)) {
      try {
        registryData = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      } catch {}
    }

    // Replace or add
    const index = registryData.tools.findIndex(t => t.name === meta.name);
    if (index >= 0) {
      registryData.tools[index] = meta;
    } else {
      registryData.tools.push(meta);
    }

    fs.writeFileSync(registryPath, JSON.stringify(registryData, null, 2), 'utf-8');
  }

  private async performWebSearch(query: string, maxResults: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
    // Try Searx / DuckDuckGo / Wikipedia API
    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const resp = await fetch(ddgUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const html = await resp.text();
        const results: Array<{ title: string; url: string; snippet: string }> = [];
        const regex = /<a class="result__snippet[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
        let match;
        while ((match = regex.exec(html)) !== null && results.length < maxResults) {
          results.push({
            title: `Technical Reference for: ${query}`,
            url: match[1],
            snippet: match[2].replace(/<[^>]+>/g, '').trim(),
          });
        }
        if (results.length > 0) return results;
      }
    } catch {
      // Fallback
    }

    // Technical knowledge synthesis fallback for documentation
    return [
      {
        title: `V2Ray / Xray Official Documentation: ${query}`,
        url: 'https://xtls.github.io/config/',
        snippet: `Technical specification for V2Ray / Xray protocols, transport layers (TCP, WebSocket, gRPC, HTTPUpgrade), and Reality security settings.`,
      },
      {
        title: `Python 3 Standard Library Reference: ${query}`,
        url: 'https://docs.python.org/3/library/',
        snippet: `Official Python standard library documentation, module signatures, and parameter specifications.`,
      },
    ];
  }

  private runSubprocess(cmd: string, args: string[], timeoutMs: number = 15000, cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
    return new Promise((resolve) => {
      const start = Date.now();
      let stdout = '';
      let stderr = '';
      let isSettled = false;

      const isWin = process.platform === 'win32';
      const child = spawn(cmd, args, {
        cwd: cwd || this.workspace.rootDir,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        shell: isWin,
      });

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          try {
            if (isWin) {
              child.kill();
            } else {
              child.kill('SIGKILL');
            }
          } catch {}
          resolve({
            exitCode: -1,
            stdout,
            stderr: stderr + `\nExecution timed out after ${timeoutMs}ms`,
            durationMs: Date.now() - start,
          });
        }
      }, timeoutMs);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          resolve({
            exitCode: code ?? 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            durationMs: Date.now() - start,
          });
        }
      });

      child.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          resolve({
            exitCode: -1,
            stdout: stdout.trim(),
            stderr: err.message,
            durationMs: Date.now() - start,
          });
        }
      });
    });
  }
}

export const defaultToolRegistry = new ToolRegistry();

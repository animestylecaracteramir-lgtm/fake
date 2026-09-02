import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PermissionScope, ToolMetadata } from '../types';
import { WorkspaceManager, defaultWorkspace } from '../workspace';

export interface SandboxExecutionOptions {
  timeoutMs?: number;
  maxMemoryMb?: number;
  permissions?: PermissionScope[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface SandboxExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  securityViolations: string[];
  timedOut: boolean;
}

export class ToolSandbox {
  private workspace: WorkspaceManager;

  // Forbidden patterns that custom/generated tools must not execute without explicit system permissions
  private static readonly FORBIDDEN_CODE_PATTERNS = [
    /process\.env\.(GEMINI_API_KEY|OPENAI_API_KEY|API_KEY|SECRET|PASSWORD|TOKEN)/i,
    /require\(['"]child_process['"]\)\.(execSync|spawnSync)\(['"]rm\s+-rf\s+\/['"]\)/i,
    /\/server\/agent\//i,
    /\/server\/tools\/sandbox/i,
    /\.env(\.example)?/i,
    /ssh_keys|id_rsa|\.aws\/credentials/i,
  ];

  constructor(workspace?: WorkspaceManager) {
    this.workspace = workspace || defaultWorkspace;
  }

  public validateCodeSecurity(code: string, requiredPermissions: PermissionScope[] = []): { safe: boolean; violations: string[] } {
    const violations: string[] = [];

    for (const pattern of ToolSandbox.FORBIDDEN_CODE_PATTERNS) {
      if (pattern.test(code)) {
        violations.push(`Security Policy Violation: Banned pattern matched: ${pattern.toString()}`);
      }
    }

    // Permission enforcement checks in code
    if (code.includes('import requests') || code.includes('urllib') || code.includes('fetch(') || code.includes('http.client')) {
      if (!requiredPermissions.includes('network.read') && !requiredPermissions.includes('network.write')) {
        violations.push(`Permission Violation: Network operations detected in code but missing 'network.read' / 'network.write' permissions.`);
      }
    }

    if (code.includes('open(') || code.includes('fs.write') || code.includes('fs.unlink')) {
      if (!requiredPermissions.includes('filesystem.read') && !requiredPermissions.includes('filesystem.write')) {
        violations.push(`Permission Violation: File operations detected in code but missing 'filesystem.read' / 'filesystem.write' permissions.`);
      }
    }

    return {
      safe: violations.length === 0,
      violations,
    };
  }

  public async runPythonSandboxed(
    codeOrFilepath: { code?: string; filepath?: string },
    args: any[] = [],
    options: SandboxExecutionOptions = {}
  ): Promise<SandboxExecutionResult> {
    const start = Date.now();
    const timeoutMs = options.timeoutMs || 10000;
    const securityViolations: string[] = [];

    let scriptPath = '';
    let isTemp = false;

    if (codeOrFilepath.code) {
      // Validate code security before writing to disk
      const secCheck = this.validateCodeSecurity(codeOrFilepath.code, options.permissions || []);
      if (!secCheck.safe) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: secCheck.violations.join('\n'),
          durationMs: 0,
          securityViolations: secCheck.violations,
          timedOut: false,
        };
      }

      const tempName = `sandbox_exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.py`;
      scriptPath = path.join(this.workspace.tempDir, tempName);
      fs.writeFileSync(scriptPath, codeOrFilepath.code, 'utf-8');
      isTemp = true;
    } else if (codeOrFilepath.filepath) {
      scriptPath = this.workspace.resolvePath(codeOrFilepath.filepath);
    } else {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'Missing executable code or filepath.',
        durationMs: 0,
        securityViolations: ['No code provided'],
        timedOut: false,
      };
    }

    // Prepare clean sanitized environment without leaking server secrets
    const sanitizedEnv: Record<string, string> = {
      PATH: process.env.PATH || '',
      PYTHONUNBUFFERED: '1',
      NODE_ENV: 'sandbox',
      ...(options.env || {}),
    };

    return new Promise((resolve) => {
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      const isWin = process.platform === 'win32';
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let isSettled = false;

      const procArgs = [scriptPath, ...(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)))];
      const child = spawn(pythonCmd, procArgs, {
        cwd: options.cwd || this.workspace.rootDir,
        env: sanitizedEnv,
        shell: isWin,
      });

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          timedOut = true;
          try {
            if (isWin) {
              child.kill();
            } else {
              child.kill('SIGKILL');
            }
          } catch {}
          if (isTemp && fs.existsSync(scriptPath)) {
            try { fs.unlinkSync(scriptPath); } catch {}
          }
          resolve({
            exitCode: -1,
            stdout,
            stderr: stderr + `\nExecution timed out after ${timeoutMs}ms limit.`,
            durationMs: Date.now() - start,
            securityViolations,
            timedOut: true,
          });
        }
      }, timeoutMs);

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          if (isTemp && fs.existsSync(scriptPath)) {
            try { fs.unlinkSync(scriptPath); } catch {}
          }
          resolve({
            exitCode: code ?? 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            durationMs: Date.now() - start,
            securityViolations,
            timedOut: false,
          });
        }
      });

      child.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          if (isTemp && fs.existsSync(scriptPath)) {
            try { fs.unlinkSync(scriptPath); } catch {}
          }
          resolve({
            exitCode: 1,
            stdout,
            stderr: err.message,
            durationMs: Date.now() - start,
            securityViolations: [err.message],
            timedOut: false,
          });
        }
      });
    });
  }
}

export const defaultToolSandbox = new ToolSandbox();

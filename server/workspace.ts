import fs from 'fs';
import path from 'path';

export class WorkspaceManager {
  public readonly rootDir: string;
  public readonly toolsDir: string;
  public readonly builtinToolsDir: string;
  public readonly customToolsDir: string;
  public readonly memoryDir: string;
  public readonly notesDir: string;
  public readonly experimentsDir: string;
  public readonly discoveriesDir: string;
  public readonly solutionsDir: string;
  public readonly projectsDir: string;
  public readonly outputsDir: string;
  public readonly testsDir: string;
  public readonly logsDir: string;
  public readonly tempDir: string;

  constructor(basePath?: string) {
    this.rootDir = basePath ? path.resolve(basePath) : path.resolve(process.cwd(), 'workspace');
    this.toolsDir = path.join(this.rootDir, 'tools');
    this.builtinToolsDir = path.join(this.toolsDir, 'builtin');
    this.customToolsDir = path.join(this.toolsDir, 'custom');
    this.memoryDir = path.join(this.rootDir, 'memory');
    this.notesDir = path.join(this.memoryDir, 'notes');
    this.experimentsDir = path.join(this.memoryDir, 'experiments');
    this.discoveriesDir = path.join(this.memoryDir, 'discoveries');
    this.solutionsDir = path.join(this.memoryDir, 'solutions');
    this.projectsDir = path.join(this.rootDir, 'projects');
    this.outputsDir = path.join(this.rootDir, 'outputs');
    this.testsDir = path.join(this.rootDir, 'tests');
    this.logsDir = path.join(this.rootDir, 'logs');
    this.tempDir = path.join(this.rootDir, 'temp');

    this.initStructure();
  }

  public initStructure(): void {
    const dirs = [
      this.rootDir,
      this.toolsDir,
      this.builtinToolsDir,
      this.customToolsDir,
      this.memoryDir,
      this.notesDir,
      this.experimentsDir,
      this.discoveriesDir,
      this.solutionsDir,
      this.projectsDir,
      this.outputsDir,
      this.testsDir,
      this.logsDir,
      this.tempDir,
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    const registryPath = path.join(this.toolsDir, 'registry.json');
    if (!fs.existsSync(registryPath)) {
      fs.writeFileSync(registryPath, JSON.stringify({ tools: [] }, null, 2), 'utf-8');
    }
  }

  public resolvePath(relativePath: string): string {
    if (!relativePath) return this.rootDir;
    // Strip leading slashes and Windows drive-like or root slashes
    const sanitized = relativePath.replace(/^[/\\]+/, '');
    const resolved = path.resolve(this.rootDir, sanitized);
    const rel = path.relative(this.rootDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Security Violation: Path '${relativePath}' escapes the workspace root boundary.`);
    }
    return resolved;
  }

  public writeFile(relativePath: string, content: string): string {
    const target = this.resolvePath(relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
    return target;
  }

  public readFile(relativePath: string): string {
    const target = this.resolvePath(relativePath);
    if (!fs.existsSync(target)) {
      throw new Error(`File not found: ${relativePath}`);
    }
    return fs.readFileSync(target, 'utf-8');
  }

  public fileExists(relativePath: string): boolean {
    try {
      const target = this.resolvePath(relativePath);
      return fs.existsSync(target);
    } catch {
      return false;
    }
  }

  public deleteFile(relativePath: string): boolean {
    const target = this.resolvePath(relativePath);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      return true;
    }
    return false;
  }

  public listFiles(relativeSubdir: string = '', recursive: boolean = false): Array<{ name: string; path: string; isDir: boolean; size: number; modified: string }> {
    const target = this.resolvePath(relativeSubdir);
    if (!fs.existsSync(target)) {
      return [];
    }

    const results: Array<{ name: string; path: string; isDir: boolean; size: number; modified: string }> = [];

    const walk = (currentDir: string, baseRelative: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.join(baseRelative, entry.name);
        try {
          const stats = fs.statSync(fullPath);
          results.push({
            name: entry.name,
            path: relPath,
            isDir: entry.isDirectory(),
            size: stats.size,
            modified: stats.mtime.toISOString(),
          });

          if (recursive && entry.isDirectory()) {
            walk(fullPath, relPath);
          }
        } catch {
          // Ignore read errors on transient locks
        }
      }
    };

    walk(target, relativeSubdir);
    return results;
  }

  public searchFiles(query: string, relativeSubdir: string = ''): Array<{ path: string; matches: string[] }> {
    const all = this.listFiles(relativeSubdir, true);
    const results: Array<{ path: string; matches: string[] }> = [];

    const lowerQuery = query.toLowerCase();
    for (const item of all) {
      if (!item.isDir) {
        try {
          const content = this.readFile(item.path);
          const lines = content.split('\n');
          const matchedLines: string[] = [];
          lines.forEach((line, idx) => {
            if (line.toLowerCase().includes(lowerQuery)) {
              matchedLines.push(`L${idx + 1}: ${line.trim()}`);
            }
          });
          if (matchedLines.length > 0) {
            results.push({ path: item.path, matches: matchedLines.slice(0, 10) });
          }
        } catch {
          // Skip binary or unreadable files
        }
      }
    }
    return results;
  }

  public appendLog(sessionId: string, entry: any): void {
    const sanitizedEntry = { ...entry };
    if (sanitizedEntry.arguments) {
      sanitizedEntry.arguments = this.sanitizeCredentials(sanitizedEntry.arguments);
    }
    const logFilePath = path.join(this.logsDir, `session_${sessionId}.jsonl`);
    fs.appendFileSync(logFilePath, JSON.stringify(sanitizedEntry) + '\n', 'utf-8');
  }

  public sanitizeCredentials(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    const clean = Array.isArray(obj) ? [...obj] : { ...obj };
    const sensitiveTokens = ['apikey', 'api_key', 'password', 'secret', 'token', 'auth', 'bearer', 'privkey', 'credential'];
    for (const key of Object.keys(clean)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveTokens.some(k => lowerKey.includes(k))) {
        clean[key] = '[REDACTED]';
      } else if (typeof clean[key] === 'object' && clean[key] !== null) {
        clean[key] = this.sanitizeCredentials(clean[key]);
      }
    }
    return clean;
  }
}

export const defaultWorkspace = new WorkspaceManager();

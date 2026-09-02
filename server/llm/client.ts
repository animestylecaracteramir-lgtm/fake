import fs from 'fs';
import path from 'path';
import { LLMSettings } from '../types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string | Record<string, any>;
    };
  }>;
}

export interface LLMCompletionResult {
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: Record<string, any>;
    };
  }>;
  raw?: any;
  attemptsUsed?: number;
}

export type LLMRetryListener = (info: {
  attempt: number;
  maxAttempts: number;
  provider: string;
  delayMs: number;
  error: string;
}) => void;

export class LLMClient {
  private settings: LLMSettings;
  private retryListeners: Set<LLMRetryListener> = new Set();
  private storageFilePath: string;

  constructor(settings?: Partial<LLMSettings>) {
    const dir = path.resolve(process.cwd(), 'workspace');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    }
    this.storageFilePath = path.join(dir, 'llm_settings.json');

    const loadedDiskSettings = this.loadFromDisk();

    this.settings = {
      provider: 'openai_compatible',
      baseURL: loadedDiskSettings?.baseURL || settings?.baseURL || 'https://api.openai.com/v1',
      apiKey: loadedDiskSettings?.apiKey || settings?.apiKey || process.env.OPENAI_API_KEY || '',
      model: loadedDiskSettings?.model || settings?.model || 'gpt-4o',
      maxTokens: loadedDiskSettings?.maxTokens || settings?.maxTokens || 4096,
      temperature: loadedDiskSettings?.temperature ?? settings?.temperature ?? 0.2,
      maxRetries: loadedDiskSettings?.maxRetries ?? settings?.maxRetries ?? 5,
    };
  }

  private loadFromDisk(): Partial<LLMSettings> | null {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Failed to load LLM settings from disk:', err);
    }
    return null;
  }

  private saveToDisk(): void {
    try {
      const tempPath = `${this.storageFilePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.settings, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.storageFilePath);
    } catch (err) {
      console.warn('Failed to persist LLM settings to disk:', err);
    }
  }

  public onRetry(listener: LLMRetryListener): () => void {
    this.retryListeners.add(listener);
    return () => this.retryListeners.delete(listener);
  }

  private notifyRetry(info: {
    attempt: number;
    maxAttempts: number;
    provider: string;
    delayMs: number;
    error: string;
  }): void {
    this.retryListeners.forEach(fn => {
      try { fn(info); } catch {}
    });
  }

  public updateSettings(newSettings: Partial<LLMSettings>): void {
    // Retain existing apiKey if newSettings sends masked placeholder or empty string when existing exists
    let effectiveApiKey = this.settings.apiKey;
    if (newSettings.apiKey !== undefined && newSettings.apiKey !== '••••••••') {
      effectiveApiKey = newSettings.apiKey;
    }

    this.settings = {
      ...this.settings,
      ...newSettings,
      apiKey: effectiveApiKey,
      provider: 'openai_compatible',
      maxRetries: newSettings.maxRetries ?? this.settings.maxRetries ?? 5,
    };

    this.saveToDisk();
  }

  public getSettings(): LLMSettings {
    return {
      ...this.settings,
      provider: 'openai_compatible',
      maxRetries: this.settings.maxRetries ?? 5,
    };
  }

  /**
   * Helper to execute an async API operation with up to maxRetries attempts (default: 5)
   */
  private async executeWithRetry<T>(
    operationName: string,
    operation: (attempt: number) => Promise<T>,
    maxAttempts: number = 5
  ): Promise<{ result: T; attemptsUsed: number }> {
    let lastError: any = null;
    const baseDelayMs = 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await operation(attempt);
        return { result, attemptsUsed: attempt };
      } catch (err: any) {
        lastError = err;
        const isLastAttempt = attempt >= maxAttempts;
        if (isLastAttempt) {
          console.error(`[API Max Retries Reached] ${operationName} failed after ${maxAttempts} attempts:`, err?.message || err);
          break;
        }

        // Exponential backoff + small jitter: 1s, 2s, 4s, 8s...
        const jitter = Math.floor(Math.random() * 400);
        const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt - 1) + jitter, 10000);

        console.warn(`[API Retry ${attempt}/${maxAttempts}] ${operationName} error: ${err?.message || err}. Retrying in ${delayMs}ms...`);

        this.notifyRetry({
          attempt,
          maxAttempts,
          provider: operationName,
          delayMs,
          error: err?.message || 'Unknown API request error',
        });

        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw lastError || new Error(`${operationName} failed after ${maxAttempts} attempts.`);
  }

  public async chatCompletion(
    messages: ChatMessage[],
    tools?: any[],
  ): Promise<LLMCompletionResult> {
    const maxRetries = this.settings.maxRetries ?? 5;
    return this.callOpenAICompatibleWithRetry(messages, tools, maxRetries);
  }

  private async callOpenAICompatibleWithRetry(
    messages: ChatMessage[],
    tools?: any[],
    maxRetries: number = 5
  ): Promise<LLMCompletionResult> {
    const { result, attemptsUsed } = await this.executeWithRetry(
      'OpenAI-Compatible API',
      () => this.callOpenAICompatibleSingle(messages, tools),
      maxRetries
    );
    return { ...result, attemptsUsed };
  }

  private async callOpenAICompatibleSingle(
    messages: ChatMessage[],
    tools?: any[],
  ): Promise<LLMCompletionResult> {
    const url = `${this.settings.baseURL.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.settings.apiKey) {
      headers['Authorization'] = `Bearer ${this.settings.apiKey}`;
    }

    // Format messages strictly for OpenAI specification
    const formattedMessages = messages.map(msg => {
      const formatted: any = {
        role: msg.role,
      };

      if (msg.role === 'assistant') {
        formatted.content = msg.content !== undefined ? msg.content : null;
        if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          formatted.tool_calls = msg.tool_calls.map(tc => {
            let argsStr = '{}';
            if (typeof tc.function?.arguments === 'string') {
              argsStr = tc.function.arguments;
            } else if (tc.function?.arguments && typeof tc.function.arguments === 'object') {
              argsStr = JSON.stringify(tc.function.arguments);
            }
            return {
              id: tc.id || `call_${Date.now()}`,
              type: 'function',
              function: {
                name: tc.function?.name || 'tool',
                arguments: argsStr,
              },
            };
          });
        }
      } else if (msg.role === 'tool') {
        formatted.tool_call_id = msg.tool_call_id || (msg as any).id || 'call_0';
        formatted.content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? {});
        if (msg.name) {
          formatted.name = msg.name;
        }
      } else {
        // system or user
        formatted.content = typeof msg.content === 'string' ? msg.content : (msg.content ? JSON.stringify(msg.content) : '');
      }

      return formatted;
    });

    const payload: any = {
      model: this.settings.model || 'gpt-4o',
      messages: formattedMessages,
      max_tokens: this.settings.maxTokens,
      temperature: this.settings.temperature,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`OpenAI API error [HTTP ${resp.status}]: ${errText}`);
      }

      const data = await resp.json();
      const choice = data.choices?.[0]?.message;

      if (!choice) {
        throw new Error('No choices returned from LLM completion.');
      }

      let parsedToolCalls: any[] | undefined = undefined;
      if (choice.tool_calls && Array.isArray(choice.tool_calls)) {
        parsedToolCalls = choice.tool_calls.map((tc: any) => {
          let argsObj = {};
          try {
            argsObj = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
          } catch {
            argsObj = {};
          }
          return {
            id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: argsObj,
            },
          };
        });
      }

      return {
        content: choice.content || null,
        tool_calls: parsedToolCalls,
        raw: data,
      };
    } catch (err: any) {
      clearTimeout(timer);
      throw err;
    }
  }
}

export const defaultLLMClient = new LLMClient();

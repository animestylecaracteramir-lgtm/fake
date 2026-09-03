import crypto from 'crypto';
import {
  FetchErrorType,
  SingleFetchResult,
  MultiFetchResult,
  FetchOptions,
  UrlFailureRecord,
  HostHealthRecord,
  FetchExecutionRecord,
} from '../types';

/**
 * Normalizes any URL string into a canonical representation for deduplication and fetching.
 */
export function normalizeUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('Invalid URL: empty or non-string input');
  }

  let cleaned = rawUrl.trim();

  // If URL starts with protocol-relative "//"
  if (cleaned.startsWith('//')) {
    cleaned = 'https:' + cleaned;
  } else if (!/^https?:\/\//i.test(cleaned)) {
    // If it has another scheme like ftp://, mailto:, etc.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleaned) || /^[a-zA-Z]+:/.test(cleaned)) {
      const scheme = cleaned.split(':')[0].toLowerCase();
      if (scheme !== 'http' && scheme !== 'https') {
        throw new Error(`Unsupported protocol: ${scheme}:`);
      }
    }
    // If protocol is missing completely, default to https
    cleaned = 'https://' + cleaned;
  }

  try {
    const parsed = new URL(cleaned);

    // Only http and https protocols are supported
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    // Remove default ports
    if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
      parsed.port = '';
    }

    // Strip hash fragments
    parsed.hash = '';

    // Remove trailing slash on root path (https://example.com/ -> https://example.com)
    let href = parsed.toString();
    if (parsed.pathname === '/' && !parsed.search && href.endsWith('/')) {
      href = href.slice(0, -1);
    }

    return href;
  } catch (err: any) {
    if (err.message?.includes('Unsupported protocol')) {
      throw err;
    }
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
}

/**
 * Deduplicates an array of URLs using normalized forms while preserving order.
 */
export function deduplicateUrls(urls: string[]): {
  uniqueNormalizedUrls: string[];
  originalToNormalizedMap: Map<string, string>;
  normalizedToFirstOriginalMap: Map<string, string>;
} {
  const uniqueNormalizedUrls: string[] = [];
  const originalToNormalizedMap = new Map<string, string>();
  const normalizedToFirstOriginalMap = new Map<string, string>();
  const seen = new Set<string>();

  for (const orig of urls) {
    try {
      const normalized = normalizeUrl(orig);
      originalToNormalizedMap.set(orig, normalized);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        uniqueNormalizedUrls.push(normalized);
        normalizedToFirstOriginalMap.set(normalized, orig);
      }
    } catch {
      // Keep invalid raw strings to preserve error handling per-URL
      originalToNormalizedMap.set(orig, orig);
      if (!seen.has(orig)) {
        seen.add(orig);
        uniqueNormalizedUrls.push(orig);
        normalizedToFirstOriginalMap.set(orig, orig);
      }
    }
  }

  return { uniqueNormalizedUrls, originalToNormalizedMap, normalizedToFirstOriginalMap };
}

/**
 * Classifies any fetch exception or HTTP response status into structured error categories.
 */
export function classifyFetchError(
  err: any,
  statusCode?: number,
  wasTimeout?: boolean,
  wasExternalAbort?: boolean
): { errorType: FetchErrorType; retryable: boolean; message: string } {
  // 1. HTTP Status Code based classification
  if (typeof statusCode === 'number' && statusCode > 0) {
    if (statusCode === 400) {
      return { errorType: 'HTTP_400', retryable: false, message: 'HTTP 400: Bad Request' };
    }
    if (statusCode === 401) {
      return { errorType: 'HTTP_401', retryable: false, message: 'HTTP 401: Unauthorized' };
    }
    if (statusCode === 403) {
      return { errorType: 'HTTP_403', retryable: false, message: 'HTTP 403: Forbidden' };
    }
    if (statusCode === 404) {
      return { errorType: 'HTTP_404', retryable: false, message: 'HTTP 404: Not Found' };
    }
    if (statusCode === 408) {
      return { errorType: 'HTTP_408', retryable: true, message: 'HTTP 408: Request Timeout' };
    }
    if (statusCode === 429) {
      return { errorType: 'HTTP_429', retryable: true, message: 'HTTP 429: Too Many Requests' };
    }
    if (statusCode >= 500 && statusCode <= 599) {
      return { errorType: 'HTTP_5XX', retryable: true, message: `HTTP ${statusCode}: Server Error` };
    }
    if (statusCode >= 400 && statusCode < 500) {
      return { errorType: 'HTTP_400', retryable: false, message: `HTTP ${statusCode}: Client Error` };
    }
  }

  // 2. Timeout vs External Abort Check
  if (wasTimeout) {
    return {
      errorType: 'TIMEOUT',
      retryable: true,
      message: err?.message || 'Request timed out waiting for server response',
    };
  }

  if (wasExternalAbort) {
    return {
      errorType: 'ABORTED',
      retryable: false,
      message: err?.message || 'Operation aborted by caller or task cancellation',
    };
  }

  const errName = err?.name || '';
  const errMsg = err?.message || String(err || '');
  const lowerMsg = errMsg.toLowerCase();
  const errCode = (err?.code || err?.cause?.code || '').toUpperCase();
  const causeMsg = (err?.cause?.message || '').toLowerCase();

  // Abort check
  if (errName === 'AbortError' || lowerMsg.includes('aborted') || lowerMsg.includes('this operation was aborted')) {
    if (wasTimeout || lowerMsg.includes('timeout')) {
      return { errorType: 'TIMEOUT', retryable: true, message: 'Fetch timed out' };
    }
    return { errorType: 'ABORTED', retryable: false, message: 'Operation aborted' };
  }

  // Unsupported Protocol / Invalid URL
  if (lowerMsg.includes('unsupported protocol')) {
    return { errorType: 'UNSUPPORTED_PROTOCOL', retryable: false, message: errMsg };
  }
  if (lowerMsg.includes('invalid url') || lowerMsg.includes('failed to parse url') || lowerMsg.includes('typeerror: invalid url')) {
    return { errorType: 'INVALID_URL', retryable: false, message: errMsg };
  }

  // DNS Resolution errors
  if (
    errCode === 'ENOTFOUND' ||
    errCode === 'EAI_AGAIN' ||
    lowerMsg.includes('getaddrinfo') ||
    causeMsg.includes('getaddrinfo') ||
    lowerMsg.includes('enotfound')
  ) {
    return { errorType: 'DNS_ERROR', retryable: true, message: `DNS resolution failed: ${errMsg}` };
  }

  // Connection Refused
  if (errCode === 'ECONNREFUSED' || lowerMsg.includes('econnrefused') || causeMsg.includes('econnrefused')) {
    return { errorType: 'CONNECTION_REFUSED', retryable: true, message: `Connection refused: ${errMsg}` };
  }

  // Connection Reset / Broken Pipe
  if (
    errCode === 'ECONNRESET' ||
    errCode === 'EPIPE' ||
    lowerMsg.includes('econnreset') ||
    causeMsg.includes('econnreset') ||
    lowerMsg.includes('connection reset')
  ) {
    return { errorType: 'CONNECTION_RESET', retryable: true, message: `Connection reset by peer: ${errMsg}` };
  }

  // TLS / Certificate errors
  if (
    errCode.startsWith('CERT_') ||
    errCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    lowerMsg.includes('certificate') ||
    lowerMsg.includes('ssl') ||
    lowerMsg.includes('tls')
  ) {
    return { errorType: 'TLS_ERROR', retryable: false, message: `TLS/SSL handshake error: ${errMsg}` };
  }

  // Timeouts (socket / connect)
  if (
    errCode === 'ETIMEDOUT' ||
    errCode === 'UND_ERR_CONNECT_TIMEOUT' ||
    lowerMsg.includes('timedout') ||
    lowerMsg.includes('timeout')
  ) {
    return { errorType: 'TIMEOUT', retryable: true, message: `Connection timeout: ${errMsg}` };
  }

  // Network unreachable
  if (
    errCode === 'ENETUNREACH' ||
    errCode === 'EHOSTUNREACH' ||
    lowerMsg.includes('network unreachable') ||
    lowerMsg.includes('host unreachable')
  ) {
    return { errorType: 'NETWORK_UNAVAILABLE', retryable: true, message: `Network unreachable: ${errMsg}` };
  }

  // Generic Node "fetch failed"
  if (lowerMsg.includes('fetch failed')) {
    // Check deeper cause
    if (causeMsg.includes('reset') || causeMsg.includes('econnreset')) {
      return { errorType: 'CONNECTION_RESET', retryable: true, message: 'fetch failed (Connection reset)' };
    }
    if (causeMsg.includes('refused') || causeMsg.includes('econnrefused')) {
      return { errorType: 'CONNECTION_REFUSED', retryable: true, message: 'fetch failed (Connection refused)' };
    }
    if (causeMsg.includes('getaddrinfo') || causeMsg.includes('enotfound')) {
      return { errorType: 'DNS_ERROR', retryable: true, message: 'fetch failed (DNS lookup error)' };
    }
    if (causeMsg.includes('timeout') || causeMsg.includes('etimedout')) {
      return { errorType: 'TIMEOUT', retryable: true, message: 'fetch failed (Timeout)' };
    }
    return { errorType: 'NETWORK_UNAVAILABLE', retryable: true, message: `fetch failed: ${err?.cause?.message || errMsg}` };
  }

  return { errorType: 'UNKNOWN', retryable: false, message: errMsg || 'Unknown network error' };
}

/**
 * Checks if a URL points to a GitHub file blob and derives the canonical raw content URL.
 */
export function getGitHubRawFallbackUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return null;

    // Pattern: /:owner/:repo/blob/:branch/:filepath...
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 4 && parts[2] === 'blob') {
      const owner = parts[0];
      const repo = parts[1];
      const branch = parts[3];
      const rest = parts.slice(4).join('/');
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rest}`;
    }
    return null;
  } catch {
    return null;
  }
}

interface CacheEntry {
  result: SingleFetchResult;
  timestamp: number;
  ttlMs: number;
}

export class FetchManager {
  private cache: Map<string, CacheEntry> = new Map();
  private failureMemory: Map<string, UrlFailureRecord> = new Map();
  private hostHealth: Map<string, HostHealthRecord> = new Map();
  private activeFetches: Map<string, Promise<SingleFetchResult>> = new Map();

  public readonly defaultTimeoutMs: number = 8000;
  public readonly defaultMaxRetries: number = 2; // 3 attempts total (1 initial + 2 retries)
  public readonly defaultBaseDelayMs: number = 250;
  public readonly defaultMaxConcurrent: number = 3;
  public readonly cacheTtlMs: number = 300000; // 5 minutes

  /**
   * Fetches a single URL with strict error classification, timeout protection,
   * exponential backoff retries on retryable errors, and deduplication.
   */
  public async fetchUrl(rawUrl: string, options?: FetchOptions): Promise<SingleFetchResult> {
    const startTime = Date.now();
    let normalizedUrl: string;

    try {
      normalizedUrl = normalizeUrl(rawUrl);
    } catch (err: any) {
      const isProto = err.message?.includes('Unsupported protocol');
      const errorType: FetchErrorType = isProto ? 'UNSUPPORTED_PROTOCOL' : 'INVALID_URL';
      return {
        ok: false,
        url: rawUrl,
        errorType,
        message: err.message,
        retryable: false,
        attempts: 0,
        elapsedMs: Date.now() - startTime,
      };
    }

    // Check Task Cache first
    if (!options?.bypassCache) {
      const cached = this.getCached(normalizedUrl);
      if (cached) {
        return {
          ...cached,
          cached: true,
          elapsedMs: Date.now() - startTime,
        };
      }
    }

    // In-flight deduplication: If identical URL is already actively fetching, share that promise
    if (this.activeFetches.has(normalizedUrl)) {
      try {
        const shared = await this.activeFetches.get(normalizedUrl)!;
        return { ...shared, elapsedMs: Date.now() - startTime };
      } catch {
        // Fallthrough to direct fetch if active promise threw
      }
    }

    const fetchPromise = this.executeFetchWithRetries(normalizedUrl, rawUrl, options);
    this.activeFetches.set(normalizedUrl, fetchPromise);

    try {
      const result = await fetchPromise;
      if (result.ok && !options?.bypassCache) {
        this.setCached(normalizedUrl, result);
      }
      return result;
    } finally {
      this.activeFetches.delete(normalizedUrl);
    }
  }

  /**
   * Fetches multiple URLs with bounded concurrency, deduplication, isolated retries,
   * and partial success reporting.
   */
  public async fetchUrls(rawUrls: string[], options?: FetchOptions): Promise<MultiFetchResult> {
    const startTime = Date.now();
    if (!rawUrls || rawUrls.length === 0) {
      return {
        status: 'SUCCESS',
        requested: 0,
        succeeded: 0,
        failed: 0,
        results: [],
        successfulResults: [],
        failedResults: [],
        elapsedMs: 0,
      };
    }

    // 1. Normalize and deduplicate URLs
    const { uniqueNormalizedUrls, originalToNormalizedMap, normalizedToFirstOriginalMap } = deduplicateUrls(rawUrls);
    const maxConcurrency = Math.max(1, options?.maxConcurrent ?? this.defaultMaxConcurrent);

    // 2. Execute with bounded concurrency pool
    const resultMap = new Map<string, SingleFetchResult>();
    const queue = [...uniqueNormalizedUrls];

    const worker = async () => {
      while (queue.length > 0) {
        // Check external cancellation
        if (options?.signal?.aborted) {
          break;
        }

        const normUrl = queue.shift();
        if (!normUrl) break;

        const origUrl = normalizedToFirstOriginalMap.get(normUrl) || normUrl;
        const res = await this.fetchUrl(origUrl, options);
        resultMap.set(normUrl, res);
      }
    };

    const workerCount = Math.min(maxConcurrency, uniqueNormalizedUrls.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);

    // 3. Map back to original requests
    const results: SingleFetchResult[] = rawUrls.map(orig => {
      const norm = originalToNormalizedMap.get(orig) || orig;
      const res = resultMap.get(norm);
      if (res) {
        return { ...res, url: orig };
      }
      // If aborted before start
      return {
        ok: false,
        url: orig,
        errorType: 'ABORTED' as FetchErrorType,
        message: 'Fetch cancelled by caller signal',
        retryable: false,
        attempts: 0,
        elapsedMs: Date.now() - startTime,
      };
    });

    const successfulResults = results.filter((r): r is Extract<SingleFetchResult, { ok: true }> => r.ok);
    const failedResults = results.filter((r): r is Extract<SingleFetchResult, { ok: false }> => !r.ok);

    let status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILURE' = 'FAILURE';
    if (successfulResults.length === rawUrls.length) {
      status = 'SUCCESS';
    } else if (successfulResults.length > 0) {
      status = 'PARTIAL_SUCCESS';
    } else {
      status = 'FAILURE';
    }

    return {
      status,
      requested: rawUrls.length,
      succeeded: successfulResults.length,
      failed: failedResults.length,
      results,
      successfulResults,
      failedResults,
      elapsedMs: Date.now() - startTime,
    };
  }

  /**
   * Internal worker executing per-URL attempts with dedicated AbortControllers,
   * exponential backoff, host health tracking, and optional fallbacks.
   */
  private async executeFetchWithRetries(
    normalizedUrl: string,
    originalUrl: string,
    options?: FetchOptions
  ): Promise<SingleFetchResult> {
    const startTime = Date.now();
    const maxRetries = options?.maxRetries ?? this.defaultMaxRetries;
    const maxAttempts = maxRetries + 1;
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const baseDelayMs = options?.baseDelayMs ?? this.defaultBaseDelayMs;
    const silent = options?.silent ?? false;
    const executionId = `fetch_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    let parsedHost = '';
    try {
      parsedHost = new URL(normalizedUrl).hostname;
    } catch {
      parsedHost = 'unknown';
    }

    // Check host health & cooldown
    this.checkAndCooldownHost(parsedHost);

    let lastResult: SingleFetchResult | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Check external signal before each attempt
      if (options?.signal?.aborted) {
        return {
          ok: false,
          url: originalUrl,
          finalUrl: normalizedUrl,
          errorType: 'ABORTED',
          message: 'Operation aborted by caller',
          retryable: false,
          attempts: attempt - 1,
          elapsedMs: Date.now() - startTime,
        };
      }

      const attemptStart = Date.now();
      const singleAttempt = await this.executeSingleAttempt(
        normalizedUrl,
        originalUrl,
        timeoutMs,
        executionId,
        attempt,
        maxAttempts,
        options
      );

      lastResult = singleAttempt;

      if (singleAttempt.ok) {
        this.recordHostSuccess(parsedHost);
        this.failureMemory.delete(normalizedUrl);
        return singleAttempt;
      }

      // Record failure memory
      this.recordHostFailure(parsedHost, singleAttempt.errorType);
      this.failureMemory.set(normalizedUrl, {
        url: normalizedUrl,
        host: parsedHost,
        errorType: singleAttempt.errorType,
        attempts: attempt,
        lastFailure: Date.now(),
        message: singleAttempt.message,
      });

      // If error is deterministic / non-retryable, abort loop immediately
      if (!singleAttempt.retryable) {
        if (!silent) {
          console.info(`[Fetch Non-Retryable] [${executionId}] ${originalUrl} failed on attempt ${attempt}: ${singleAttempt.errorType} (${singleAttempt.message})`);
        }
        break;
      }

      // If this was the last attempt, do not wait
      if (attempt >= maxAttempts) {
        if (!silent) {
          console.info(`[Fetch Max Retries] [${executionId}] ${originalUrl} reached max attempts (${maxAttempts}): ${singleAttempt.errorType}`);
        }
        break;
      }

      // Retryable error: backoff delay with jitter
      const jitter = Math.floor(Math.random() * (baseDelayMs > 100 ? 100 : 10));
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1) + jitter, 3000);

      if (!silent) {
        console.info(`[Fetch Retry ${attempt}/${maxRetries}] [${executionId}] ${originalUrl} (${singleAttempt.errorType}) - scheduled retry in ${delay}ms`);
      }

      await new Promise(res => setTimeout(res, delay));
    }

    // Optional safe GitHub fallback: if GitHub blob HTML page failed, try canonical raw URL
    if (options?.fallbackToGitHubRaw !== false) {
      const rawFallback = getGitHubRawFallbackUrl(normalizedUrl);
      if (rawFallback && rawFallback !== normalizedUrl) {
        try {
          if (!silent) {
            console.info(`[Fetch Fallback] [${executionId}] Attempting canonical GitHub raw URL: ${rawFallback}`);
          }
          const fallbackRes = await this.executeSingleAttempt(
            rawFallback,
            originalUrl,
            timeoutMs,
            `${executionId}_fallback`,
            1,
            1,
            options
          );
          if (fallbackRes.ok) {
            this.recordHostSuccess(parsedHost);
            return fallbackRes;
          }
        } catch {
          // Keep original failure
        }
      }
    }

    return (
      lastResult || {
        ok: false,
        url: originalUrl,
        finalUrl: normalizedUrl,
        errorType: 'UNKNOWN',
        message: 'All fetch attempts exhausted',
        retryable: false,
        attempts: maxAttempts,
        elapsedMs: Date.now() - startTime,
      }
    );
  }

  /**
   * Executes a single HTTP request with its own dedicated AbortController,
   * strict timeout tracking, and header negotiation.
   */
  private async executeSingleAttempt(
    targetUrl: string,
    originalUrl: string,
    timeoutMs: number,
    executionId: string,
    attempt: number,
    maxAttempts: number,
    options?: FetchOptions
  ): Promise<SingleFetchResult> {
    const attemptStart = Date.now();
    let wasTimeout = false;
    let wasExternalAbort = false;

    // Safety: Dedicated AbortController per individual attempt
    const controller = new AbortController();

    // Link external cancellation signal
    const externalSignal = options?.signal;
    let onExternalAbort: (() => void) | null = null;
    if (externalSignal) {
      if (externalSignal.aborted) {
        return {
          ok: false,
          url: originalUrl,
          finalUrl: targetUrl,
          errorType: 'ABORTED',
          message: 'Operation aborted by caller',
          retryable: false,
          attempts: attempt,
          elapsedMs: Date.now() - attemptStart,
        };
      }
      onExternalAbort = () => {
        wasExternalAbort = true;
        controller.abort('external_abort');
      };
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    // Set per-attempt timeout timer
    const timer = setTimeout(() => {
      wasTimeout = true;
      controller.abort('timeout');
    }, timeoutMs);

    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(options?.headers || {}),
    };

    try {
      const resp = await fetch(targetUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timer);
      if (externalSignal && onExternalAbort) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }

      const elapsedMs = Date.now() - attemptStart;
      const status = resp.status;
      const finalUrl = resp.url || targetUrl;

      if (!resp.ok) {
        const classified = classifyFetchError(new Error(`HTTP ${status}`), status, false, false);
        return {
          ok: false,
          url: originalUrl,
          finalUrl,
          status,
          errorType: classified.errorType,
          message: classified.message,
          retryable: classified.retryable,
          attempts: attempt,
          elapsedMs,
        };
      }

      const text = await resp.text();
      const maxLength = options?.maxContentLength || 25000;
      const truncated = text.slice(0, maxLength);

      const respHeaders: Record<string, string> = {};
      try {
        resp.headers.forEach((v, k) => {
          respHeaders[k] = v;
        });
      } catch {}

      return {
        ok: true,
        url: originalUrl,
        finalUrl,
        status,
        headers: respHeaders,
        content: truncated,
        length: text.length,
        elapsedMs,
        attempts: attempt,
      };
    } catch (err: any) {
      clearTimeout(timer);
      if (externalSignal && onExternalAbort) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }

      const elapsedMs = Date.now() - attemptStart;
      const classified = classifyFetchError(err, undefined, wasTimeout, wasExternalAbort);

      return {
        ok: false,
        url: originalUrl,
        finalUrl: targetUrl,
        errorType: classified.errorType,
        message: classified.message,
        retryable: classified.retryable,
        attempts: attempt,
        elapsedMs,
      };
    }
  }

  // --- Host Health & Memory Helpers ---

  private checkAndCooldownHost(host: string): void {
    const record = this.hostHealth.get(host);
    if (!record) return;

    if (record.status === 'unreachable') {
      const cooldownMs = 15000;
      if (Date.now() - record.lastFailure > cooldownMs) {
        record.status = 'degraded';
      }
    }
  }

  private recordHostSuccess(host: string): void {
    const existing = this.hostHealth.get(host) || {
      host,
      status: 'healthy',
      failureCount: 0,
      lastFailure: 0,
      lastSuccess: Date.now(),
    };
    existing.status = 'healthy';
    existing.failureCount = 0;
    existing.lastSuccess = Date.now();
    this.hostHealth.set(host, existing);
  }

  private recordHostFailure(host: string, errorType: FetchErrorType): void {
    const existing = this.hostHealth.get(host) || {
      host,
      status: 'healthy',
      failureCount: 0,
      lastFailure: 0,
      lastSuccess: 0,
    };
    existing.failureCount++;
    existing.lastFailure = Date.now();
    if (existing.failureCount >= 3) {
      existing.status = 'unreachable';
    } else {
      existing.status = 'degraded';
    }
    this.hostHealth.set(host, existing);
  }

  public getHostHealth(host: string): HostHealthRecord | undefined {
    return this.hostHealth.get(host);
  }

  public getFailureMemory(): Map<string, UrlFailureRecord> {
    return new Map(this.failureMemory);
  }

  // --- In-Memory Task Cache Helpers ---

  private getCached(normalizedUrl: string): SingleFetchResult | null {
    const entry = this.cache.get(normalizedUrl);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttlMs) {
      this.cache.delete(normalizedUrl);
      return null;
    }
    return entry.result;
  }

  private setCached(normalizedUrl: string, result: SingleFetchResult, ttlMs: number = this.cacheTtlMs): void {
    this.cache.set(normalizedUrl, {
      result,
      timestamp: Date.now(),
      ttlMs,
    });
  }

  public clearCache(): void {
    this.cache.clear();
    this.failureMemory.clear();
  }
}

export const defaultFetchManager = new FetchManager();

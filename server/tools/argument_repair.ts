import crypto from 'crypto';
import { ToolMetadata, ToolParameterSchema, ArgumentRepairResult, ToolResult, ToolErrorType } from '../types';

export interface ValidationIssue {
  field: string;
  type: 'missing' | 'invalid_type' | 'invalid_value' | 'unknown_field';
  message: string;
  expectedType?: string;
  actualType?: string;
}

export interface ArgumentValidationResult {
  valid: boolean;
  errorType: ToolErrorType | null;
  message: string | null;
  missingFields: string[];
  invalidFields: string[];
  unknownFields: string[];
  issues: ValidationIssue[];
  canonicalArgs: Record<string, any>;
  fingerprint: string;
  repairable: boolean;
  authoritativeSchema: any;
}

/**
 * Deterministically canonicalizes arguments:
 * - Ensures object representation
 * - Sorts keys recursively
 * - Trims string values while preserving multiline formatting
 * - Normalizes empty values
 */
export function canonicalizeArguments(args: any): Record<string, any> {
  if (args === null || args === undefined) {
    return {};
  }

  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === 'object') {
        return canonicalizeArguments(parsed);
      }
    } catch {
      return { raw: args.trim() };
    }
  }

  if (typeof args !== 'object' || Array.isArray(args)) {
    return { value: args };
  }

  const sortedObj: Record<string, any> = {};
  const sortedKeys = Object.keys(args).sort();

  for (const key of sortedKeys) {
    const val = args[key];
    if (val === undefined) {
      continue;
    }
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      sortedObj[key] = canonicalizeArguments(val);
    } else if (Array.isArray(val)) {
      sortedObj[key] = val.map(item => {
        if (item !== null && typeof item === 'object') {
          return canonicalizeArguments(item);
        }
        if (typeof item === 'string') {
          return item.trim();
        }
        return item;
      });
    } else if (typeof val === 'string') {
      // Trim bounding whitespace, preserve internal content
      sortedObj[key] = val.trim();
    } else {
      sortedObj[key] = val;
    }
  }

  return sortedObj;
}

/**
 * Computes deterministic SHA-256 fingerprint for a tool + canonical arguments
 */
export function computeArgumentFingerprint(toolName: string, args: any): string {
  const canonical = canonicalizeArguments(args);
  const normalizedStr = `${toolName.toLowerCase()}::${JSON.stringify(canonical)}`;
  return crypto.createHash('sha256').update(normalizedStr).digest('hex');
}

/**
 * Validates arguments strictly against the tool's authoritative schema.
 */
export function validateToolArguments(
  tool: ToolMetadata,
  rawArgs: any,
  options: { allowUnknown?: boolean } = { allowUnknown: false }
): ArgumentValidationResult {
  const canonical = canonicalizeArguments(rawArgs);
  const fingerprint = computeArgumentFingerprint(tool.name, canonical);
  const parameters = tool.parameters || { type: 'object', properties: {}, required: [] };
  const properties = parameters.properties || {};
  const required = parameters.required || [];

  const issues: ValidationIssue[] = [];
  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  const unknownFields: string[] = [];

  // Check 1: Must be an object
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    return {
      valid: false,
      errorType: 'INVALID_ARGUMENTS',
      message: `Arguments for tool '${tool.name}' must be a JSON object.`,
      missingFields: required,
      invalidFields: [],
      unknownFields: [],
      issues: [{ field: 'root', type: 'invalid_type', message: 'Arguments must be an object' }],
      canonicalArgs: canonical,
      fingerprint,
      repairable: true,
      authoritativeSchema: parameters,
    };
  }

  // Check 2: Required parameters
  for (const req of required) {
    const val = canonical[req];
    if (val === undefined || val === null || (typeof val === 'string' && val === '')) {
      missingFields.push(req);
      issues.push({
        field: req,
        type: 'missing',
        message: `Missing required parameter: '${req}'`,
        expectedType: properties[req]?.type || 'any',
      });
    }
  }

  // Check 3: Property types & Enums
  for (const [key, val] of Object.entries(canonical)) {
    const propSchema = properties[key];
    if (!propSchema) {
      if (!options.allowUnknown && Object.keys(properties).length > 0) {
        unknownFields.push(key);
        issues.push({
          field: key,
          type: 'unknown_field',
          message: `Unknown parameter '${key}' for tool '${tool.name}'`,
        });
      }
      continue;
    }

    if (val === undefined || val === null) {
      continue;
    }

    const expectedType = propSchema.type;
    let actualType: string = typeof val;
    if (Array.isArray(val)) actualType = 'array';

    let typeMatch = true;
    if (!expectedType || expectedType === 'any') {
      typeMatch = true;
    } else if (Array.isArray(expectedType)) {
      typeMatch = expectedType.includes(actualType);
    } else if (expectedType === 'string') {
      typeMatch = typeof val === 'string';
    } else if (expectedType === 'number') {
      typeMatch = typeof val === 'number' && !isNaN(val);
    } else if (expectedType === 'boolean') {
      typeMatch = typeof val === 'boolean';
    } else if (expectedType === 'array') {
      typeMatch = Array.isArray(val);
    } else if (expectedType === 'object') {
      typeMatch = typeof val === 'object' && !Array.isArray(val);
    }

    if (!typeMatch) {
      invalidFields.push(key);
      issues.push({
        field: key,
        type: 'invalid_type',
        message: `Parameter '${key}' must be of type '${expectedType}', received '${actualType}'`,
        expectedType,
        actualType,
      });
    }

    // Enum check
    if (propSchema.enum && propSchema.enum.length > 0 && !propSchema.enum.includes(val)) {
      invalidFields.push(key);
      issues.push({
        field: key,
        type: 'invalid_value',
        message: `Parameter '${key}' value '${val}' is not in allowed enum: [${propSchema.enum.join(', ')}]`,
      });
    }
  }

  const hasErrors = issues.length > 0;
  let primaryErrorType: ToolErrorType | null = null;
  let primaryMessage: string | null = null;

  if (hasErrors) {
    if (missingFields.length > 0) {
      primaryErrorType = 'INVALID_ARGUMENTS'; // Standardized category as required
      primaryMessage = `Validation failed for tool '${tool.name}': Missing required parameter: '${missingFields[0]}'`;
    } else if (invalidFields.length > 0) {
      const invIssue = issues.find(i => i.type === 'invalid_type');
      if (invIssue) {
        primaryErrorType = 'INVALID_ARGUMENT_TYPE';
        primaryMessage = `Validation failed for tool '${tool.name}': ${invIssue.message}`;
      } else {
        primaryErrorType = 'INVALID_ARGUMENT_VALUE';
        primaryMessage = `Validation failed for tool '${tool.name}': Parameter validation failed for '${invalidFields[0]}'`;
      }
    } else if (unknownFields.length > 0) {
      primaryErrorType = 'INVALID_ARGUMENTS';
      primaryMessage = `Validation failed for tool '${tool.name}': Unknown parameter '${unknownFields[0]}'`;
    } else {
      primaryErrorType = 'INVALID_ARGUMENTS';
      primaryMessage = `Validation failed for tool '${tool.name}'`;
    }
  }

  return {
    valid: !hasErrors,
    errorType: primaryErrorType,
    message: primaryMessage,
    missingFields,
    invalidFields,
    unknownFields,
    issues,
    canonicalArgs: canonical,
    fingerprint,
    repairable: hasErrors,
    authoritativeSchema: parameters,
  };
}

/**
 * Task-critical parameter blacklist that must NEVER be populated with random dummy values.
 */
export const CRITICAL_PARAMETERS = new Set([
  'filepath',
  'serverAddress',
  'uuid',
  'password',
  'certificate',
  'privateKey',
  'realityPrivateKey',
  'realityPublicKey',
]);

/**
 * Constructs an authoritative argument repair instruction
 */
export function buildArgumentRepairInstruction(
  toolOrConfig: ToolMetadata | {
    toolName: string;
    schema?: any;
    missingFields?: string[];
    invalidFields?: string[];
    unknownFields?: string[];
    previousArgs?: any;
    errorMessage?: string;
  },
  validationArg?: ArgumentValidationResult,
  originalArgsArg?: any
): ArgumentRepairResult {
  let toolName = '';
  let schemaProps: Record<string, any> = {};
  let missingFields: string[] = [];
  let invalidFields: string[] = [];
  let unknownFields: string[] = [];
  let originalArgs: any = {};
  let issues: Array<{ type: string; field?: string; message: string }> = [];

  if ('name' in toolOrConfig && validationArg) {
    const tool = toolOrConfig as ToolMetadata;
    if (validationArg.valid) {
      return {
        repairable: false,
        tool: tool.name,
        reason: 'Tool arguments are already valid.',
      };
    }
    toolName = tool.name;
    schemaProps = tool.parameters?.properties || {};
    missingFields = validationArg.missingFields || [];
    invalidFields = validationArg.invalidFields || [];
    unknownFields = validationArg.unknownFields || [];
    originalArgs = originalArgsArg || {};
    issues = validationArg.issues || [];
  } else {
    const cfg = toolOrConfig as {
      toolName: string;
      schema?: any;
      missingFields?: string[];
      invalidFields?: string[];
      unknownFields?: string[];
      previousArgs?: any;
      errorMessage?: string;
    };
    toolName = cfg.toolName;
    schemaProps = cfg.schema?.properties || cfg.schema || {};
    missingFields = cfg.missingFields || [];
    invalidFields = cfg.invalidFields || [];
    unknownFields = cfg.unknownFields || [];
    originalArgs = cfg.previousArgs || {};
  }

  // Preserve valid arguments
  const preservedArguments: Record<string, any> = {};
  const canonical = canonicalizeArguments(originalArgs);
  for (const [k, v] of Object.entries(canonical)) {
    if (!invalidFields.includes(k) && !unknownFields.includes(k)) {
      preservedArguments[k] = v;
    }
  }

  const missingList = missingFields.join(', ');
  const invalidList = invalidFields.join(', ');

  // Safe schema properties description (excluding any secret/sensitive attributes)
  const relevantSchema: Record<string, any> = {};
  for (const f of [...missingFields, ...invalidFields]) {
    if (schemaProps[f]) {
      relevantSchema[f] = {
        type: schemaProps[f].type,
        description: schemaProps[f].description,
        enum: schemaProps[f].enum,
      };
    }
  }

  let repairInstruction = `[ARGUMENT REPAIR REQUIRED]\nTool invocation failed due to malformed arguments.\n\nTool:\n${toolName}\n`;
  if (missingFields.length > 0) {
    repairInstruction += `\nMissing required field${missingFields.length > 1 ? 's' : ''}:\n${missingList}\n`;
  }
  if (invalidFields.length > 0) {
    repairInstruction += `\nInvalid field${invalidFields.length > 1 ? 's' : ''}:\n${invalidList}\n`;
    for (const issue of issues.filter(i => i.type === 'invalid_type' || i.type === 'invalid_value')) {
      repairInstruction += ` - ${issue.message}\n`;
    }
  }
  if (unknownFields.length > 0) {
    repairInstruction += `\nUnknown parameter(s) rejected:\n${unknownFields.join(', ')}\n`;
  }

  repairInstruction += `\nAuthoritative Schema Requirements:\n${JSON.stringify(relevantSchema, null, 2)}\n`;
  repairInstruction += `\nPreserved Valid Arguments:\n${JSON.stringify(preservedArguments, null, 2)}\n`;
  repairInstruction += `\nDeterministic Rules:\n`;
  repairInstruction += `1. Keep valid parameters intact. Do NOT change tool selection.\n`;
  repairInstruction += `2. Supply all missing required parameters according to the authoritative schema.\n`;
  repairInstruction += `3. Correct invalid types and values.\n`;
  repairInstruction += `4. Do NOT repeat previous invalid invocation or duplicate payload.\n`;

  return {
    repairable: true,
    tool: toolName,
    missingFields,
    invalidFields,
    requiredSchema: relevantSchema,
    instruction: repairInstruction,
    preservedArguments,
  };
}

/**
 * Deterministic tracker for tool invocations and argument repair attempts.
 * Prevents execution loops and blocks duplicate invalid invocations immediately.
 */
export class ArgumentInvocationTracker {
  private failedInvocations: Map<string, {
    tool: string;
    fingerprint: string;
    validationError: string;
    attempts: number;
    firstSeenAt: string;
    lastSeenAt: string;
  }> = new Map();

  private toolRepairAttempts: Map<string, number> = new Map();
  private maxAttemptsPerTool: number;

  constructor(maxAttemptsPerTool: number = 2) {
    this.maxAttemptsPerTool = maxAttemptsPerTool;
  }

  /**
   * Resets tracker (for new task/goal execution)
   */
  public reset(): void {
    this.failedInvocations.clear();
    this.toolRepairAttempts.clear();
  }

  /**
   * Check whether this invalid invocation is an exact duplicate of an already rejected invocation.
   */
  public isDuplicateInvalidCall(toolName: string, fingerprint: string): boolean {
    const key = `${toolName.toLowerCase()}::${fingerprint}`;
    return this.failedInvocations.has(key);
  }

  /**
   * Records an invalid invocation attempt.
   * Returns:
   * - isDuplicate: true if identical (tool, fingerprint) was already rejected
   * - attempt: current repair attempt for this tool
   * - budgetExceeded: true if repair attempts for this tool exceeds maxAttemptsPerTool
   */
  public recordInvalidInvocation(
    toolName: string,
    fingerprint: string,
    validationError: string
  ): { isDuplicate: boolean; attempt: number; budgetExceeded: boolean } {
    const key = `${toolName.toLowerCase()}::${fingerprint}`;
    const isDuplicate = this.failedInvocations.has(key);

    const now = new Date().toISOString();
    const existing = this.failedInvocations.get(key);
    if (existing) {
      existing.attempts += 1;
      existing.lastSeenAt = now;
    } else {
      this.failedInvocations.set(key, {
        tool: toolName,
        fingerprint,
        validationError,
        attempts: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }

    const currentToolAttempts = (this.toolRepairAttempts.get(toolName) || 0) + 1;
    this.toolRepairAttempts.set(toolName, currentToolAttempts);

    const budgetExceeded = currentToolAttempts > this.maxAttemptsPerTool;

    return {
      isDuplicate,
      attempt: currentToolAttempts,
      budgetExceeded,
    };
  }

  /**
   * Records a successful invocation of a tool, clearing its active repair counter.
   */
  public recordSuccessfulInvocation(toolName: string): void {
    this.toolRepairAttempts.delete(toolName);
  }

  /**
   * Returns current repair attempts count for a given tool.
   */
  public getRepairAttempts(toolName: string): number {
    return this.toolRepairAttempts.get(toolName) || 0;
  }
}

import fs from 'fs';
import path from 'path';

export const VALID_JSON_SCHEMA_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'null',
]);

export interface SchemaNormalizeOptions {
  isRoot?: boolean;
  provider?: 'openai-compatible' | 'gemini' | 'standard';
}

export interface ProviderCompatibilityResult {
  valid: boolean;
  type?: 'INVALID_TOOL_SCHEMA';
  tool?: string;
  path?: string;
  value?: any;
  message?: string;
}

export type ProviderErrorClass =
  | 'TRANSIENT'
  | 'RATE_LIMIT'
  | 'INVALID_REQUEST'
  | 'INVALID_TOOL_SCHEMA'
  | 'AUTHENTICATION'
  | 'PERMISSION'
  | 'UNKNOWN';

export interface ClassifiedProviderError {
  errorClass: ProviderErrorClass;
  retryable: boolean;
  message: string;
  statusCode?: number;
  diagnostics?: {
    provider?: string;
    toolIndex?: number;
    toolName?: string;
    schemaPath?: string;
    invalidValue?: any;
  };
}

/**
 * Deep clones an object safely without circular references.
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Normalizes any internal tool schema into valid, standard JSON Schema.
 * Preserves semantic meaning without forcing restrictive types.
 * For arbitrary JSON values ('any', 'unknown'), converts to provider-compatible anyOf schema.
 */
export function normalizeToolSchema(rawSchema: any, options?: SchemaNormalizeOptions): any {
  if (!rawSchema || typeof rawSchema !== 'object') {
    return { type: 'object', properties: {}, required: [] };
  }

  const schema = deepClone(rawSchema);
  return normalizeNode(schema, options?.isRoot ?? true, options?.provider || 'openai-compatible');
}

/**
 * Authoritative single normalizer for all tool schemas sent to model providers.
 * Translates internal representations (any, unknown, union, nullable) to provider-compatible JSON Schema.
 */
export function normalizeToolSchemaForProvider(rawSchema: any, options?: SchemaNormalizeOptions): any {
  const normalized = normalizeToolSchema(rawSchema, {
    isRoot: options?.isRoot ?? true,
    provider: options?.provider || 'openai-compatible',
  });
  return toProviderSchema(normalized, options?.provider || 'openai-compatible');
}

function normalizeNode(node: any, isRoot: boolean, provider: string): any {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return node;
  }

  // 1. Handle type transformations
  if ('type' in node) {
    const rawType = node.type;

    if (rawType === 'any' || rawType === 'unknown') {
      // In JSON Schema, an unconstrained schema represents any valid JSON value.
      // For top-level tool parameters, OpenAI expects type: "object".
      if (isRoot) {
        node.type = 'object';
        if (!node.properties) node.properties = {};
        if (!node.required) node.required = [];
      } else {
        delete node.type;
        // Provider-compatible representation preserving semantic intent of arbitrary JSON value
        node.anyOf = [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'object' },
          { type: 'array' },
          { type: 'null' },
        ];
      }
    } else if (rawType === 'optional') {
      delete node.type;
    } else if (typeof rawType === 'string' && rawType.includes('|')) {
      // Handle union like "string | number"
      const parts = rawType.split('|').map((s: string) => s.trim()).filter(Boolean);
      delete node.type;
      node.anyOf = parts.map((partType: string) => {
        if (partType === 'any' || partType === 'unknown') {
          return {
            anyOf: [
              { type: 'string' },
              { type: 'number' },
              { type: 'boolean' },
              { type: 'object' },
              { type: 'array' },
              { type: 'null' },
            ],
          };
        }
        if (partType === 'null') return { type: 'null' };
        return { type: partType };
      });
    } else if (rawType === 'union') {
      delete node.type;
      if (Array.isArray(node.types)) {
        node.anyOf = node.types.map((t: any) => normalizeNode(typeof t === 'string' ? { type: t } : t, false, provider));
        delete node.types;
      }
    } else if (Array.isArray(rawType)) {
      if (rawType.includes('any') || rawType.includes('unknown')) {
        if (isRoot) {
          node.type = 'object';
          if (!node.properties) node.properties = {};
          if (!node.required) node.required = [];
        } else {
          delete node.type;
          node.anyOf = [
            { type: 'string' },
            { type: 'number' },
            { type: 'boolean' },
            { type: 'object' },
            { type: 'array' },
            { type: 'null' },
          ];
        }
      } else {
        // e.g. ["string", "null"] -> anyOf: [{ type: "string" }, { type: "null" }]
        const validTypes = rawType.filter((t: any) => VALID_JSON_SCHEMA_TYPES.has(t));
        if (validTypes.length > 1) {
          delete node.type;
          node.anyOf = validTypes.map((t: string) => ({ type: t }));
        } else if (validTypes.length === 1) {
          node.type = validTypes[0];
        }
      }
    }
  }

  // 2. Handle nullable: true
  if (node.nullable === true) {
    delete node.nullable;
    if (node.type && typeof node.type === 'string' && VALID_JSON_SCHEMA_TYPES.has(node.type)) {
      const currentType = node.type;
      delete node.type;
      node.anyOf = [{ type: currentType }, { type: 'null' }];
    } else if (node.anyOf && Array.isArray(node.anyOf)) {
      const hasNull = node.anyOf.some((variant: any) => variant.type === 'null');
      if (!hasNull) {
        node.anyOf.push({ type: 'null' });
      }
    }
  }

  // 3. Handle object properties & required
  if (node.type === 'object' || isRoot) {
    if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
      node.properties = {};
    }

    // Recursively normalize every property
    const normalizedProperties: Record<string, any> = {};
    for (const [propKey, propVal] of Object.entries(node.properties)) {
      normalizedProperties[propKey] = normalizeNode(propVal, false, provider);
    }
    node.properties = normalizedProperties;

    // Filter required: must be an array of strings, unique, and required ⊆ properties
    if (Array.isArray(node.required)) {
      const propKeys = new Set(Object.keys(node.properties));
      const seen = new Set<string>();
      const validRequired: string[] = [];

      for (const req of node.required) {
        if (typeof req === 'string' && propKeys.has(req) && !seen.has(req)) {
          // Check if property was explicitly marked optional
          const propDef = node.properties[req];
          if (!propDef?.optional) {
            seen.add(req);
            validRequired.push(req);
          }
        }
      }
      node.required = validRequired;
    } else {
      node.required = [];
    }

    if (isRoot && !node.type) {
      node.type = 'object';
    }
  }

  // 4. Handle array items
  if (node.type === 'array') {
    if (node.items) {
      if (Array.isArray(node.items)) {
        node.items = node.items.map((item: any) => normalizeNode(item, false, provider));
      } else {
        node.items = normalizeNode(node.items, false, provider);
      }
    } else {
      node.items = {};
    }
  }

  // 5. Handle anyOf / oneOf / allOf
  if (Array.isArray(node.anyOf)) {
    node.anyOf = node.anyOf.map((v: any) => normalizeNode(v, false, provider));
  }
  if (Array.isArray(node.oneOf)) {
    node.oneOf = node.oneOf.map((v: any) => normalizeNode(v, false, provider));
  }
  if (Array.isArray(node.allOf)) {
    node.allOf = node.allOf.map((v: any) => normalizeNode(v, false, provider));
  }

  return node;
}

/**
 * Converts a normalized schema to a provider-specific parameter schema (e.g. OpenAI function tool).
 */
export function toProviderSchema(normalizedSchema: any, provider: string = 'openai-compatible'): any {
  const schema = deepClone(normalizedSchema || { type: 'object', properties: {}, required: [] });

  if (schema.type !== 'object') {
    return {
      type: 'object',
      properties: schema.properties || {},
      required: Array.isArray(schema.required) ? schema.required : [],
    };
  }

  if (!schema.properties || typeof schema.properties !== 'object') {
    schema.properties = {};
  }
  if (!Array.isArray(schema.required)) {
    schema.required = [];
  }

  // Ensure required ⊆ properties
  const propKeys = new Set(Object.keys(schema.properties));
  schema.required = schema.required.filter((k: string) => propKeys.has(k));

  return schema;
}

/**
 * Validates that a schema adheres strictly to Model Provider JSON Schema specifications.
 * Detects invalid type values ('any', 'unknown', etc.), required fields not in properties,
 * malformed objects/arrays/unions.
 */
export function validateProviderCompatibility(
  schema: any,
  context?: { toolName?: string; provider?: string }
): ProviderCompatibilityResult {
  const toolName = context?.toolName || 'unknown_tool';

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return {
      valid: false,
      type: 'INVALID_TOOL_SCHEMA',
      tool: toolName,
      path: '',
      value: schema,
      message: `Tool schema must be a JSON object.`,
    };
  }

  return validateSchemaNode(schema, '', toolName);
}

function validateSchemaNode(
  node: any,
  currentPath: string,
  toolName: string
): ProviderCompatibilityResult {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return { valid: true };
  }

  // 1. Validate type keyword if present
  if ('type' in node) {
    const t = node.type;
    const typePath = currentPath ? `${currentPath}.type` : 'type';

    if (typeof t === 'string') {
      if (!VALID_JSON_SCHEMA_TYPES.has(t)) {
        return {
          valid: false,
          type: 'INVALID_TOOL_SCHEMA',
          tool: toolName,
          path: typePath,
          value: t,
          message: `'${t}' is not valid under any of the given schemas. Allowed JSON Schema types: ${Array.from(VALID_JSON_SCHEMA_TYPES).join(', ')}.`,
        };
      }
    } else if (Array.isArray(t)) {
      for (const item of t) {
        if (!VALID_JSON_SCHEMA_TYPES.has(item)) {
          return {
            valid: false,
            type: 'INVALID_TOOL_SCHEMA',
            tool: toolName,
            path: typePath,
            value: item,
            message: `Array type element '${item}' is not valid under JSON Schema specification.`,
          };
        }
      }
    } else {
      return {
        valid: false,
        type: 'INVALID_TOOL_SCHEMA',
        tool: toolName,
        path: typePath,
        value: t,
        message: `'type' attribute must be a string or array of strings.`,
      };
    }
  }

  // 2. Validate object schema & required ⊆ properties
  if (node.type === 'object') {
    const props = node.properties;
    if (props !== undefined) {
      if (typeof props !== 'object' || props === null || Array.isArray(props)) {
        const propsPath = currentPath ? `${currentPath}.properties` : 'properties';
        return {
          valid: false,
          type: 'INVALID_TOOL_SCHEMA',
          tool: toolName,
          path: propsPath,
          value: props,
          message: `'properties' must be a JSON object mapping property names to schemas.`,
        };
      }

      // Recursively validate properties
      for (const [key, propSchema] of Object.entries(props)) {
        const propPath = currentPath ? `${currentPath}.properties.${key}` : `properties.${key}`;
        const propResult = validateSchemaNode(propSchema, propPath, toolName);
        if (!propResult.valid) {
          return propResult;
        }
      }
    }

    if (node.required !== undefined) {
      const reqPath = currentPath ? `${currentPath}.required` : 'required';
      if (!Array.isArray(node.required)) {
        return {
          valid: false,
          type: 'INVALID_TOOL_SCHEMA',
          tool: toolName,
          path: reqPath,
          value: node.required,
          message: `'required' must be an array of property names.`,
        };
      }

      const availableProps = new Set(Object.keys(props || {}));
      for (const reqField of node.required) {
        if (typeof reqField !== 'string') {
          return {
            valid: false,
            type: 'INVALID_TOOL_SCHEMA',
            tool: toolName,
            path: reqPath,
            value: reqField,
            message: `Items in 'required' must be strings.`,
          };
        }
        if (!availableProps.has(reqField)) {
          return {
            valid: false,
            type: 'INVALID_TOOL_SCHEMA',
            tool: toolName,
            path: reqPath,
            value: reqField,
            message: `Required property '${reqField}' is not defined in properties.`,
          };
        }
      }
    }
  }

  // 3. Validate array items
  if (node.type === 'array' && node.items) {
    const itemsPath = currentPath ? `${currentPath}.items` : 'items';
    if (Array.isArray(node.items)) {
      for (let i = 0; i < node.items.length; i++) {
        const itemRes = validateSchemaNode(node.items[i], `${itemsPath}[${i}]`, toolName);
        if (!itemRes.valid) return itemRes;
      }
    } else {
      const itemRes = validateSchemaNode(node.items, itemsPath, toolName);
      if (!itemRes.valid) return itemRes;
    }
  }

  // 4. Validate unions (anyOf, oneOf, allOf)
  for (const unionKey of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (node[unionKey] !== undefined) {
      const unionPath = currentPath ? `${currentPath}.${unionKey}` : unionKey;
      if (!Array.isArray(node[unionKey])) {
        return {
          valid: false,
          type: 'INVALID_TOOL_SCHEMA',
          tool: toolName,
          path: unionPath,
          value: node[unionKey],
          message: `'${unionKey}' must be an array of schemas.`,
        };
      }
      for (let i = 0; i < node[unionKey].length; i++) {
        const variantRes = validateSchemaNode(node[unionKey][i], `${unionPath}[${i}]`, toolName);
        if (!variantRes.valid) return variantRes;
      }
    }
  }

  return { valid: true };
}

/**
 * Deterministic error classifier for provider responses and network exceptions.
 * Classifies HTTP 400 schema validation errors as non-retryable INVALID_TOOL_SCHEMA.
 */
export function classifyProviderError(
  status: number,
  errorBodyOrMessage: string,
  tools?: any[]
): ClassifiedProviderError {
  const text = errorBodyOrMessage || '';
  const lower = text.toLowerCase();

  // 1. Detect tool schema errors
  const isSchemaError =
    lower.includes("invalid 'parameters' schema") ||
    lower.includes('is not valid under any of the given schemas') ||
    lower.includes('failed schema validation') ||
    lower.includes("schema['properties']") ||
    lower.includes('expected_test_output') ||
    lower.includes("'type' is not valid") ||
    lower.includes('"type" is not valid') ||
    lower.includes('invalid tool schema') ||
    lower.includes('invalid parameters') ||
    lower.includes('malformed tool schema') ||
    (lower.includes('schema') && (lower.includes('invalid') || lower.includes('malformed')));

  if (isSchemaError) {
    // Extract tool index, e.g. "Tool 14 function has invalid 'parameters' schema"
    const toolIndexMatch = text.match(/Tool\s+(\d+)/i);
    const toolIndex = toolIndexMatch ? parseInt(toolIndexMatch[1], 10) : undefined;

    // Extract path, e.g. "On schema['properties']['expected_test_output']['type']"
    let schemaPath: string | undefined;
    const pathMatch = text.match(/schema(\[.*?\])/i);
    if (pathMatch) {
      schemaPath = pathMatch[1]
        .replace(/\[\s*['"]?([^'"\]]+)['"]?\s*\]/g, '.$1')
        .replace(/^\./, '');
    }

    // Extract invalid value, e.g. "'any' is not valid" or ": 'any'"
    let invalidValue: any;
    const valMatch1 = text.match(/'([^']+)'\s+is not valid/i);
    const valMatch2 = text.match(/:\s*['"]([^'"]+)['"]/);
    if (valMatch1) {
      invalidValue = valMatch1[1];
    } else if (valMatch2) {
      invalidValue = valMatch2[1];
    }

    let toolName: string | undefined;
    if (toolIndex !== undefined && tools && tools[toolIndex]) {
      toolName = tools[toolIndex].function?.name || tools[toolIndex].name;
    }

    return {
      errorClass: 'INVALID_TOOL_SCHEMA',
      retryable: false,
      statusCode: status || 400,
      message: text,
      diagnostics: {
        provider: 'openai-compatible',
        toolIndex,
        toolName,
        schemaPath,
        invalidValue,
      },
    };
  }

  // 2. HTTP 400 / 422 Bad Request
  if (status === 400 || status === 422) {
    return {
      errorClass: 'INVALID_REQUEST',
      retryable: false,
      statusCode: status,
      message: text,
    };
  }

  // 3. HTTP 401 Unauthorized
  if (status === 401) {
    return {
      errorClass: 'AUTHENTICATION',
      retryable: false,
      statusCode: status,
      message: text,
    };
  }

  // 4. HTTP 403 Forbidden
  if (status === 403) {
    return {
      errorClass: 'PERMISSION',
      retryable: false,
      statusCode: status,
      message: text,
    };
  }

  // 5. HTTP 404 Not Found
  if (status === 404) {
    return {
      errorClass: 'INVALID_REQUEST',
      retryable: false,
      statusCode: status,
      message: text,
    };
  }

  // 6. HTTP 429 Rate Limit
  if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      errorClass: 'RATE_LIMIT',
      retryable: true,
      statusCode: status,
      message: text,
    };
  }

  // 7. HTTP 5xx Transient Server Errors
  if (status >= 500 && status <= 504) {
    return {
      errorClass: 'TRANSIENT',
      retryable: true,
      statusCode: status,
      message: text,
    };
  }

  // 8. Network-level transient errors & generic transient exceptions
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('network error') ||
    lower.includes('transient')
  ) {
    return {
      errorClass: 'TRANSIENT',
      retryable: true,
      statusCode: status || 500,
      message: text,
    };
  }

  if (status === 0 || !status) {
    return {
      errorClass: 'TRANSIENT',
      retryable: true,
      statusCode: 0,
      message: text,
    };
  }

  return {
    errorClass: 'UNKNOWN',
    retryable: false,
    statusCode: status,
    message: text,
  };
}

/**
 * Saves or prints a sanitized schema debug snapshot for inspection.
 * Omits secrets and prints clean diagnostic json.
 */
export function saveOrPrintSchemaDebugSnapshot(
  tools: any[],
  failedToolIndex?: number,
  errorDetails?: any
): Record<string, any> {
  const sanitizedTools = tools.map((t, idx) => ({
    index: idx,
    name: t.function?.name || t.name,
    description: t.function?.description || t.description,
    parameters: JSON.parse(JSON.stringify(t.function?.parameters || t.parameters || {})),
  }));

  const snapshot = {
    timestamp: new Date().toISOString(),
    failedToolIndex,
    failedToolName: failedToolIndex !== undefined ? sanitizedTools[failedToolIndex]?.name : undefined,
    error: errorDetails,
    tools: sanitizedTools,
  };

  try {
    const debugDir = path.resolve(process.cwd(), 'workspace', 'debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    const snapshotFile = path.join(debugDir, 'schema_debug_snapshot.json');
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2), 'utf-8');
  } catch {}

  return snapshot;
}

import { V2RayConfigModel } from './models';

export interface ValidationIssue {
  field: string;
  type: 'error' | 'warning' | 'info';
  message: string;
  remediation?: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  score: number; // 0 - 100
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
  structureSummary: {
    inboundsCount: number;
    outboundsCount: number;
    protocols: string[];
    transports: string[];
    securityModes: string[];
    routingRulesCount: number;
  };
}

export class V2RayValidator {
  public static validate(config: any): ConfigValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const info: ValidationIssue[] = [];

    if (!config || typeof config !== 'object') {
      return {
        valid: false,
        score: 0,
        errors: [{ field: 'root', type: 'error', message: 'Configuration must be a valid non-null JSON object.' }],
        warnings: [],
        info: [],
        structureSummary: { inboundsCount: 0, outboundsCount: 0, protocols: [], transports: [], securityModes: [], routingRulesCount: 0 },
      };
    }

    // 1. Inbounds Check
    if (!Array.isArray(config.inbounds) || config.inbounds.length === 0) {
      errors.push({
        field: 'inbounds',
        type: 'error',
        message: 'Configuration must contain at least one inbound definition.',
        remediation: 'Add an inbound with a valid protocol, port, and tag.',
      });
    } else {
      config.inbounds.forEach((inb: any, index: number) => {
        const inbTag = inb.tag || `inbound[${index}]`;
        if (!inb.protocol) {
          errors.push({ field: `inbounds[${index}].protocol`, type: 'error', message: `Inbound '${inbTag}' is missing protocol.` });
        }
        if (inb.port === undefined || inb.port === null) {
          errors.push({ field: `inbounds[${index}].port`, type: 'error', message: `Inbound '${inbTag}' is missing port.` });
        } else {
          const p = Number(inb.port);
          if (isNaN(p) || p < 1 || p > 65535) {
            errors.push({ field: `inbounds[${index}].port`, type: 'error', message: `Inbound '${inbTag}' port ${inb.port} is outside valid range (1-65535).` });
          }
        }

        // Protocol specifics
        this.validateProtocolSettings(inb.protocol, inb.settings, `inbounds[${index}]`, errors, warnings);

        // StreamSettings
        if (inb.streamSettings) {
          this.validateStreamSettings(inb.streamSettings, `inbounds[${index}].streamSettings`, errors, warnings);
        }
      });
    }

    // 2. Outbounds Check
    if (!Array.isArray(config.outbounds) || config.outbounds.length === 0) {
      errors.push({
        field: 'outbounds',
        type: 'error',
        message: 'Configuration must contain at least one outbound definition.',
        remediation: 'Add an outbound (e.g. freedom for server, vless/vmess/trojan for client).',
      });
    } else {
      config.outbounds.forEach((outb: any, index: number) => {
        const outbTag = outb.tag || `outbound[${index}]`;
        if (!outb.protocol) {
          errors.push({ field: `outbounds[${index}].protocol`, type: 'error', message: `Outbound '${outbTag}' is missing protocol.` });
        }

        this.validateProtocolSettings(outb.protocol, outb.settings, `outbounds[${index}]`, errors, warnings);

        if (outb.streamSettings) {
          this.validateStreamSettings(outb.streamSettings, `outbounds[${index}].streamSettings`, errors, warnings);
        }
      });
    }

    // 3. Routing Check
    let routingRulesCount = 0;
    if (config.routing) {
      if (Array.isArray(config.routing.rules)) {
        routingRulesCount = config.routing.rules.length;
        const availableOutboundTags = new Set(
          (config.outbounds || []).map((o: any) => o.tag).filter(Boolean)
        );

        config.routing.rules.forEach((rule: any, idx: number) => {
          if (!rule.outboundTag) {
            errors.push({ field: `routing.rules[${idx}].outboundTag`, type: 'error', message: `Routing rule ${idx} is missing target outboundTag.` });
          } else if (availableOutboundTags.size > 0 && !availableOutboundTags.has(rule.outboundTag)) {
            warnings.push({
              field: `routing.rules[${idx}].outboundTag`,
              type: 'warning',
              message: `Routing rule targets outboundTag '${rule.outboundTag}', which is not defined in outbounds list.`,
            });
          }
        });
      }
    } else {
      info.push({ field: 'routing', type: 'info', message: 'No explicit routing block. Traffic will use default first outbound.' });
    }

    // Summary calculation
    const protocols: string[] = [];
    const transports: string[] = [];
    const securityModes: string[] = [];

    (config.inbounds || []).forEach((i: any) => {
      if (i.protocol) protocols.push(`in:${i.protocol}`);
      if (i.streamSettings?.network) transports.push(i.streamSettings.network);
      if (i.streamSettings?.security) securityModes.push(i.streamSettings.security);
    });
    (config.outbounds || []).forEach((o: any) => {
      if (o.protocol) protocols.push(`out:${o.protocol}`);
      if (o.streamSettings?.network) transports.push(o.streamSettings.network);
      if (o.streamSettings?.security) securityModes.push(o.streamSettings.security);
    });

    const isValid = errors.length === 0;
    let score = 100 - (errors.length * 25) - (warnings.length * 5);
    if (score < 0) score = 0;

    return {
      valid: isValid,
      score,
      errors,
      warnings,
      info,
      structureSummary: {
        inboundsCount: config.inbounds?.length || 0,
        outboundsCount: config.outbounds?.length || 0,
        protocols: Array.from(new Set(protocols)),
        transports: Array.from(new Set(transports)),
        securityModes: Array.from(new Set(securityModes)),
        routingRulesCount,
      },
    };
  }

  private static validateProtocolSettings(protocol: string, settings: any, pathPrefix: string, errors: ValidationIssue[], warnings: ValidationIssue[]) {
    if (!settings && !['freedom', 'blackhole', 'dns'].includes(protocol)) {
      warnings.push({ field: `${pathPrefix}.settings`, type: 'warning', message: `Settings object is empty for protocol '${protocol}'.` });
      return;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (protocol === 'vless' || protocol === 'vmess') {
      const clients = settings?.clients || settings?.vnext?.[0]?.users;
      if (Array.isArray(clients) && clients.length > 0) {
        clients.forEach((c: any, i: number) => {
          if (!c.id) {
            errors.push({ field: `${pathPrefix}.clients[${i}].id`, type: 'error', message: `Client #${i + 1} UUID is missing.` });
          } else if (!uuidRegex.test(c.id)) {
            errors.push({ field: `${pathPrefix}.clients[${i}].id`, type: 'error', message: `Client UUID '${c.id}' is not a valid standard UUID format.` });
          }
        });
      }
    } else if (protocol === 'trojan') {
      const clients = settings?.clients || settings?.servers;
      if (Array.isArray(clients) && clients.length > 0) {
        clients.forEach((c: any, i: number) => {
          if (!c.password) {
            errors.push({ field: `${pathPrefix}.clients[${i}].password`, type: 'error', message: `Trojan client password is required.` });
          }
        });
      }
    }
  }

  private static validateStreamSettings(stream: any, pathPrefix: string, errors: ValidationIssue[], warnings: ValidationIssue[]) {
    const net = stream.network || 'tcp';
    const sec = stream.security || 'none';

    if (sec === 'reality') {
      const reality = stream.realitySettings;
      if (!reality) {
        errors.push({ field: `${pathPrefix}.realitySettings`, type: 'error', message: 'Reality security selected but realitySettings block is missing.' });
      } else {
        if (!reality.serverNames || reality.serverNames.length === 0) {
          warnings.push({ field: `${pathPrefix}.realitySettings.serverNames`, type: 'warning', message: 'Reality serverNames list is recommended (SNI masquerading).' });
        }
      }
    }

    if (net === 'ws' && !stream.wsSettings?.path) {
      warnings.push({ field: `${pathPrefix}.wsSettings.path`, type: 'warning', message: 'WebSocket path is not set; defaults to root /.' });
    }

    if (net === 'grpc' && !stream.grpcSettings?.serviceName) {
      warnings.push({ field: `${pathPrefix}.grpcSettings.serviceName`, type: 'warning', message: 'gRPC serviceName is not set.' });
    }
  }
}

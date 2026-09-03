import { V2RayDomainErrorCode, VerificationState } from './models';
import {
  classifyRealityKey,
  isPlaceholderString,
  validateShortId,
  verifyRealityKeyPair,
} from './crypto';

export interface ValidationIssue {
  field: string;
  type: 'error' | 'warning' | 'info';
  code?: V2RayDomainErrorCode | string;
  message: string;
  remediation?: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  score: number; // 0 - 100
  verification: VerificationState;
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

export interface PairValidationResult {
  valid: boolean;
  score: number;
  verification: VerificationState;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  pairDetails: {
    uuidMatch: boolean;
    cryptoPairVerified: boolean;
    sniMatch: boolean;
    shortIdMatch: boolean;
    addressReachable: boolean;
  };
}

export class V2RayValidator {
  public static validate(
    config: any,
    options?: { allowLocalServer?: boolean }
  ): ConfigValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const info: ValidationIssue[] = [];

    const verification: VerificationState = {
      structural: 'pass',
      semantic: 'pass',
      cryptographic: 'not_verified',
      runtime: 'not_tested',
      interoperability: 'not_verified',
    };

    if (!config || typeof config !== 'object') {
      verification.structural = 'fail';
      verification.semantic = 'fail';
      return {
        valid: false,
        score: 0,
        verification,
        errors: [{ field: 'root', type: 'error', message: 'Configuration must be a valid non-null JSON object.' }],
        warnings: [],
        info: [],
        structureSummary: { inboundsCount: 0, outboundsCount: 0, protocols: [], transports: [], securityModes: [], routingRulesCount: 0 },
      };
    }

    // 1. Inbounds Check (Structural & Domain)
    if (!Array.isArray(config.inbounds) || config.inbounds.length === 0) {
      errors.push({
        field: 'inbounds',
        type: 'error',
        message: 'Configuration must contain at least one inbound definition.',
        remediation: 'Add an inbound with a valid protocol, port, and tag.',
      });
      verification.structural = 'fail';
    } else {
      config.inbounds.forEach((inb: any, index: number) => {
        const inbTag = inb.tag || `inbound[${index}]`;
        if (!inb.protocol) {
          errors.push({ field: `inbounds[${index}].protocol`, type: 'error', message: `Inbound '${inbTag}' is missing protocol.` });
          verification.structural = 'fail';
        }
        if (inb.port === undefined || inb.port === null) {
          errors.push({ field: `inbounds[${index}].port`, type: 'error', code: 'INVALID_PORT', message: `Inbound '${inbTag}' is missing port.` });
          verification.structural = 'fail';
        } else {
          const p = Number(inb.port);
          if (isNaN(p) || p < 1 || p > 65535) {
            errors.push({ field: `inbounds[${index}].port`, type: 'error', code: 'INVALID_PORT', message: `Inbound '${inbTag}' port ${inb.port} is outside valid range (1-65535).` });
            verification.structural = 'fail';
          }
        }

        // Protocol specifics
        this.validateProtocolSettings(inb.protocol, inb.settings, `inbounds[${index}]`, inb.streamSettings, errors, warnings, verification);

        // StreamSettings (Server-side reality check)
        if (inb.streamSettings) {
          this.validateStreamSettings(inb.streamSettings, `inbounds[${index}].streamSettings`, 'server', errors, warnings, verification);
        }
      });
    }

    // 2. Outbounds Check (Structural, Domain & Client Checks)
    if (!Array.isArray(config.outbounds) || config.outbounds.length === 0) {
      errors.push({
        field: 'outbounds',
        type: 'error',
        message: 'Configuration must contain at least one outbound definition.',
        remediation: 'Add an outbound (e.g. freedom for server, vless/vmess/trojan for client).',
      });
      verification.structural = 'fail';
    } else {
      config.outbounds.forEach((outb: any, index: number) => {
        const outbTag = outb.tag || `outbound[${index}]`;
        if (!outb.protocol) {
          errors.push({ field: `outbounds[${index}].protocol`, type: 'error', message: `Outbound '${outbTag}' is missing protocol.` });
          verification.structural = 'fail';
        }

        // Destination address checks for proxy outbounds (Phase 4, 6, 7, 18)
        if (['vless', 'vmess', 'trojan', 'shadowsocks'].includes(outb.protocol)) {
          const vnext = outb.settings?.vnext;
          const servers = outb.settings?.servers;
          const targetAddr = vnext?.[0]?.address || servers?.[0]?.address;

          if (!targetAddr || !String(targetAddr).trim()) {
            errors.push({
              field: `outbounds[${index}].settings.address`,
              type: 'error',
              code: 'MISSING_REMOTE_SERVER_ADDRESS',
              message: `Outbound proxy '${outbTag}' is missing remote serverAddress.`,
              remediation: 'Specify the remote server domain or public IP address.',
            });
            verification.structural = 'fail';
          } else {
            const trimmedAddr = String(targetAddr).trim();
            if (
              (trimmedAddr === '127.0.0.1' || trimmedAddr === 'localhost' || trimmedAddr === '0.0.0.0') &&
              !options?.allowLocalServer
            ) {
              errors.push({
                field: `outbounds[${index}].settings.address`,
                type: 'error',
                code: 'INVALID_REMOTE_SERVER_ADDRESS',
                message: `Outbound remote server address '${trimmedAddr}' cannot be localhost/127.0.0.1 for external client proxy unless allowLocalServer=true.`,
                remediation: 'Provide a real external server domain or IP address.',
              });
              verification.semantic = 'fail';
            }
          }
        }

        this.validateProtocolSettings(outb.protocol, outb.settings, `outbounds[${index}]`, outb.streamSettings, errors, warnings, verification);

        if (outb.streamSettings) {
          this.validateStreamSettings(outb.streamSettings, `outbounds[${index}].streamSettings`, 'client', errors, warnings, verification);
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
            verification.structural = 'fail';
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

    // Redesigned Scoring Engine (Phase 14 & 15)
    // Never give score 100 to placeholder or invalid configs!
    let score = 0;

    if (!isValid) {
      if (verification.cryptographic === 'missing') {
        score = 0;
      } else if (verification.cryptographic === 'placeholder') {
        score = 15;
      } else if (verification.cryptographic === 'malformed') {
        score = 10;
      } else {
        score = Math.max(0, 50 - (errors.length * 15) - (warnings.length * 5));
      }
    } else {
      // Configuration is valid structurally and semantically
      if (verification.cryptographic === 'valid_format') {
        // Authentic crypto material present, but single config unverified against peer
        score = Math.max(75, 85 - (warnings.length * 5));
      } else if (verification.cryptographic === 'verified') {
        score = 95 - (warnings.length * 5);
      } else {
        // Non-reality protocol (e.g. freedom, shadowsocks, standard tls)
        score = 100 - (warnings.length * 5);
      }
    }

    return {
      valid: isValid,
      score,
      verification,
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

  /**
   * Validate a Server and Client configuration pair for Interoperability (Phase 5).
   */
  public static validatePair(
    serverConfig: any,
    clientConfig: any,
    options?: { allowLocalServer?: boolean }
  ): PairValidationResult {
    const serverRes = this.validate(serverConfig, options);
    const clientRes = this.validate(clientConfig, options);

    const errors: ValidationIssue[] = [...serverRes.errors, ...clientRes.errors];
    const warnings: ValidationIssue[] = [...serverRes.warnings, ...clientRes.warnings];

    const pairDetails = {
      uuidMatch: false,
      cryptoPairVerified: false,
      sniMatch: false,
      shortIdMatch: false,
      addressReachable: false,
    };

    const verification: VerificationState = {
      structural: serverRes.verification.structural === 'pass' && clientRes.verification.structural === 'pass' ? 'pass' : 'fail',
      semantic: serverRes.verification.semantic === 'pass' && clientRes.verification.semantic === 'pass' ? 'pass' : 'fail',
      cryptographic: 'not_verified',
      runtime: 'not_tested',
      interoperability: 'not_verified',
    };

    // Extract server inbound
    const serverInbound = (serverConfig.inbounds || []).find((i: any) => i.protocol === 'vless' || i.protocol === 'vmess');
    const clientOutbound = (clientConfig.outbounds || []).find((o: any) => o.protocol === 'vless' || o.protocol === 'vmess');

    if (!serverInbound || !clientOutbound) {
      errors.push({
        field: 'pair',
        type: 'error',
        code: 'CLIENT_SERVER_MISMATCH',
        message: 'Could not locate matching VLESS/VMess inbounds on server and outbounds on client.',
      });
      verification.interoperability = 'mismatch';
      return { valid: false, score: 0, verification, errors, warnings, pairDetails };
    }

    // 1. UUID Match Check
    const serverUuid = serverInbound.settings?.clients?.[0]?.id;
    const clientUuid = clientOutbound.settings?.vnext?.[0]?.users?.[0]?.id;

    if (serverUuid && clientUuid && serverUuid === clientUuid) {
      pairDetails.uuidMatch = true;
    } else {
      errors.push({
        field: 'pair.uuid',
        type: 'error',
        code: 'CLIENT_SERVER_MISMATCH',
        message: `Client UUID ('${clientUuid}') does not match Server UUID ('${serverUuid}').`,
      });
    }

    // 2. REALITY Cryptographic Material Match
    const serverReality = serverInbound.streamSettings?.realitySettings;
    const clientReality = clientOutbound.streamSettings?.realitySettings;

    if (serverReality && clientReality) {
      const privKey = serverReality.privateKey;
      const pubKey = clientReality.publicKey || clientReality.password;

      if (privKey && pubKey) {
        const matches = verifyRealityKeyPair(privKey, pubKey);
        if (matches) {
          pairDetails.cryptoPairVerified = true;
          verification.cryptographic = 'verified';
        } else {
          errors.push({
            field: 'pair.realityKey',
            type: 'error',
            code: 'CLIENT_SERVER_MISMATCH',
            message: 'Client REALITY publicKey does not mathematically derive from Server privateKey.',
          });
          verification.cryptographic = 'malformed';
        }
      }

      // 3. ShortId Match
      const clientSid = clientReality.shortId || clientReality.shortIds?.[0];
      const serverSids = serverReality.shortIds || [];
      if (clientSid && serverSids.includes(clientSid)) {
        pairDetails.shortIdMatch = true;
      } else {
        errors.push({
          field: 'pair.shortId',
          type: 'error',
          code: 'CLIENT_SERVER_MISMATCH',
          message: `Client shortId ('${clientSid}') is not present in Server accepted shortIds: [${serverSids.join(', ')}].`,
        });
      }

      // 4. SNI / ServerName Match
      const clientSni = clientReality.serverName || clientReality.serverNames?.[0];
      const serverNames = serverReality.serverNames || [];
      if (clientSni && (serverNames.includes(clientSni) || serverNames.some((sn: string) => clientSni.endsWith(sn)))) {
        pairDetails.sniMatch = true;
      } else {
        errors.push({
          field: 'pair.serverName',
          type: 'error',
          code: 'CLIENT_SERVER_MISMATCH',
          message: `Client SNI ('${clientSni}') is not present in Server serverNames: [${serverNames.join(', ')}].`,
        });
      }
    }

    // 5. Reachable Address
    const clientAddr = clientOutbound.settings?.vnext?.[0]?.address;
    if (clientAddr && clientAddr !== '127.0.0.1' && clientAddr !== 'localhost') {
      pairDetails.addressReachable = true;
    } else if (options?.allowLocalServer) {
      pairDetails.addressReachable = true;
    } else {
      errors.push({
        field: 'pair.address',
        type: 'error',
        code: 'INVALID_REMOTE_SERVER_ADDRESS',
        message: `Client target address is '${clientAddr}', which is not an externally reachable address.`,
      });
    }

    const validPair = errors.length === 0;
    verification.interoperability = validPair ? 'verified' : 'mismatch';
    const score = validPair ? 95 : Math.max(0, 40 - (errors.length * 10));

    return {
      valid: validPair,
      score,
      verification,
      errors,
      warnings,
      pairDetails,
    };
  }

  /**
   * Runtime configuration check (Phase 21).
   */
  public static async testRuntime(config: any): Promise<{ status: 'passed' | 'failed' | 'not_tested'; reason: string }> {
    // In environments without Xray installed:
    return {
      status: 'not_tested',
      reason: 'xray binary is not installed in runtime environment; simulated semantic validation performed.',
    };
  }

  private static validateProtocolSettings(
    protocol: string,
    settings: any,
    pathPrefix: string,
    streamSettings: any,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    verification: VerificationState
  ) {
    if (!settings && !['freedom', 'blackhole', 'dns'].includes(protocol)) {
      warnings.push({ field: `${pathPrefix}.settings`, type: 'warning', message: `Settings object is empty for protocol '${protocol}'.` });
      return;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (protocol === 'vless' || protocol === 'vmess') {
      const clients = settings?.clients || settings?.vnext?.[0]?.users;
      if (Array.isArray(clients) && clients.length > 0) {
        clients.forEach((c: any, i: number) => {
          if (!c.id) {
            errors.push({ field: `${pathPrefix}.clients[${i}].id`, type: 'error', code: 'INVALID_UUID', message: `Client #${i + 1} UUID is missing.` });
            verification.structural = 'fail';
          } else if (!uuidRegex.test(c.id)) {
            errors.push({ field: `${pathPrefix}.clients[${i}].id`, type: 'error', code: 'INVALID_UUID', message: `Client UUID '${c.id}' is not a valid standard UUID format.` });
            verification.structural = 'fail';
          }

          // Flow validation (Phase 10 & 11)
          if (c.flow) {
            if (c.flow !== 'xtls-rprx-vision' && c.flow !== 'none') {
              errors.push({
                field: `${pathPrefix}.clients[${i}].flow`,
                type: 'error',
                code: 'UNSUPPORTED_FLOW',
                message: `Flow '${c.flow}' is not supported. Supported: xtls-rprx-vision, none.`,
              });
              verification.semantic = 'fail';
            }
            if (c.flow === 'xtls-rprx-vision') {
              if (protocol !== 'vless') {
                errors.push({
                  field: `${pathPrefix}.clients[${i}].flow`,
                  type: 'error',
                  code: 'UNSUPPORTED_FLOW',
                  message: `xtls-rprx-vision requires protocol 'vless', got '${protocol}'.`,
                });
                verification.semantic = 'fail';
              }
              const net = streamSettings?.network || 'tcp';
              if (net !== 'tcp') {
                errors.push({
                  field: `${pathPrefix}.clients[${i}].flow`,
                  type: 'error',
                  code: 'UNSUPPORTED_FLOW',
                  message: `xtls-rprx-vision requires transport 'tcp', got '${net}'.`,
                });
                verification.semantic = 'fail';
              }
              const sec = streamSettings?.security || 'none';
              if (sec !== 'tls' && sec !== 'reality') {
                errors.push({
                  field: `${pathPrefix}.clients[${i}].flow`,
                  type: 'error',
                  code: 'UNSUPPORTED_FLOW',
                  message: `xtls-rprx-vision requires security 'tls' or 'reality', got '${sec}'.`,
                });
                verification.semantic = 'fail';
              }
            }
          }
        });
      }
    } else if (protocol === 'trojan') {
      const clients = settings?.clients || settings?.servers;
      if (Array.isArray(clients) && clients.length > 0) {
        clients.forEach((c: any, i: number) => {
          if (!c.password) {
            errors.push({ field: `${pathPrefix}.clients[${i}].password`, type: 'error', message: `Trojan client password is required.` });
            verification.structural = 'fail';
          }
        });
      }
    }
  }

  private static validateStreamSettings(
    stream: any,
    pathPrefix: string,
    role: 'server' | 'client',
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
    verification: VerificationState
  ) {
    const net = stream.network || 'tcp';
    const sec = stream.security || 'none';

    if (sec === 'reality') {
      const reality = stream.realitySettings;
      if (!reality) {
        errors.push({
          field: `${pathPrefix}.realitySettings`,
          type: 'error',
          code: role === 'server' ? 'MISSING_REALITY_PRIVATE_KEY' : 'MISSING_REALITY_PUBLIC_KEY',
          message: 'Reality security selected but realitySettings block is missing.',
        });
        verification.cryptographic = 'missing';
        verification.semantic = 'fail';
        return;
      }

      if (role === 'server') {
        // SERVER REALITY VALIDATION (Phase 2, 3, 12, 13)
        // 1. Private Key
        const privKey = reality.privateKey;
        const privClass = classifyRealityKey(privKey);

        if (privClass === 'missing') {
          errors.push({
            field: `${pathPrefix}.realitySettings.privateKey`,
            type: 'error',
            code: 'MISSING_REALITY_PRIVATE_KEY',
            message: 'REALITY server configuration requires a valid privateKey.',
            remediation: 'Provide a 32-byte Base64-encoded X25519 private key or enable autoGenerateKeys.',
          });
          verification.cryptographic = 'missing';
        } else if (privClass === 'placeholder') {
          errors.push({
            field: `${pathPrefix}.realitySettings.privateKey`,
            type: 'error',
            code: 'PLACEHOLDER_REALITY_KEY',
            message: `REALITY server privateKey contains placeholder string: "${privKey}".`,
            remediation: 'Replace placeholder string with a genuine Curve25519 private key.',
          });
          verification.cryptographic = 'placeholder';
        } else if (privClass === 'malformed') {
          errors.push({
            field: `${pathPrefix}.realitySettings.privateKey`,
            type: 'error',
            code: 'INVALID_REALITY_PRIVATE_KEY',
            message: `REALITY server privateKey is malformed. Expected 32-byte Base64/Base64url key, got "${privKey}".`,
          });
          verification.cryptographic = 'malformed';
        } else if (privClass === 'valid-looking') {
          if (verification.cryptographic === 'not_verified') {
            verification.cryptographic = 'valid_format';
          }
        }

        // 2. Dest / Target
        const dest = reality.dest || reality.target;
        if (!dest || typeof dest !== 'string' || !dest.includes(':')) {
          errors.push({
            field: `${pathPrefix}.realitySettings.dest`,
            type: 'error',
            code: 'INVALID_DEST',
            message: 'REALITY server requires fallback destination "dest" or "target" in host:port format.',
          });
          verification.semantic = 'fail';
        }

        // 3. ServerNames (SNI list)
        if (!Array.isArray(reality.serverNames) || reality.serverNames.length === 0) {
          errors.push({
            field: `${pathPrefix}.realitySettings.serverNames`,
            type: 'error',
            code: 'INVALID_SNI',
            message: 'REALITY server requires non-empty serverNames array for SNI masquerading.',
          });
          verification.semantic = 'fail';
        }

        // 4. ShortIds
        if (!Array.isArray(reality.shortIds) || reality.shortIds.length === 0) {
          errors.push({
            field: `${pathPrefix}.realitySettings.shortIds`,
            type: 'error',
            code: 'MISSING_REALITY_SHORT_ID',
            message: 'REALITY server configuration requires shortIds array with at least one short ID.',
          });
          verification.semantic = 'fail';
        } else {
          reality.shortIds.forEach((sid: any, sIdx: number) => {
            const sidCheck = validateShortId(sid);
            if (!sidCheck.valid) {
              errors.push({
                field: `${pathPrefix}.realitySettings.shortIds[${sIdx}]`,
                type: 'error',
                code: 'INVALID_REALITY_SHORT_ID',
                message: `Invalid short ID "${sid}": ${sidCheck.error}`,
              });
              verification.semantic = 'fail';
            }
          });
        }
      } else {
        // CLIENT REALITY VALIDATION (Phase 4, 12, 13)
        // 1. Public Key (or password alias)
        const pubKey = reality.publicKey || reality.password;
        const pubClass = classifyRealityKey(pubKey);

        if (pubClass === 'missing') {
          errors.push({
            field: `${pathPrefix}.realitySettings.publicKey`,
            type: 'error',
            code: 'MISSING_REALITY_PUBLIC_KEY',
            message: 'REALITY client requires publicKey (or password).',
          });
          verification.cryptographic = 'missing';
        } else if (pubClass === 'placeholder') {
          errors.push({
            field: `${pathPrefix}.realitySettings.publicKey`,
            type: 'error',
            code: 'PLACEHOLDER_REALITY_KEY',
            message: `REALITY client publicKey contains placeholder string: "${pubKey}".`,
          });
          verification.cryptographic = 'placeholder';
        } else if (pubClass === 'malformed') {
          errors.push({
            field: `${pathPrefix}.realitySettings.publicKey`,
            type: 'error',
            code: 'INVALID_REALITY_PUBLIC_KEY',
            message: `REALITY client publicKey is malformed. Expected 32-byte Base64 key, got "${pubKey}".`,
          });
          verification.cryptographic = 'malformed';
        } else if (pubClass === 'valid-looking') {
          if (verification.cryptographic === 'not_verified') {
            verification.cryptographic = 'valid_format';
          }
        }

        // 2. Short ID
        const sid = reality.shortId || reality.shortIds?.[0];
        if (sid === undefined || sid === null || sid === '') {
          errors.push({
            field: `${pathPrefix}.realitySettings.shortId`,
            type: 'error',
            code: 'MISSING_REALITY_SHORT_ID',
            message: 'REALITY client requires shortId.',
          });
          verification.semantic = 'fail';
        } else {
          const sidCheck = validateShortId(sid);
          if (!sidCheck.valid) {
            errors.push({
              field: `${pathPrefix}.realitySettings.shortId`,
              type: 'error',
              code: 'INVALID_REALITY_SHORT_ID',
              message: `Invalid client short ID "${sid}": ${sidCheck.error}`,
            });
            verification.semantic = 'fail';
          }
        }

        // 3. ServerName (SNI)
        const serverName = reality.serverName || reality.serverNames?.[0];
        if (!serverName || !serverName.trim()) {
          errors.push({
            field: `${pathPrefix}.realitySettings.serverName`,
            type: 'error',
            code: 'INVALID_SNI',
            message: 'REALITY client requires serverName for TLS SNI masquerade.',
          });
          verification.semantic = 'fail';
        }

        // 4. Fingerprint
        if (!reality.fingerprint) {
          warnings.push({
            field: `${pathPrefix}.realitySettings.fingerprint`,
            type: 'warning',
            message: 'REALITY client fingerprint not set; recommends chrome/firefox for uTLS mimicry.',
          });
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

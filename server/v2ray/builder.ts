import crypto from 'crypto';
import {
  V2RayBuilderParams,
  V2RayConfigModel,
  V2RayInbound,
  V2RayOutbound,
  V2RayRouting,
  V2RayStreamSettings,
} from './models';
import {
  generateRealityKeyPair,
  generateShortId,
  isPlaceholderString,
  classifyRealityKey,
  validateShortId,
} from './crypto';

export interface ParsedShareLink {
  protocol: string;
  uuid: string;
  host: string;
  port: number;
  transport?: string;
  security?: string;
  sni?: string;
  publicKey?: string;
  shortId?: string;
  flow?: string;
  fingerprint?: string;
  wsPath?: string;
  grpcServiceName?: string;
  remark?: string;
}

export class V2RayBuilder {
  public static generateUUID(): string {
    return crypto.randomUUID();
  }

  public static generateRealityKeyPair(): { privateKey: string; publicKey: string } {
    return generateRealityKeyPair();
  }

  public static generateShortId(bytes = 8): string {
    return generateShortId(bytes);
  }

  public static buildConfig(params: V2RayBuilderParams): { config: V2RayConfigModel; shareLink?: string; summary: string } {
    const isServer = params.role === 'server';
    const uuid = params.uuid || this.generateUUID();
    const transport = params.transport || 'tcp';
    const security = params.security || 'none';
    const flow = params.flow || (security === 'reality' ? 'xtls-rprx-vision' : undefined);

    // Validate flow compatibility
    if (flow) {
      if (flow !== 'xtls-rprx-vision' && flow !== 'none' && flow !== '') {
        throw new Error(`UNSUPPORTED_FLOW: Flow '${flow}' is not supported. Supported flows: xtls-rprx-vision, none`);
      }
      if (flow === 'xtls-rprx-vision') {
        if (params.protocol !== 'vless') {
          throw new Error(`UNSUPPORTED_FLOW: xtls-rprx-vision requires protocol 'vless', got '${params.protocol}'`);
        }
        if (transport !== 'tcp') {
          throw new Error(`UNSUPPORTED_FLOW: xtls-rprx-vision requires transport 'tcp', got '${transport}'`);
        }
        if (security !== 'tls' && security !== 'reality') {
          throw new Error(`UNSUPPORTED_FLOW: xtls-rprx-vision requires security 'tls' or 'reality', got '${security}'`);
        }
      }
    }

    // Ports and Host distinction (Phase 1, 6, 7)
    // Server: inbound listens on serverPort (default 443) on listenAddress (default 0.0.0.0)
    // Client: inbounds listen on localSocksPort (default 10808) and localHttpPort (default 10809)
    //         outbound connects to remote serverAddress on serverPort (default 443)
    let serverHost = '';
    let serverPort = 443;
    let localSocksPort = 10808;
    let localHttpPort = 10809;
    let listen = '0.0.0.0';

    if (isServer) {
      serverPort = params.serverPort || params.port || 443;
      listen = params.listenAddress || '0.0.0.0';
      serverHost = params.serverAddress || '';
    } else {
      // Client configuration
      // CRITICAL: NEVER infer 127.0.0.1 merely because serverAddress was omitted
      if (params.serverAddress) {
        serverHost = params.serverAddress;
      } else if (params.allowLocalServer) {
        serverHost = '127.0.0.1';
      } else {
        // Missing server address - do NOT default to 127.0.0.1
        serverHost = '';
      }

      serverPort = params.serverPort || params.port || 443;
      localSocksPort = params.localSocksPort || (params.port && params.port !== 443 ? params.port : 10808);
      localHttpPort = params.localHttpPort || (localSocksPort + 1);
      listen = params.listenAddress || '127.0.0.1';
    }

    const remark = params.remark || `${params.protocol.toUpperCase()}-${transport.toUpperCase()}-${security.toUpperCase()}`;

    // Build StreamSettings
    const streamSettings: V2RayStreamSettings = {
      network: transport,
      security: security,
    };

    if (security === 'tls') {
      streamSettings.tlsSettings = {
        serverName: params.sni || (isServer ? undefined : (serverHost || undefined)),
        allowInsecure: false,
        fingerprint: params.fingerprint || 'chrome',
        alpn: ['h2', 'http/1.1'],
      };
      if (isServer) {
        streamSettings.tlsSettings.certificates = [
          {
            certificateFile: '/etc/ssl/certs/fullchain.pem',
            keyFile: '/etc/ssl/private/privkey.pem',
          },
        ];
      }
    } else if (security === 'reality') {
      if (isServer) {
        // REALITY Server Settings (Phase 2, 3, 12, 13)
        let privateKey = params.realityPrivateKey;
        let shortIds = params.realityShortIds;
        if (!shortIds && params.realityShortId) {
          shortIds = [params.realityShortId];
        }

        if (!privateKey && params.autoGenerateKeys) {
          const kp = generateRealityKeyPair();
          privateKey = kp.privateKey;
          if (!shortIds || shortIds.length === 0) {
            shortIds = [generateShortId(8)];
          }
        }

        streamSettings.realitySettings = {
          show: false,
          dest: params.realityDest || (params.sni ? `${params.sni}:443` : undefined),
          target: params.realityDest || (params.sni ? `${params.sni}:443` : undefined),
          serverNames: params.sni ? [params.sni] : undefined,
          privateKey: privateKey, // May be undefined if not provided; validator will reject missing/placeholder
          shortIds: shortIds,
        };
      } else {
        // REALITY Client Settings (Phase 4, 12, 13)
        let publicKey = params.realityPublicKey;
        const shortId = params.realityShortId || (params.realityShortIds?.[0]) || undefined;

        if (!publicKey && params.autoGenerateKeys) {
          const kp = generateRealityKeyPair();
          publicKey = kp.publicKey;
        }

        streamSettings.realitySettings = {
          serverName: params.sni,
          serverNames: params.sni ? [params.sni] : undefined,
          publicKey: publicKey,
          password: publicKey, // modern Xray alias
          shortId: shortId,
          shortIds: shortId ? [shortId] : undefined,
          fingerprint: params.fingerprint || 'chrome',
          spiderX: '/',
        };
      }
    }

    if (transport === 'ws') {
      streamSettings.wsSettings = {
        path: params.wsPath || '/ws',
        headers: {
          Host: params.sni || serverHost || 'localhost',
        },
      };
    } else if (transport === 'grpc') {
      streamSettings.grpcSettings = {
        serviceName: params.grpcServiceName || 'grpc-service',
        multiMode: true,
      };
    } else if (transport === 'httpupgrade') {
      streamSettings.httpupgradeSettings = {
        path: params.wsPath || '/httpupgrade',
        host: params.sni || serverHost || 'localhost',
      };
    }

    const inbounds: V2RayInbound[] = [];
    const outbounds: V2RayOutbound[] = [];

    if (isServer) {
      // SERVER INBOUND
      let inboundSettings: Record<string, any> = {};

      if (params.protocol === 'vless') {
        inboundSettings = {
          clients: [
            {
              id: uuid,
              flow: flow === 'none' ? undefined : flow,
              email: `${remark}@v2ray-engine`,
            },
          ],
          decryption: 'none',
        };
      } else if (params.protocol === 'vmess') {
        inboundSettings = {
          clients: [
            {
              id: uuid,
              alterId: params.alterId || 0,
              email: `${remark}@v2ray-engine`,
            },
          ],
        };
      } else if (params.protocol === 'trojan') {
        inboundSettings = {
          clients: [
            {
              password: params.password || uuid,
              email: `${remark}@v2ray-engine`,
            },
          ],
        };
      } else if (params.protocol === 'shadowsocks') {
        inboundSettings = {
          method: params.shadowsocksMethod || '2022-blake3-aes-128-gcm',
          password: params.password || 'SecretPasswordKey123',
          network: 'tcp,udp',
        };
      }

      inbounds.push({
        tag: 'inbound-main',
        port: serverPort,
        listen: listen,
        protocol: params.protocol,
        settings: inboundSettings,
        streamSettings,
        sniffing: {
          enabled: params.enableSniffing !== false,
          destOverride: ['http', 'tls', 'quic'],
          metadataOnly: false,
        },
      });

      // SERVER OUTBOUNDS
      outbounds.push({
        tag: 'direct',
        protocol: 'freedom',
        settings: {},
      });
      outbounds.push({
        tag: 'block',
        protocol: 'blackhole',
        settings: { response: { type: 'none' } },
      });
    } else {
      // CLIENT INBOUNDS (Local SOCKS & HTTP proxies)
      inbounds.push({
        tag: 'socks-in',
        port: localSocksPort,
        listen: listen,
        protocol: 'socks',
        settings: {
          auth: 'noauth',
          udp: true,
        },
        sniffing: {
          enabled: true,
          destOverride: ['http', 'tls'],
        },
      });
      inbounds.push({
        tag: 'http-in',
        port: localHttpPort,
        listen: listen,
        protocol: 'http',
        settings: {},
      });

      // CLIENT OUTBOUND (Connects to Server)
      let outboundSettings: Record<string, any> = {};

      if (params.protocol === 'vless') {
        outboundSettings = {
          vnext: [
            {
              address: serverHost,
              port: serverPort,
              users: [
                {
                  id: uuid,
                  encryption: 'none',
                  flow: flow === 'none' ? undefined : flow,
                },
              ],
            },
          ],
        };
      } else if (params.protocol === 'vmess') {
        outboundSettings = {
          vnext: [
            {
              address: serverHost,
              port: serverPort,
              users: [
                {
                  id: uuid,
                  alterId: params.alterId || 0,
                  security: 'auto',
                },
              ],
            },
          ],
        };
      } else if (params.protocol === 'trojan') {
        outboundSettings = {
          servers: [
            {
              address: serverHost,
              port: serverPort,
              password: params.password || uuid,
            },
          ],
        };
      } else if (params.protocol === 'shadowsocks') {
        outboundSettings = {
          servers: [
            {
              address: serverHost,
              port: serverPort,
              method: params.shadowsocksMethod || '2022-blake3-aes-128-gcm',
              password: params.password || 'SecretPasswordKey123',
            },
          ],
        };
      }

      outbounds.push({
        tag: 'proxy',
        protocol: params.protocol,
        settings: outboundSettings,
        streamSettings,
        mux: {
          enabled: transport !== 'grpc' && security !== 'reality',
          concurrency: 8,
        },
      });

      outbounds.push({
        tag: 'direct',
        protocol: 'freedom',
        settings: {},
      });

      outbounds.push({
        tag: 'block',
        protocol: 'blackhole',
        settings: { response: { type: 'none' } },
      });
    }

    // Routing Rules
    const routingRules: any[] = [];
    if (params.blockPrivateIps) {
      routingRules.push({
        type: 'field',
        ip: ['geoip:private'],
        outboundTag: isServer ? 'block' : 'direct',
      });
    }
    if (params.blockAds) {
      routingRules.push({
        type: 'field',
        domain: ['geosite:category-ads-all'],
        outboundTag: 'block',
      });
    }

    const routing: V2RayRouting = {
      domainStrategy: 'IPIfNonMatch',
      rules: routingRules,
    };

    const config: V2RayConfigModel = {
      log: {
        loglevel: 'warning',
      },
      inbounds,
      outbounds,
      routing,
      dns: {
        servers: params.customDnsServers && params.customDnsServers.length > 0 ? params.customDnsServers : ['1.1.1.1', '8.8.8.8', 'localhost'],
        queryStrategy: 'UseIPv4',
      },
    };

    // Generate Share Link (Phase 8 & 9)
    // Only generate if required connection parameters are present and complete!
    let shareLink: string | undefined;
    const shareLinkHost = isServer ? (params.serverAddress || '') : serverHost;
    const shareLinkPort = serverPort;

    const canGenerateShareLink = this.canGenerateShareLink({
      ...params,
      uuid,
      serverAddress: shareLinkHost,
      serverPort: shareLinkPort,
      flow,
    });

    if (canGenerateShareLink.canGenerate) {
      shareLink = this.buildShareLink(params, uuid, shareLinkHost, shareLinkPort, remark, flow);

      // Phase 9: Share Link Round-Trip Invariant Test
      if (shareLink && params.protocol === 'vless') {
        const parsed = this.parseShareLink(shareLink);
        const roundTripMatches =
          parsed.uuid === uuid &&
          parsed.host === shareLinkHost &&
          parsed.port === shareLinkPort &&
          parsed.transport === transport &&
          parsed.security === security &&
          (!params.sni || parsed.sni === params.sni);

        if (!roundTripMatches) {
          throw new Error(`INCOMPLETE_SHARE_LINK: Generated share link failed round-trip equivalence verification.`);
        }
      }
    }

    let summary = `Generated ${isServer ? 'Server' : 'Client'} Configuration for ${params.protocol.toUpperCase()} over ${transport.toUpperCase()} with ${security.toUpperCase()} security.`;
    if (!shareLink) {
      summary += ` [SHARE_LINK_NOT_GENERATED: ${canGenerateShareLink.reason}]`;
    }

    return { config, shareLink, summary };
  }

  /**
   * Check whether all required parameters exist to build an interoperable share link.
   * (Phase 4, 8)
   */
  public static canGenerateShareLink(params: {
    protocol: string;
    uuid: string;
    serverAddress?: string;
    serverPort: number;
    security: string;
    sni?: string;
    realityPublicKey?: string;
    realityShortId?: string;
    realityShortIds?: string[];
    fingerprint?: string;
    allowLocalServer?: boolean;
    flow?: string;
  }): { canGenerate: boolean; reason?: string } {
    if (!params.serverAddress || !params.serverAddress.trim()) {
      return { canGenerate: false, reason: 'missing remote serverAddress' };
    }
    if ((params.serverAddress === '127.0.0.1' || params.serverAddress === 'localhost') && !params.allowLocalServer) {
      return { canGenerate: false, reason: 'serverAddress cannot be 127.0.0.1 without allowLocalServer' };
    }
    if (!params.serverPort || params.serverPort < 1 || params.serverPort > 65535) {
      return { canGenerate: false, reason: 'invalid serverPort' };
    }
    if (!params.uuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.uuid)) {
      return { canGenerate: false, reason: 'invalid or missing uuid' };
    }

    if (params.security === 'reality') {
      if (!params.sni || !params.sni.trim()) {
        return { canGenerate: false, reason: 'missing sni / serverName' };
      }
      const pubKeyClass = classifyRealityKey(params.realityPublicKey);
      if (pubKeyClass !== 'valid-looking') {
        return { canGenerate: false, reason: `realityPublicKey is ${pubKeyClass}` };
      }
      const sid = params.realityShortId || params.realityShortIds?.[0];
      const sidCheck = validateShortId(sid);
      if (!sidCheck.valid) {
        return { canGenerate: false, reason: `realityShortId is invalid: ${sidCheck.error}` };
      }
      if (!params.fingerprint) {
        return { canGenerate: false, reason: 'missing reality fingerprint' };
      }
    }

    return { canGenerate: true };
  }

  public static buildShareLink(
    params: V2RayBuilderParams,
    uuid: string,
    host: string,
    port: number,
    remark: string,
    flow?: string
  ): string {
    const protocol = params.protocol;
    const transport = params.transport;
    const security = params.security;
    const encodedRemark = encodeURIComponent(remark);

    if (protocol === 'vless') {
      const query = new URLSearchParams();
      query.set('type', transport);
      query.set('security', security);
      if (params.sni) query.set('sni', params.sni);
      if (params.fingerprint) query.set('fp', params.fingerprint);
      if (security === 'reality') {
        if (params.realityPublicKey) query.set('pbk', params.realityPublicKey);
        const sid = params.realityShortId || params.realityShortIds?.[0];
        if (sid) query.set('sid', sid);
        const resolvedFlow = flow || params.flow;
        if (resolvedFlow && resolvedFlow !== 'none') query.set('flow', resolvedFlow);
      }
      if (transport === 'ws') {
        query.set('path', params.wsPath || '/ws');
        if (params.sni) query.set('host', params.sni);
      } else if (transport === 'grpc') {
        query.set('serviceName', params.grpcServiceName || 'grpc-service');
        query.set('mode', 'multi');
      }
      return `vless://${uuid}@${host}:${port}?${query.toString()}#${encodedRemark}`;
    }

    if (protocol === 'vmess') {
      const vmessObj = {
        v: '2',
        ps: remark,
        add: host,
        port: String(port),
        id: uuid,
        aid: String(params.alterId || 0),
        scy: 'auto',
        net: transport,
        type: 'none',
        host: params.sni || '',
        path: params.wsPath || (transport === 'ws' ? '/ws' : ''),
        tls: security === 'tls' ? 'tls' : '',
        sni: params.sni || '',
        alpn: 'h2,http/1.1',
        fp: params.fingerprint || 'chrome',
      };
      const b64 = Buffer.from(JSON.stringify(vmessObj)).toString('base64');
      return `vmess://${b64}`;
    }

    if (protocol === 'trojan') {
      const query = new URLSearchParams();
      query.set('security', security);
      if (params.sni) query.set('sni', params.sni);
      if (transport === 'ws') query.set('type', 'ws');
      if (transport === 'grpc') query.set('type', 'grpc');
      return `trojan://${params.password || uuid}@${host}:${port}?${query.toString()}#${encodedRemark}`;
    }

    if (protocol === 'shadowsocks') {
      const method = params.shadowsocksMethod || '2022-blake3-aes-128-gcm';
      const pass = params.password || 'SecretPasswordKey123';
      const userinfo = Buffer.from(`${method}:${pass}`).toString('base64');
      return `ss://${userinfo}@${host}:${port}#${encodedRemark}`;
    }

    return '';
  }

  /**
   * Parse a share link URL into structured components (Phase 9).
   */
  public static parseShareLink(link: string): ParsedShareLink {
    if (!link || typeof link !== 'string') {
      throw new Error('Link must be a non-empty string');
    }

    const hashIdx = link.indexOf('#');
    let remark = '';
    let mainUrl = link;
    if (hashIdx !== -1) {
      remark = decodeURIComponent(link.substring(hashIdx + 1));
      mainUrl = link.substring(0, hashIdx);
    }

    if (mainUrl.startsWith('vless://')) {
      const withoutProto = mainUrl.slice(8);
      const atIdx = withoutProto.indexOf('@');
      if (atIdx === -1) throw new Error('Malformed vless link: missing @');
      const uuid = withoutProto.substring(0, atIdx);
      const afterAt = withoutProto.substring(atIdx + 1);
      const qIdx = afterAt.indexOf('?');
      const hostPort = qIdx === -1 ? afterAt : afterAt.substring(0, qIdx);
      const queryString = qIdx === -1 ? '' : afterAt.substring(qIdx + 1);

      const colonIdx = hostPort.lastIndexOf(':');
      if (colonIdx === -1) throw new Error('Malformed vless link: missing port');
      const host = hostPort.substring(0, colonIdx);
      const port = parseInt(hostPort.substring(colonIdx + 1), 10);

      const params = new URLSearchParams(queryString);
      return {
        protocol: 'vless',
        uuid,
        host,
        port,
        transport: params.get('type') || undefined,
        security: params.get('security') || undefined,
        sni: params.get('sni') || undefined,
        publicKey: params.get('pbk') || undefined,
        shortId: params.get('sid') || undefined,
        flow: params.get('flow') || undefined,
        fingerprint: params.get('fp') || undefined,
        wsPath: params.get('path') || undefined,
        grpcServiceName: params.get('serviceName') || undefined,
        remark,
      };
    }

    if (mainUrl.startsWith('vmess://')) {
      const b64 = mainUrl.slice(8);
      const jsonStr = Buffer.from(b64, 'base64').toString('utf-8');
      const obj = JSON.parse(jsonStr);
      return {
        protocol: 'vmess',
        uuid: obj.id,
        host: obj.add,
        port: parseInt(obj.port, 10),
        transport: obj.net,
        security: obj.tls,
        sni: obj.sni,
        remark: obj.ps || remark,
      };
    }

    if (mainUrl.startsWith('trojan://')) {
      const withoutProto = mainUrl.slice(9);
      const atIdx = withoutProto.indexOf('@');
      const pass = withoutProto.substring(0, atIdx);
      const afterAt = withoutProto.substring(atIdx + 1);
      const qIdx = afterAt.indexOf('?');
      const hostPort = qIdx === -1 ? afterAt : afterAt.substring(0, qIdx);
      const colonIdx = hostPort.lastIndexOf(':');
      const host = hostPort.substring(0, colonIdx);
      const port = parseInt(hostPort.substring(colonIdx + 1), 10);
      return {
        protocol: 'trojan',
        uuid: pass,
        host,
        port,
        remark,
      };
    }

    throw new Error(`Unsupported protocol link format: ${mainUrl.slice(0, 10)}`);
  }
}

import crypto from 'crypto';
import {
  V2RayBuilderParams,
  V2RayConfigModel,
  V2RayInbound,
  V2RayOutbound,
  V2RayRouting,
  V2RayStreamSettings,
} from './models';

export class V2RayBuilder {
  public static generateUUID(): string {
    return crypto.randomUUID();
  }

  public static buildConfig(params: V2RayBuilderParams): { config: V2RayConfigModel; shareLink?: string; summary: string } {
    const isServer = params.role === 'server';
    const uuid = params.uuid || this.generateUUID();
    const port = params.port || (isServer ? 443 : 10808);
    const listen = params.listenAddress || (isServer ? '0.0.0.0' : '127.0.0.1');
    const transport = params.transport || 'tcp';
    const security = params.security || 'none';
    const serverHost = params.serverAddress || '127.0.0.1';
    const remark = params.remark || `${params.protocol.toUpperCase()}-${transport.toUpperCase()}-${security.toUpperCase()}`;

    // Build StreamSettings
    const streamSettings: V2RayStreamSettings = {
      network: transport,
      security: security,
    };

    if (security === 'tls') {
      streamSettings.tlsSettings = {
        serverName: params.sni || (isServer ? undefined : serverHost),
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
        streamSettings.realitySettings = {
          show: false,
          dest: params.realityDest || 'www.cloudflare.com:443',
          serverNames: params.sni ? [params.sni] : ['www.cloudflare.com'],
          privateKey: params.realityPrivateKey || 'aHxxxxSERVER_PRIVATE_KEY_REQUIREDxxxx',
          shortIds: params.realityShortIds || ['0123456789abcdef'],
        };
      } else {
        streamSettings.realitySettings = {
          serverNames: params.sni ? [params.sni] : ['www.cloudflare.com'],
          publicKey: params.realityPublicKey || 'aHxxxxSERVER_PUBLIC_KEYxxxx',
          shortIds: params.realityShortIds || ['0123456789abcdef'],
          fingerprint: params.fingerprint || 'chrome',
          spiderX: '/',
        };
      }
    }

    if (transport === 'ws') {
      streamSettings.wsSettings = {
        path: params.wsPath || '/ws',
        headers: {
          Host: params.sni || serverHost,
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
        host: params.sni || serverHost,
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
              flow: params.flow || (security === 'reality' ? 'xtls-rprx-vision' : undefined),
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
        port: port,
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
      // CLIENT INBOUND (Local Socks & HTTP proxy)
      inbounds.push({
        tag: 'socks-in',
        port: port,
        listen: '127.0.0.1',
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
        port: port + 1,
        listen: '127.0.0.1',
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
              port: params.port || 443,
              users: [
                {
                  id: uuid,
                  encryption: 'none',
                  flow: params.flow || (security === 'reality' ? 'xtls-rprx-vision' : undefined),
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
              port: params.port || 443,
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
              port: params.port || 443,
              password: params.password || uuid,
            },
          ],
        };
      } else if (params.protocol === 'shadowsocks') {
        outboundSettings = {
          servers: [
            {
              address: serverHost,
              port: params.port || 8388,
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

    // Default routing
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

    // Generate Share Link (for client)
    let shareLink: string | undefined;
    if (!isServer || params.serverAddress) {
      shareLink = this.buildShareLink(params, uuid, serverHost, remark);
    }

    const summary = `Generated ${isServer ? 'Server' : 'Client'} Configuration for ${params.protocol.toUpperCase()} over ${transport.toUpperCase()} with ${security.toUpperCase()} security.`;

    return { config, shareLink, summary };
  }

  public static buildShareLink(params: V2RayBuilderParams, uuid: string, host: string, remark: string): string {
    const port = params.port || 443;
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
        if (params.realityShortIds?.[0]) query.set('sid', params.realityShortIds[0]);
        if (params.flow) query.set('flow', params.flow);
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
}

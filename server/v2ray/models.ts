export type V2RayProtocol = 'vless' | 'vmess' | 'trojan' | 'shadowsocks' | 'dokodemo-door' | 'socks' | 'http';
export type V2RayTransport = 'tcp' | 'ws' | 'grpc' | 'httpupgrade' | 'quic' | 'kcp';
export type V2RaySecurity = 'none' | 'tls' | 'reality';

export interface V2RayUser {
  id?: string; // UUID for vless/vmess
  password?: string; // for trojan/shadowsocks/socks
  email?: string;
  flow?: string; // 'xtls-rprx-vision' for VLESS Reality
  alterId?: number; // for VMess legacy
  cipher?: string; // for Shadowsocks (e.g. 2022-blake3-aes-128-gcm or aes-256-gcm)
  level?: number;
}

export interface V2RayStreamSettings {
  network: V2RayTransport;
  security: V2RaySecurity;
  tlsSettings?: {
    serverName?: string;
    certificates?: Array<{
      certificateFile?: string;
      keyFile?: string;
      usage?: string;
    }>;
    alpn?: string[];
    fingerprint?: string; // 'chrome', 'firefox', 'safari', 'randomized'
    allowInsecure?: boolean;
  };
  realitySettings?: {
    show?: boolean;
    dest?: string;
    serverNames?: string[];
    privateKey?: string;
    publicKey?: string;
    shortIds?: string[];
    spiderX?: string;
    fingerprint?: string;
  };
  wsSettings?: {
    path?: string;
    headers?: Record<string, string>;
  };
  grpcSettings?: {
    serviceName?: string;
    multiMode?: boolean;
  };
  httpupgradeSettings?: {
    path?: string;
    host?: string;
  };
  tcpSettings?: {
    header?: {
      type: string;
      request?: any;
      response?: any;
    };
  };
  sockopt?: {
    mark?: number;
    tcpFastOpen?: boolean;
    tproxy?: string;
  };
}

export interface V2RayInbound {
  tag: string;
  port: number | string;
  listen: string;
  protocol: V2RayProtocol;
  settings: Record<string, any>;
  streamSettings?: V2RayStreamSettings;
  sniffing?: {
    enabled: boolean;
    destOverride: string[];
    metadataOnly?: boolean;
  };
}

export interface V2RayOutbound {
  tag: string;
  protocol: V2RayProtocol | 'freedom' | 'blackhole' | 'dns';
  settings: Record<string, any>;
  streamSettings?: V2RayStreamSettings;
  mux?: {
    enabled: boolean;
    concurrency?: number;
  };
}

export interface V2RayRoutingRule {
  type: 'field';
  domain?: string[];
  ip?: string[];
  port?: string;
  network?: string;
  source?: string[];
  user?: string[];
  inboundTag?: string[];
  protocol?: string[];
  attrs?: string;
  outboundTag: string;
  balancerTag?: string;
}

export interface V2RayRouting {
  domainStrategy?: 'AsIs' | 'IPIfNonMatch' | 'IPOnDemand';
  rules: V2RayRoutingRule[];
  balancers?: any[];
}

export interface V2RayDns {
  servers: Array<string | { address: string; port?: number; domains?: string[]; expectIPs?: string[] }>;
  queryStrategy?: 'UseIP' | 'UseIPv4' | 'UseIPv6';
}

export interface V2RayConfigModel {
  log?: {
    access?: string;
    error?: string;
    loglevel?: 'debug' | 'info' | 'warning' | 'error' | 'none';
  };
  inbounds: V2RayInbound[];
  outbounds: V2RayOutbound[];
  routing: V2RayRouting;
  dns?: V2RayDns;
  policy?: {
    system?: Record<string, any>;
    levels?: Record<string, any>;
  };
  stats?: Record<string, any>;
}

export interface V2RayBuilderParams {
  role: 'server' | 'client';
  protocol: V2RayProtocol;
  serverAddress?: string;
  port: number;
  listenAddress?: string;
  uuid?: string;
  password?: string;
  alterId?: number;
  flow?: string; // e.g. xtls-rprx-vision
  transport: V2RayTransport;
  security: V2RaySecurity;
  sni?: string;
  fingerprint?: string;
  wsPath?: string;
  grpcServiceName?: string;
  realityPublicKey?: string;
  realityPrivateKey?: string;
  realityShortIds?: string[];
  realityDest?: string;
  shadowsocksMethod?: string;
  enableSniffing?: boolean;
  blockAds?: boolean;
  blockPrivateIps?: boolean;
  customDnsServers?: string[];
  remark?: string;
}

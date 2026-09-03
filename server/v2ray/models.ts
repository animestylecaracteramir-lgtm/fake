export type V2RayProtocol = 'vless' | 'vmess' | 'trojan' | 'shadowsocks' | 'dokodemo-door' | 'socks' | 'http';
export type V2RayTransport = 'tcp' | 'ws' | 'grpc' | 'httpupgrade' | 'quic' | 'kcp';
export type V2RaySecurity = 'none' | 'tls' | 'reality';
export type VlessFlow = 'xtls-rprx-vision' | 'none' | '';

export type V2RayDomainErrorCode =
  | 'MISSING_REALITY_PRIVATE_KEY'
  | 'INVALID_REALITY_PRIVATE_KEY'
  | 'PLACEHOLDER_REALITY_KEY'
  | 'MISSING_REALITY_PUBLIC_KEY'
  | 'INVALID_REALITY_PUBLIC_KEY'
  | 'MISSING_REALITY_SHORT_ID'
  | 'INVALID_REALITY_SHORT_ID'
  | 'MISSING_REMOTE_SERVER_ADDRESS'
  | 'INVALID_REMOTE_SERVER_ADDRESS'
  | 'CLIENT_SERVER_MISMATCH'
  | 'INCOMPLETE_SHARE_LINK'
  | 'SHARE_LINK_NOT_GENERATED'
  | 'UNSUPPORTED_FLOW'
  | 'REQUEST_INCOMPLETE'
  | 'INVALID_PORT'
  | 'INVALID_UUID'
  | 'INVALID_DEST'
  | 'INVALID_SNI';

export interface VerificationState {
  structural: 'pass' | 'fail';
  semantic: 'pass' | 'fail';
  cryptographic: 'verified' | 'valid_format' | 'placeholder' | 'malformed' | 'missing' | 'not_verified';
  runtime: 'passed' | 'failed' | 'not_tested';
  interoperability: 'verified' | 'mismatch' | 'not_verified' | 'not_tested';
}

export interface RealityServerDomainModel {
  serverAddress?: string;
  serverPort: number;
  uuid: string;
  flow?: VlessFlow | string;
  transport: V2RayTransport;
  security: 'reality';
  serverNames: string[];
  privateKey: string;
  shortIds: string[];
  dest: string;
}

export interface RealityClientDomainModel {
  serverAddress: string;
  serverPort: number;
  localSocksPort?: number;
  localHttpPort?: number;
  uuid: string;
  flow?: VlessFlow | string;
  transport: V2RayTransport;
  security: 'reality';
  serverName: string;
  publicKey: string;
  shortId: string;
  fingerprint: string;
  spiderX?: string;
}

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
    target?: string;
    serverNames?: string[];
    serverName?: string;
    privateKey?: string;
    publicKey?: string;
    password?: string;
    shortIds?: string[];
    shortId?: string;
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
  port?: number;
  serverPort?: number;
  localSocksPort?: number;
  localHttpPort?: number;
  allowLocalServer?: boolean;
  autoGenerateKeys?: boolean;
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
  realityShortId?: string;
  realityDest?: string;
  shadowsocksMethod?: string;
  enableSniffing?: boolean;
  blockAds?: boolean;
  blockPrivateIps?: boolean;
  customDnsServers?: string[];
  remark?: string;
}

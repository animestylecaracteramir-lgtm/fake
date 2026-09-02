#!/usr/bin/env python3
"""
V2Ray Configuration Validator
Parses and validates V2Ray proxy configurations (ss://, vmess://, vless://, trojan://)
with protocol-aware validation instead of ICMP ping alone.
"""

import base64
import json
import re
import socket
import ssl
import sys
import time
import urllib.parse
from datetime import datetime
from typing import Any, Optional

# UUID regex pattern
UUID_PATTERN = re.compile(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
)

# Valid Shadowsocks encryption methods
VALID_SS_METHODS = {
    'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm',
    'aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb',
    'chacha20-ietf', 'chacha20-ietf-poly1305',
    'xchacha20-ietf-poly1305',
    'rc4-md5', 'none',
}

# Valid transport types
VALID_TRANSPORT_TYPES = {'tcp', 'kcp', 'ws', 'http', 'h2', 'quic', 'grpc', 'httpupgrade'}

# Valid security modes
VALID_SECURITY_MODES = {'none', 'tls', 'reality'}


class ConfigParseError(Exception):
    """Raised when configuration parsing fails."""
    pass


class ConfigResult:
    """Result of configuration validation."""
    
    def __init__(self):
        self.id = None
        self.original_config = None
        self.protocol = None
        self.server = None
        self.port = None
        self.syntax_valid = False
        self.dns = {"status": None, "resolved_ips": []}
        self.network = {"status": None, "latency_ms": None, "error": None}
        self.tls = {"required": False, "status": None, "error": None}
        self.protocol_validation = {"status": None, "error": None}
        self.functional_test = {"status": None, "latency_ms": None, "error": None}
        self.score = 0
        self.classification = None
        self.failure_reason = None
        self.source = None
        self.retrieved_at = None
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "original_config": self.original_config,
            "protocol": self.protocol,
            "server": self.server,
            "port": self.port,
            "syntax_valid": self.syntax_valid,
            "dns": self.dns,
            "network": self.network,
            "tls": self.tls,
            "protocol_validation": self.protocol_validation,
            "functional_test": self.functional_test,
            "score": self.score,
            "classification": self.classification,
            "failure_reason": self.failure_reason,
            "source": self.source,
            "retrieved_at": self.retrieved_at,
        }


def decode_base64_url_safe(data: str) -> bytes:
    """Decode base64 with URL-safe characters and missing padding."""
    data = data.replace('-', '+').replace('_', '/')
    padding = 4 - len(data) % 4
    if padding != 4:
        data += '=' * padding
    return base64.b64decode(data)


def parse_ss_uri(uri: str) -> dict:
    """Parse Shadowsocks URI format: ss://base64(method:password@host:port)#remarks"""
    if not uri.startswith('ss://'):
        raise ConfigParseError("Invalid ss:// URI scheme")
    
    remainder = uri[5:]
    remarks = None
    if '#' in remainder:
        remainder, remarks = remainder.split('#', 1)
        remarks = urllib.parse.unquote(remarks)
    
    try:
        decoded = decode_base64_url_safe(remainder).decode('utf-8')
    except Exception as e:
        raise ConfigParseError(f"Base64 decode failed: {e}")
    
    match = re.match(r'^([^@]+)@(.+)$', decoded)
    if not match:
        raise ConfigParseError("Invalid ss:// format: missing @ separator")
    
    method_password = match.group(1)
    host_port = match.group(2)
    
    if ':' not in method_password:
        raise ConfigParseError("Invalid ss:// format: missing method:password")
    
    method, password = method_password.split(':', 1)
    
    if host_port.startswith('['):
        match = re.match(r'^\[(.+)\]:(\d+)$', host_port)
        if not match:
            raise ConfigParseError("Invalid ss:// host:port format for IPv6")
        server = match.group(1)
        port = int(match.group(2))
    else:
        parts = host_port.rsplit(':', 1)
        if len(parts) != 2:
            raise ConfigParseError("Invalid ss:// host:port format")
        server = parts[0]
        try:
            port = int(parts[1])
        except ValueError:
            raise ConfigParseError(f"Invalid port: {parts[1]}")
    
    return {
        "protocol": "ss",
        "server": server,
        "port": port,
        "method": method.lower(),
        "password": password,
        "remarks": remarks,
        "original_config": uri,
    }


def parse_vmess_uri(uri: str) -> dict:
    """Parse VMess URI format: vmess://base64(JSON)"""
    if not uri.startswith('vmess://'):
        raise ConfigParseError("Invalid vmess:// URI scheme")
    
    remainder = uri[8:]
    
    try:
        decoded = decode_base64_url_safe(remainder).decode('utf-8')
    except Exception as e:
        raise ConfigParseError(f"Base64 decode failed: {e}")
    
    try:
        data = json.loads(decoded)
    except json.JSONDecodeError as e:
        raise ConfigParseError(f"JSON decode failed: {e}")
    
    server = data.get('add') or data.get('add')
    port = data.get('port', 443)
    uuid = data.get('id') or data.get('uuid')
    aid = data.get('aid') or data.get('alterId', 0)
    scy = data.get('scy') or data.get('security', 'auto')
    network = data.get('type') or data.get('net') or 'tcp'
    path = data.get('path') or ''
    host = data.get('host') or ''
    sni = data.get('sni') or host
    fp = data.get('fp') or ''
    alpn = data.get('alpn') or ''
    remarks = data.get('ps') or data.get('remarks') or ''
    tls = data.get('tls') or 'none'
    
    if uuid and ']' in uuid:
        uuid = uuid.replace(']', '-')
    
    return {
        "protocol": "vmess",
        "server": server,
        "port": int(port) if port else 443,
        "uuid": uuid,
        "aid": int(aid) if aid else 0,
        "security": scy,
        "transport": network,
        "path": path,
        "host": host,
        "sni": sni,
        "fingerprint": fp,
        "alpn": alpn,
        "remarks": remarks,
        "tls": tls,
        "original_config": uri,
    }


def parse_vless_uri(uri: str) -> dict:
    """Parse VLESS URI format: vless://uuid@host:port?params"""
    if not uri.startswith('vless://'):
        raise ConfigParseError("Invalid vless:// URI scheme")
    
    parsed = urllib.parse.urlparse(uri)
    
    uuid = parsed.username or ''
    if not uuid:
        path_parts = parsed.path.lstrip('/').split('@', 1)
        if len(path_parts) == 2:
            uuid = path_parts[0]
    
    host = parsed.hostname or ''
    port = parsed.port or 443
    
    params = urllib.parse.parse_qs(parsed.query or '')
    
    security = params.get('security', ['none'])[0]
    encryption = params.get('encryption', ['none'])[0]
    transport = params.get('type', ['tcp'])[0]
    path = params.get('path', [''])[0]
    sni = params.get('sni', [host])[0]
    fp = params.get('fp', [''])[0]
    alpn = params.get('alpn', [''])[0]
    pbk = params.get('pbk', [''])[0]
    sid = params.get('sid', [''])[0]
    
    remarks = urllib.parse.unquote(parsed.fragment) if parsed.fragment else ''
    
    return {
        "protocol": "vless",
        "server": host,
        "port": int(port),
        "uuid": uuid,
        "security": security,
        "transport": transport,
        "path": path,
        "sni": sni,
        "fingerprint": fp,
        "alpn": alpn,
        "password": None,
        "remarks": remarks,
        "reality_pbk": pbk,
        "reality_sid": sid,
        "original_config": uri,
    }


def parse_trojan_uri(uri: str) -> dict:
    """Parse Trojan URI format: trojan://password@host:port?params"""
    if not uri.startswith('trojan://'):
        raise ConfigParseError("Invalid trojan:// URI scheme")
    
    parsed = urllib.parse.urlparse(uri)
    
    password = parsed.username or ''
    host = parsed.hostname or ''
    port = parsed.port or 443
    
    params = urllib.parse.parse_qs(parsed.query or '')
    
    sni = params.get('sni', [host])[0]
    transport = params.get('type', ['tcp'])[0]
    path = params.get('path', [''])[0]
    serviceName = params.get('serviceName', [''])[0]
    
    remarks = urllib.parse.unquote(parsed.fragment) if parsed.fragment else ''
    
    return {
        "protocol": "trojan",
        "server": host,
        "port": int(port),
        "password": password,
        "sni": sni,
        "transport": transport,
        "path": path,
        "serviceName": serviceName,
        "remarks": remarks,
        "original_config": uri,
    }


def detect_protocol(uri: str) -> Optional[str]:
    """Detect protocol from URI scheme."""
    if uri.startswith('ss://'):
        return 'ss'
    elif uri.startswith('vmess://'):
        return 'vmess'
    elif uri.startswith('vless://'):
        return 'vless'
    elif uri.startswith('trojan://'):
        return 'trojan'
    return None


def parse_config(uri: str) -> dict:
    """Parse a configuration URI and return normalized data."""
    protocol = detect_protocol(uri)
    if not protocol:
        raise ConfigParseError(f"Unsupported protocol scheme in: {uri}")
    
    parsers = {
        'ss': parse_ss_uri,
        'vmess': parse_vmess_uri,
        'vless': parse_vless_uri,
        'trojan': parse_trojan_uri,
    }
    
    return parsers[protocol](uri)


def validate_syntax(parsed: dict) -> tuple[bool, Optional[str]]:
    """Validate syntax of parsed configuration."""
    protocol = parsed.get('protocol')
    
    if protocol == 'ss':
        if not parsed.get('server'):
            return False, "Missing server"
        if not parsed.get('port') or not (1 <= parsed['port'] <= 65535):
            return False, "Invalid port"
        if not parsed.get('method'):
            return False, "Missing method"
        if parsed.get('method') not in VALID_SS_METHODS:
            return False, f"Unsupported method: {parsed.get('method')}"
        if not parsed.get('password'):
            return False, "Missing password"
    
    elif protocol == 'vmess':
        if not parsed.get('server'):
            return False, "Missing server"
        if not parsed.get('port') or not (1 <= parsed['port'] <= 65535):
            return False, "Invalid port"
        if not parsed.get('uuid'):
            return False, "Missing UUID"
        if not UUID_PATTERN.match(parsed.get('uuid', '')):
            return False, f"Invalid UUID format: {parsed.get('uuid')}"
    
    elif protocol == 'vless':
        if not parsed.get('server'):
            return False, "Missing server"
        if not parsed.get('port') or not (1 <= parsed['port'] <= 65535):
            return False, "Invalid port"
        if not parsed.get('uuid'):
            return False, "Missing UUID"
        if not UUID_PATTERN.match(parsed.get('uuid', '')):
            return False, f"Invalid UUID format: {parsed.get('uuid')}"
    
    elif protocol == 'trojan':
        if not parsed.get('server'):
            return False, "Missing server"
        if not parsed.get('port') or not (1 <= parsed['port'] <= 65535):
            return False, "Invalid port"
        if not parsed.get('password'):
            return False, "Missing password"
    
    return True, None


def resolve_dns(server: str, timeout: int = 5) -> tuple[str, list[str]]:
    """Resolve DNS for server hostname."""
    try:
        socket.inet_aton(server)
        return "resolved", [server]
    except socket.error:
        pass
    
    try:
        start = time.time()
        infos = socket.getaddrinfo(server, None, socket.AF_INET, socket.SOCK_STREAM)
        elapsed = (time.time() - start) * 1000
        
        ips = list(set(info[4][0] for info in infos))
        if ips:
            return "resolved", ips
        return "no_records", []
    except socket.gaierror as e:
        return "failed", []
    except Exception as e:
        return "error", []


def test_tcp_connectivity(server: str, port: int, timeout: int = 10) -> tuple[str, Optional[float], Optional[str]]:
    """Test TCP connectivity to server:port."""
    try:
        start = time.time()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        
        result = sock.connect_ex((server, port))
        elapsed = (time.time() - start) * 1000
        
        sock.close()
        
        if result == 0:
            return "open", elapsed, None
        elif result == 111:
            return "refused", elapsed, "Connection refused"
        elif result == 110:
            return "timeout", elapsed, "Connection timeout"
        else:
            return "closed", elapsed, f"Connection failed with code {result}"
    except socket.timeout:
        return "timeout", None, "Socket timeout"
    except socket.gaierror:
        return "dns_error", None, "DNS resolution error"
    except Exception as e:
        return "error", None, str(e)


def test_tls_handshake(server: str, port: int, sni: str = None, timeout: int = 10) -> tuple[str, Optional[str]]:
    """Test TLS handshake with server."""
    try:
        context = ssl.create_default_context()
        
        with socket.create_connection((server, port), timeout=timeout) as sock:
            with context.wrap_socket(sock, server_hostname=sni or server) as ssock:
                cert = ssock.getpeercert()
                if cert:
                    return "success", None
                return "no_cert", "No certificate received"
    except ssl.SSLError as e:
        return "failed", f"SSL error: {e}"
    except socket.timeout:
        return "timeout", "TLS handshake timeout"
    except Exception as e:
        return "error", str(e)


def validate_protocol_aware(parsed: dict, dns_status: str, network_status: str) -> tuple[str, Optional[str]]:
    """Perform protocol-aware validation."""
    protocol = parsed.get('protocol')
    
    if protocol == 'ss':
        if not parsed.get('method') or not parsed.get('password'):
            return "failed", "Missing required credentials"
        return "success", None
    
    elif protocol == 'vmess':
        if not UUID_PATTERN.match(parsed.get('uuid', '')):
            return "failed", "Invalid UUID format"
        return "success", None
    
    elif protocol == 'vless':
        if not UUID_PATTERN.match(parsed.get('uuid', '')):
            return "failed", "Invalid UUID format"
        security = parsed.get('security', 'none')
        transport = parsed.get('transport', 'tcp')
        if security == 'reality' and transport not in ('tcp', 'grpc', 'ws'):
            return "warning", "Unusual reality transport combination"
        return "success", None
    
    elif protocol == 'trojan':
        if not parsed.get('password'):
            return "failed", "Missing password"
        return "success", None
    
    return "unknown", "Protocol not recognized"


def calculate_score(
    syntax_valid: bool,
    dns_status: str,
    network_status: str,
    tls_status: Optional[str],
    protocol_status: str,
    functional_status: Optional[str],
) -> tuple[int, str]:
    """Calculate confidence score and classification."""
    score = 0
    
    if syntax_valid:
        score += 15
    
    if dns_status == "resolved":
        score += 10
    elif dns_status == "no_records":
        score += 5
    
    if network_status == "open":
        score += 15
    elif network_status in ("refused", "closed"):
        score += 5
    
    if tls_status == "success":
        score += 15
    elif tls_status == "failed":
        score += 5
    
    if protocol_status == "success":
        score += 25
    elif protocol_status == "warning":
        score += 15
    
    if functional_status == "success":
        score += 20
    
    if score >= 90:
        classification = "working"
    elif score >= 70:
        classification = "likely_working"
    elif score >= 40:
        classification = "partially_validated"
    elif score >= 1:
        classification = "invalid_or_unreachable"
    else:
        classification = "invalid"
    
    return score, classification


def validate_config(uri: str, source: str = None, retrieved_at: str = None) -> dict:
    """
    Main validation function.
    Parses, validates syntax, tests DNS, network, TLS, and protocol.
    """
    result = ConfigResult()
    result.original_config = uri
    result.source = source
    result.retrieved_at = retrieved_at or datetime.utcnow().isoformat() + "Z"
    
    # Step 1: Parse
    try:
        parsed = parse_config(uri)
    except ConfigParseError as e:
        result.syntax_valid = False
        result.failure_reason = f"Parse error: {e}"
        result.classification = "syntax_invalid"
        return result.to_dict()
    
    result.protocol = parsed.get('protocol')
    result.server = parsed.get('server')
    result.port = parsed.get('port')
    
    # Step 2: Syntax validation
    syntax_valid, syntax_error = validate_syntax(parsed)
    result.syntax_valid = syntax_valid
    if not syntax_valid:
        result.failure_reason = f"Syntax error: {syntax_error}"
        result.classification = "syntax_invalid"
        return result.to_dict()
    
    # Step 3: DNS resolution
    dns_status, resolved_ips = resolve_dns(parsed.get('server', ''))
    result.dns = {"status": dns_status, "resolved_ips": resolved_ips}
    
    if dns_status == "failed":
        result.failure_reason = "DNS resolution failed"
        result.classification = "dns_failed"
        return result.to_dict()
    
    # Step 4: Network connectivity test
    network_status, latency_ms, network_error = test_tcp_connectivity(
        parsed.get('server', ''),
        parsed.get('port', 443),
    )
    result.network = {
        "status": network_status,
        "latency_ms": latency_ms,
        "error": network_error,
    }
    
    if network_status in ("timeout", "dns_error"):
        result.failure_reason = f"Network unreachable: {network_error}"
        result.classification = "unreachable"
        return result.to_dict()
    
    # Step 5: TLS validation (if required)
    tls_required = False
    if parsed.get('protocol') in ('vless', 'trojan', 'vmess'):
        if parsed.get('security') == 'tls' or parsed.get('tls') == 'tls':
            tls_required = True
    
    if tls_required:
        tls_status, tls_error = test_tls_handshake(
            parsed.get('server', ''),
            parsed.get('port', 443),
            parsed.get('sni'),
        )
        result.tls = {"required": True, "status": tls_status, "error": tls_error}
        
        if tls_status == "failed":
            result.failure_reason = f"TLS handshake failed: {tls_error}"
            result.classification = "tls_failed"
            return result.to_dict()
    
    # Step 6: Protocol-aware validation
    protocol_status, protocol_error = validate_protocol_aware(parsed, dns_status, network_status)
    result.protocol_validation = {"status": protocol_status, "error": protocol_error}
    
    if protocol_status == "failed":
        result.failure_reason = f"Protocol validation failed: {protocol_error}"
        result.classification = "protocol_failed"
        return result.to_dict()
    
    # Step 7: Calculate score and classification
    score, classification = calculate_score(
        syntax_valid,
        dns_status,
        network_status,
        result.tls.get('status') if tls_required else None,
        protocol_status,
        None,  # functional_test not performed by default
    )
    
    result.score = score
    result.classification = classification
    
    if classification == "working":
        result.failure_reason = None
    elif classification == "likely_working":
        result.failure_reason = "Partial validation - network open but TLS/protocol not fully tested"
    elif classification == "partially_validated":
        result.failure_reason = "Limited validation - syntax and DNS passed but connectivity incomplete"
    else:
        result.failure_reason = "Configuration failed validation"
    
    return result.to_dict()


def main():
    """CLI entry point for testing."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Validate V2Ray proxy configurations')
    parser.add_argument('uri', help='Proxy configuration URI (ss://, vmess://, vless://, trojan://)')
    parser.add_argument('--source', help='Source URL or identifier')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    
    args = parser.parse_args()
    
   
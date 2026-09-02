# V2Ray/Xray Configuration for Iran - Complete Setup Guide

## Overview

This configuration package provides a robust V2Ray/Xray setup optimized for bypassing internet restrictions in Iran. It uses the latest **VLESS + Reality + WebSocket + TLS** protocol stack, which is currently one of the most effective methods for evading deep packet inspection (DPI).

## Architecture

### Server Configuration (`v2ray_server_iran_reality_ws.json`)
- **Protocol**: VLESS with Reality security
- **Transport**: WebSocket over TLS (port 443)
- **Fallback**: TCP Reality on port 8443
- **Features**: 
  - Ad blocking (including Iranian ads)
  - Direct routing for Iranian IPs
  - DNS poisoning protection
  - Bittorrent blocking
  - Statistics tracking

### Client Configuration (`v2ray_client_iran_reality_ws.json`)
- **Local SOCKS proxy**: 127.0.0.1:10808
- **Local HTTP proxy**: 127.0.0.1:10809
- **Features**:
  - Reality TLS verification
  - Chrome fingerprint spoofing
  - Optimized DNS resolution
  - Geo-based routing

## Prerequisites

### Server Requirements
- VPS with public IP (preferably outside Iran)
- Ubuntu 20.04+ or Debian 11+
- Open ports: 443 (TLS), 8443 (fallback)
- Domain name pointing to server IP

### Client Requirements
- Any device (Windows, macOS, Linux, Android, iOS)
- Xray-core or V2Ray client installed

## Setup Instructions

### Step 1: Generate Reality Keys

On your server, generate Reality key pairs:

```bash
# Using Xray-core
xray keygen -private -public -output /etc/xray/reality.key

# Or using OpenSSL
openssl ecparam -genkey -name secp256r1 -noout -out private.key
openssl ec -in private.key -pubout -out public.key
```

### Step 2: Update Server Configuration

Edit `v2ray_server_iran_reality_ws.json`:

1. Replace `YOUR_SERVER_IP` with your actual server IP
2. Replace `aHxxxxSERVER_PRIVATE_KEY_REQUIREDxxxx` with your private key
3. Update the UUID if needed (or keep the generated one)
4. Adjust `shortIds` as desired

### Step 3: Update Client Configuration

Edit `v2ray_client_iran_reality_ws.json`:

1. Replace `YOUR_SERVER_IP` with your server IP
2. Replace `YOUR_PUBLIC_KEY_HERE` with the public key from Step 1
3. Keep the same UUID as the server
4. Match the `shortId` with server configuration

### Step 4: Install Xray-core on Server

```bash
# Install Xray-core
bash -c "$(curl -L https://github.com/XTLS/Xray-core/releases/latest/download/install-release.sh)"

# Create configuration directory
sudo mkdir -p /etc/xray

# Copy server config
sudo cp v2ray_server_iran_reality_ws.json /etc/xray/config.json

# Start and enable service
sudo systemctl start xray
sudo systemctl enable xray
sudo systemctl status xray
```

### Step 5: Configure Firewall

```bash
# UFW (Ubuntu)
sudo ufw allow 443/tcp
sudo ufw allow 8443/tcp
sudo ufw enable

# Or iptables
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 8443 -j ACCEPT
```

### Step 6: Install Client

Download Xray-core for your platform:
- Windows: https://github.com/XTLS/Xray-core/releases
- macOS: https://github.com/XTLS/Xray-core/releases
- Android: use Xray-core APK or apps like "Stash"
- iOS: use "Shadowrocket" or "Stash"

## Client Connection Methods

### Method 1: Direct Config Import
Copy the entire client JSON to your device and import it.

### Method 2: Share Link
Use this URL scheme:
```
vless://UUID@SERVER_IP:443?type=ws&security=reality&sni=www.cloudflare.com&pbk=PUBLIC_KEY&sid=SHORT_ID&path=%2Fv2ray%3Fed%3D2048&host=www.cloudflare.com#Iran-Client
```

### Method 3: Manual Configuration
Enter settings manually in your client app:
- **Address**: Your server IP
- **Port**: 443
- **User ID**: 87a7b52a-f516-4ad2-a698-0d5249a777c0
- **Flow**: xtls-rprx-vision
- **Network**: WebSocket
- **Security**: Reality
- **SNI**: www.cloudflare.com
- **Public Key**: YOUR_PUBLIC_KEY
- **Short ID**: 0123456789abcdef
- **Path**: /v2ray?ed=2048
- **Host**: www.cloudflare.com

## Advanced Features

### DNS Configuration
The config uses a smart DNS strategy:
- Cloudflare (1.1.1.1) for GFW-list domains
- Google (8.8.8.8) as fallback
- Local DNS for Iranian domains
- IPv4-first query strategy

### Routing Rules
- **Block**: Private IPs, ads (global + Iranian), bittorrent
- **Direct**: Iranian IPs, Chinese domains
- **Proxy**: Everything else (via VLESS Reality)

### Performance Optimizations
- WebSocket edge padding (ed=2048) for better obfuscation
- Xray vision flow for improved throughput
- Allocate strategy for connection management
- Concurrency settings for parallel connections

## Troubleshooting

### Connection Issues
1. Verify firewall allows ports 443 and 8443
2. Check Reality key pair matches between server and client
3. Ensure SNI domain resolves correctly
4. Verify WebSocket path is correct

### Slow Speeds
1. Try different Reality destination servers
2. Adjust `concurrency` in transport settings
3. Check server bandwidth and CPU usage
4. Consider using TCP Reality fallback (port 8443)

### Blocking Detection
1. Change `shortId` values
2. Modify `spiderX` path
3. Use different SNI domains
4. Consider adding additional obfuscation layers

## Security Notes

- Keep your private key secure and never share it
- Regularly rotate UUIDs and shortIds
- Monitor server logs for unusual activity
- Keep Xray-core updated to latest version
- Use strong server passwords and SSH key authentication

## References

- Xray-core Documentation: https://xtls.github.io/
- Reality Protocol: https://github.com/XTLS/REALITY
- GeoIP/GeoSite databases: https://github.com/v2fly/domain-list-community

## License

This configuration is provided for educational purposes. Use responsibly and in accordance with local laws.

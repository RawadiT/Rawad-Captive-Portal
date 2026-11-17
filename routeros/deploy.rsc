# ==============================================================================
# RAWAD TECH CAPTIVE PORTAL — MIKROTIK ROUTEROS 7.x IDEMPOTENT DEPLOYMENT
# Target: MikroTik RB4011iGS+RM (RouterOS 7.x)
#
# ARCHITECTURE:
#   - Guest Network (ether10): 192.168.20.0/24, Gateway 192.168.20.1
#   - Staff/Management Network (ether9): Host Server runs here (e.g. 192.168.10.10)
#   - Guest Portal HTTPS Proxy: https://wifi.YOUR_COMPANY_DOMAIN.com (port 443 on backendServerIp)
#   - Admin Dashboard: Bound ONLY to Staff/localhost (never reachable from ether10)
#
# SAFETY RULES:
#   1. NEVER removes existing bridge ports or conflicting IPs automatically.
#   2. Aborts immediately if a conflict is detected.
#   3. Saves previous state in /system script "rawad-portal-state" for exact rollback.
#   4. Fully idempotent: safe to re-run without duplicating firewall rules.
# ==============================================================================

:local guestIf "ether10"
:local staffIf "ether9"
:local wanIf "ether1"
:local guestGw "192.168.20.1"
:local guestNet "192.168.20.0/24"
# IP of the server hosting the Guest Portal HTTPS reverse proxy (Nginx) on Staff/Mgmt LAN:
:local backendServerIp "192.168.10.10"
# MUST be a real company-owned domain/subdomain with a publicly-trusted TLS cert (never mDNS/private suffix):
:local portalDomain "wifi.YOUR_COMPANY_DOMAIN.com"
:local mikrotikCertName "rawad-mikrotik-cert"
:local apiPassword "CHANGE_THIS_STRONG_API_PASSWORD"

:put "=== [1/10] Pre-flight Conflict Gate (Abort on conflict, never auto-delete) ==="
:if ($portalDomain = "wifi.YOUR_COMPANY_DOMAIN.com") do={
    :error "ABORT: Set portalDomain to your real company-owned domain (with publicly-trusted TLS cert) before deploying."
}
:if ([:len [/interface bridge port find where interface=$guestIf]] > 0) do={
    :error "ABORT: ether10 is currently in a bridge. Remove it manually after human review before deploying."
}
:if ([:len [/ip address find where address~"192.168.20." && comment!="rawad-guest-portal"]] > 0) do={
    :error "ABORT: Subnet 192.168.20.x conflicts with an existing IP address. Resolve manually."
}
:if ([:len [/certificate find where name=$mikrotikCertName]] = 0) do={
    :error ("ABORT: Certificate '" . $mikrotikCertName . "' not found. Import MikroTik TLS cert before deploying.")
}

:put "=== [2/10] Recording Previous State & Ownership Snapshot ==="
:if ([:len [/system script find where name="rawad-portal-state"]] = 0) do={
    :local prevDns [/ip dns get allow-remote-requests]
    :local prevWwwSslDis [/ip service get www-ssl disabled]
    :local prevWwwSslAddr [/ip service get www-ssl address]
    :local prevWwwSslCert [/ip service get www-ssl certificate]
    :local createdApiGrp ([:len [/user group find where name="rawad-api-group"]] = 0)
    :local createdApiUsr ([:len [/user find where name="rawad-api"]] = 0)

    :local stateSrc (":global rawadPrevDnsRemote " . $prevDns . ";\n" . \
      ":global rawadPrevWwwSslDis " . $prevWwwSslDis . ";\n" . \
      ":global rawadPrevWwwSslAddr \"" . $prevWwwSslAddr . "\";\n" . \
      ":global rawadPrevWwwSslCert \"" . $prevWwwSslCert . "\";\n" . \
      ":global rawadCreatedApiGroup " . $createdApiGrp . ";\n" . \
      ":global rawadCreatedApiUser " . $createdApiUsr . ";")

    /system script add name="rawad-portal-state" source=$stateSrc comment="rawad-guest-portal-state"
}

:put "=== [3/10] Assigning Guest Gateway IP 192.168.20.1/24 on ether10 ==="
:if ([:len [/ip address find where interface=$guestIf && comment="rawad-guest-portal"]] = 0) do={
    /ip address add address=($guestGw . "/24") interface=$guestIf network=192.168.20.0 comment="rawad-guest-portal"
}

:put "=== [4/10] Configuring Guest DHCP Pool, Network & Server (HTTPS CAPPORT Option 114) ==="
:if ([:len [/ip pool find where name="rawad-guest-pool"]] = 0) do={
    /ip pool add name="rawad-guest-pool" ranges=192.168.20.10-192.168.20.250
}
:if ([:len [/ip dhcp-server option find where name="rawad-capport-114"]] = 0) do={
    /ip dhcp-server option add code=114 name="rawad-capport-114" value=("'https://" . $portalDomain . "/api/guest/capport'")
}
:if ([:len [/ip dhcp-server network find where address=$guestNet]] = 0) do={
    /ip dhcp-server network add address=$guestNet gateway=$guestGw dns-server=$guestGw dhcp-option="rawad-capport-114" comment="rawad-guest-portal"
}
:if ([:len [/ip dhcp-server find where name="rawad-guest-dhcp"]] = 0) do={
    /ip dhcp-server add name="rawad-guest-dhcp" interface=$guestIf address-pool="rawad-guest-pool" lease-time=1h disabled=no comment="rawad-guest-portal"
}

:put "=== [5/10] Enabling Local Split-Horizon DNS Resolver & Static Portal Domain ==="
/ip dns set allow-remote-requests=yes
:if ([:len [/ip dns static find where name=$portalDomain && comment="rawad-guest-portal"]] = 0) do={
    /ip dns static add name=$portalDomain address=$backendServerIp comment="rawad-guest-portal"
}
# Ensure accurate NTP clock for TLS validity & Asia/Baghdad 00:00 reset
/system clock set time-zone-name=Asia/Baghdad
/system ntp client set enabled=yes

:put "=== [6/10] Creating HotSpot Profiles & Server on ether10 ==="
:if ([:len [/ip hotspot profile find where name="rawad-hs-prof"]] = 0) do={
    /ip hotspot profile add name="rawad-hs-prof" hotspot-address=$guestGw html-directory="hotspot" login-by=http-chap,http-pap,mac-cookie use-radius=no
}
:if ([:len [/ip hotspot user profile find where name="rawad-free-30m"]] = 0) do={
    /ip hotspot user profile add name="rawad-free-30m" session-timeout=30m keepalive-timeout=2m shared-users=1 status-autorefresh=1m
}
:if ([:len [/ip hotspot user profile find where name="rawad-user"]] = 0) do={
    /ip hotspot user profile add name="rawad-user" keepalive-timeout=2m shared-users=1 status-autorefresh=1m
}
:if ([:len [/ip hotspot find where name="rawad-guest-hotspot"]] = 0) do={
    /ip hotspot add name="rawad-guest-hotspot" interface=$guestIf address-pool="rawad-guest-pool" profile="rawad-hs-prof" disabled=no
}

:put "=== [7/10] Configuring Walled Garden (Allow ONLY HTTPS Guest Portal Proxy) ==="
:if ([:len [/ip hotspot walled-garden ip find where comment="rawad-guest-portal-allow-https"]] = 0) do={
    /ip hotspot walled-garden ip add action=accept disabled=no dst-address=$backendServerIp dst-port=443 protocol=tcp comment="rawad-guest-portal-allow-https"
}
# Optional: If strict OS CRL checks require reaching Let's Encrypt CRL Distribution Points before auth,
# inspect your issued fullchain.pem CRL URLs and allow ONLY that specific CRL host on port 80 (never open general internet):
# /ip hotspot walled-garden add action=accept dst-host="*.c.lencr.org" dst-port=80 protocol=tcp comment="rawad-guest-portal-allow-crl"

:put "=== [8/10] Idempotent Firewall Isolation, Anti-Bypass DNS, Admin Isolation & IPv6 Block ==="
# Note: Rules are checked by unique comment before adding.

# 8a. Allow Backend Server on Staff interface to reach MikroTik HTTPS REST API (443)
:local cApi "rawad-guest-portal: allow backend rest-api"
:if ([:len [/ip firewall filter find where comment=$cApi]] = 0) do={
    :if ([:len [/ip firewall filter find]] > 0) do={
        /ip firewall filter add chain=input in-interface=$staffIf src-address=$backendServerIp protocol=tcp dst-port=443 action=accept place-before=0 comment=$cApi
    } else={
        /ip firewall filter add chain=input in-interface=$staffIf src-address=$backendServerIp protocol=tcp dst-port=443 action=accept comment=$cApi
    }
}

# 8b. Block Guest -> RouterOS Management Services (all mgmt ports on ether10)
:local cMgmt "rawad-guest-portal: drop guest to router mgmt"
:if ([:len [/ip firewall filter find where comment=$cMgmt]] = 0) do={
    /ip firewall filter add chain=input in-interface=$guestIf protocol=tcp dst-port=22,23,80,443,8291,8728,8729 action=drop place-before=0 comment=$cMgmt
}

# 8c. Block Guest -> Admin Dashboard Port 3001 & Backend Direct Port 4000 (even after auth!)
:local cAdm "rawad-guest-portal: drop guest to admin and direct backend"
:if ([:len [/ip firewall filter find where comment=$cAdm]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf dst-address=$backendServerIp protocol=tcp dst-port=3001,4000 action=drop place-before=0 comment=$cAdm
}

# 8d. Allow Guest -> ONLY Guest Portal HTTPS Reverse Proxy (443) before RFC1918/Staff drop
:local cPortal "rawad-guest-portal: allow guest to portal https"
:if ([:len [/ip firewall filter find where comment=$cPortal]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf dst-address=$backendServerIp protocol=tcp dst-port=443 action=accept place-before=0 comment=$cPortal
}

# 8e. Block Guest -> Staff Interface (ether9) & ALL Private Subnets (RFC1918) even after auth
:local cStaff "rawad-guest-portal: drop guest to staff"
:if ([:len [/ip firewall filter find where comment=$cStaff]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf out-interface=$staffIf action=drop place-before=0 comment=$cStaff
}
:local cPriv1 "rawad-guest-portal: drop guest to 192.168.0.0/16"
:if ([:len [/ip firewall filter find where comment=$cPriv1]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf dst-address=192.168.0.0/16 action=drop comment=$cPriv1
}
:local cPriv2 "rawad-guest-portal: drop guest to 10.0.0.0/8"
:if ([:len [/ip firewall filter find where comment=$cPriv2]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf dst-address=10.0.0.0/8 action=drop comment=$cPriv2
}
:local cPriv3 "rawad-guest-portal: drop guest to 172.16.0.0/12"
:if ([:len [/ip firewall filter find where comment=$cPriv3]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf dst-address=172.16.0.0/12 action=drop comment=$cPriv3
}

# 8f. Block External DNS Bypass (Force DNS to local MikroTik only)
:local cDnsUdp "rawad-guest-portal: drop external UDP DNS"
:if ([:len [/ip firewall filter find where comment=$cDnsUdp]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf protocol=udp dst-port=53 action=drop place-before=0 comment=$cDnsUdp
}
:local cDnsTcp "rawad-guest-portal: drop external TCP DNS"
:if ([:len [/ip firewall filter find where comment=$cDnsTcp]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf protocol=tcp dst-port=53 action=drop place-before=0 comment=$cDnsTcp
}

# 8g. Block IPv6 on Guest Interface AT TOP PRIORITY (place-before=0)
:local cV6Fwd "rawad-guest-portal: block ipv6 forward"
:if ([:len [/ipv6 firewall filter find where comment=$cV6Fwd]] = 0) do={
    :if ([:len [/ipv6 firewall filter find]] > 0) do={
        /ipv6 firewall filter add chain=forward in-interface=$guestIf action=drop place-before=0 comment=$cV6Fwd
    } else={
        /ipv6 firewall filter add chain=forward in-interface=$guestIf action=drop comment=$cV6Fwd
    }
}
:local cV6In "rawad-guest-portal: block ipv6 input"
:if ([:len [/ipv6 firewall filter find where comment=$cV6In]] = 0) do={
    /ipv6 firewall filter add chain=input in-interface=$guestIf action=drop place-before=0 comment=$cV6In
}

:put "=== [9/10] Adding NAT Masquerade for Authenticated Guest Traffic ==="
:if ([:len [/ip firewall nat find where comment="rawad-guest-portal-nat"]] = 0) do={
    /ip firewall nat add chain=srcnat src-address=$guestNet out-interface=$wanIf action=masquerade comment="rawad-guest-portal-nat"
}

:put "=== [10/10] Configuring Limited REST API Account & Restricted HTTPS (www-ssl) ==="
:if ([:len [/user group find where name="rawad-api-group"]] = 0) do={
    /user group add name="rawad-api-group" policy=read,write,api,rest-api,!local,!telnet,!ssh,!ftp,!reboot,!policy,!sensitive,!winbox,!romon
}
:if ([:len [/user find where name="rawad-api"]] = 0) do={
    /user add name="rawad-api" group="rawad-api-group" password=$apiPassword comment="rawad-guest-portal"
}
/ip service set www-ssl disabled=no certificate=$mikrotikCertName address=($backendServerIp . "/32")

:put "=== DEPLOYMENT COMPLETE ==="

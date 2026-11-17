# ==============================================================================
# RAWAD TECH CAPTIVE PORTAL — MIKROTIK ROUTEROS 7.x PRE-FLIGHT CHECK
# READ-ONLY SCRIPT: Does NOT modify any router configuration.
# ==============================================================================

:put "=== [1/9] RouterOS Version & Identity ==="
/system identity print
/system resource print

:put "=== [2/9] Interface ether1 (WAN), ether9 (Staff), ether10 (Guest) ==="
/interface ethernet print where name="ether1" || name="ether9" || name="ether10"

:put "=== [3/9] Bridge Port Membership Check (ABORT DEPLOY IF ether10 IS IN A BRIDGE) ==="
:local brCount [:len [/interface bridge port find where interface="ether10"]]
:if ($brCount > 0) do={
    /interface bridge port print where interface="ether10"
    :put "CONFLICT: ether10 is currently a member of a bridge! Human review required before deploy."
} else={
    :put "OK: ether10 is not in any bridge."
}

:put "=== [4/9] Existing IP Addresses & 192.168.20.0/24 Conflict Check ==="
/ip address print
:if ([:len [/ip address find where address~"192.168.20." && comment!="rawad-guest-portal"]] > 0) do={
    :put "CONFLICT: Subnet 192.168.20.x is already in use by another rule! Human review required."
} else={
    :put "OK: No 192.168.20.x IP conflict detected."
}

:put "=== [5/9] Existing DHCP Servers, Pools & DNS ==="
/ip pool print
/ip dhcp-server print
/ip dhcp-server network print
/ip dns print

:put "=== [6/9] Existing HotSpot Configuration ==="
/ip hotspot print
/ip hotspot profile print

:put "=== [7/9] Existing Firewall Filter & NAT Rules ==="
/ip firewall filter print
/ip firewall nat print

:put "=== [8/9] IPv6 Status & Firewall Rules ==="
/ipv6 address print
/ipv6 firewall filter print

:put "=== [9/10] Certificates & www-ssl Service Status ==="
/certificate print
/ip service print where name="www-ssl"

:put "=== [10/10] System Clock & NTP Client Status (Required for TLS & Asia/Baghdad Reset) ==="
/system clock print
/system ntp client print

:put "=== PRE-FLIGHT CHECK COMPLETE (NO CHANGES MADE) ==="

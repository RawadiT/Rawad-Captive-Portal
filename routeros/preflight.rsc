# ==============================================================================
# RAWAD TECH CAPTIVE PORTAL — MIKROTIK ROUTEROS v7 PRE-FLIGHT CHECK
# READ-ONLY SCRIPT — Scoped strictly to ether10 (does NOT inspect/modify ether1-ether9).
# ==============================================================================

:put "=== [1/8] RouterOS Version & Identity ==="
/system identity print
/system resource print

:put "=== [2/8] Interface ether10 Status ==="
/interface ethernet print where name="ether10"

:put "=== [3/8] Bridge Port Membership Check for ether10 ==="
:local brCount [:len [/interface bridge port find where interface="ether10"]]
:if ($brCount > 0) do={
    /interface bridge port print where interface="ether10"
    :put "CONFLICT: ether10 is currently in a bridge! Human review required before deploy."
} else={
    :put "OK: ether10 is not in any bridge."
}

:put "=== [4/8] 192.168.20.0/24 IP Conflict Check ==="
:if ([:len [/ip address find where address~"192.168.20." && comment!="rawad-guest-portal"]] > 0) do={
    :put "CONFLICT: Subnet 192.168.20.x is already in use! Human review required."
} else={
    :put "OK: No 192.168.20.x IP conflict detected."
}

:put "=== [5/8] Existing HotSpot & DHCP on ether10 ==="
/ip dhcp-server print where interface="ether10"
/ip hotspot print where interface="ether10"

:put "=== [6/8] Existing Firewall Rules referencing ether10 ==="
/ip firewall filter print where in-interface="ether10" || out-interface="ether10"
/ipv6 firewall filter print where in-interface="ether10"

:put "=== [7/8] Certificates & www-ssl Status ==="
/certificate print
/ip service print where name="www-ssl"

:put "=== [8/8] System Clock & NTP Client ==="
/system clock print
/system ntp client print

:put "=== PRE-FLIGHT CHECK COMPLETE (NO CHANGES MADE) ==="

# ==============================================================================
# RAWAD TECH CAPTIVE PORTAL — MIKROTIK ROUTEROS v7 PRE-FLIGHT CHECK
# READ-ONLY SCRIPT — Scoped strictly to ether10 (does NOT inspect/modify ether1-ether9).
# ==============================================================================

:put "=== [1/9] RouterOS Version & Identity ==="
/system identity print
/system resource print

:put "=== [2/9] Interface ether10 Status ==="
/interface ethernet print where name="ether10"

:put "=== [3/9] Bridge Port Membership Check for ether10 ==="
:local brCount [:len [/interface bridge port find where interface="ether10"]]
:if ($brCount > 0) do={
    /interface bridge port print where interface="ether10"
    :put "CONFLICT: ether10 is currently in a bridge! Human review required before deploy."
} else={
    :put "OK: ether10 is not in any bridge."
}

:put "=== [4/9] 192.168.20.0/24 & Project Resource Name Conflict Check ==="
:if ([:len [/ip address find where address~"192.168.20." && comment!="rawad-guest-portal"]] > 0) do={
    :put "CONFLICT: Subnet 192.168.20.x is already in use! Human review required."
} else={
    :put "OK: No 192.168.20.x IP conflict detected."
}
:if ([:len [/system script find where name="rawad-portal-state"]] = 0) do={
    :if ([:len [/ip pool find where name="rawad-guest-pool"]] > 0 || [:len [/ip dhcp-server find where name="rawad-guest-dhcp"]] > 0 || [:len [/ip hotspot profile find where name="rawad-hs-prof"]] > 0 || [:len [/ip hotspot find where name="rawad-guest-hotspot"]] > 0 || [:len [/ip hotspot user profile find where name="rawad-verified-prof"]] > 0 || [:len [/ip hotspot user find where name="rawad-gate"]] > 0 || [:len [/system scheduler find where name="rawad-sync-revocations"]] > 0) do={
        :put "CONFLICT: One or more rawad-* resource names already exist without rawad-portal-state!"
    } else={
        :put "OK: No pre-existing rawad-* resource name conflicts."
    }
}

:put "=== [5/9] Existing HotSpot, DHCP & VLANs on ether10 ==="
/ip dhcp-server print where interface="ether10"
/ip hotspot print where interface="ether10"
/interface vlan print where interface="ether10"

:put "=== [6/9] Existing Firewall, NAT & Mangle Rules referencing ether10 ==="
/ip firewall filter print where in-interface="ether10" || out-interface="ether10"
/ip firewall nat print where in-interface="ether10" || out-interface="ether10" || src-address~"192.168.20."
/ip firewall mangle print where in-interface="ether10" || out-interface="ether10"
/ipv6 firewall filter print where in-interface="ether10"

:put "=== [7/9] DNS Remote Requests & Open-Resolver Safety Check ==="
:local dnsRemote [/ip dns get allow-remote-requests]
:put ("Current allow-remote-requests: " . $dnsRemote)
:if ($dnsRemote = false) do={
    :put "NOTICE: deploy.rsc will set allow-remote-requests=yes for ether10 DNS. Verify your WAN input firewall drops external TCP/UDP 53 so RouterOS does not act as an open resolver."
}

:put "=== [8/9] Certificates & www-ssl Status ==="
/certificate print
/ip service print where name="www-ssl"

:put "=== [9/9] System Clock & NTP Client ==="
/system clock print
/system ntp client print

:put "=== PRE-FLIGHT CHECK COMPLETE (NO CHANGES MADE) ==="

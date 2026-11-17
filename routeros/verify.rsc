# ==============================================================================
# RAWAD TECH CAPTIVE PORTAL — MIKROTIK ROUTEROS v7 VERIFICATION
# Scoped strictly to ether10 and rawad-guest-portal items.
# ==============================================================================

:put "=== [1/6] Verify State Snapshot ==="
/system script print where name="rawad-portal-state"

:put "=== [2/6] Verify ether10 IP & Static DNS ==="
/ip address print where interface="ether10" && comment="rawad-guest-portal"
/ip dns static print where comment="rawad-guest-portal"

:put "=== [3/6] Verify DHCP Server & Option 114 on ether10 ==="
/ip dhcp-server print where name="rawad-guest-dhcp"
/ip dhcp-server option print where name="rawad-capport-114"

:put "=== [4/6] Verify HotSpot Server & Walled Garden ==="
/ip hotspot print where name="rawad-guest-hotspot"
/ip hotspot walled-garden ip print where comment~"rawad-guest-portal"

:put "=== [5/6] Verify ether10 Firewall & IPv6 Block ==="
/ip firewall filter print where comment~"rawad-guest-portal"
/ipv6 firewall filter print where comment~"rawad-guest-portal"

:put "=== [6/6] Verify Limited API User & www-ssl ==="
/user print where name="rawad-api"
/ip service print where name="www-ssl"

:put "=== VERIFICATION COMPLETE ==="

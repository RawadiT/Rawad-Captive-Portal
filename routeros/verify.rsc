# ==============================================================================
# RAWAD TECH CAPTIVE PORTAL — MIKROTIK ROUTEROS 7.x VERIFICATION SCRIPT
# ==============================================================================

:put "=== [1/7] Verify State Snapshot Exists ==="
/system script print where name="rawad-portal-state"

:put "=== [2/7] Verify ether10 IP & Static DNS ==="
/ip address print where comment="rawad-guest-portal"
/ip dns static print where comment="rawad-guest-portal"

:put "=== [3/7] Verify DHCP Server & HTTPS Option 114 ==="
/ip dhcp-server print where name="rawad-guest-dhcp"
/ip dhcp-server option print where name="rawad-capport-114"

:put "=== [4/7] Verify HotSpot Server & Profiles ==="
/ip hotspot print where name="rawad-guest-hotspot"
/ip hotspot user profile print where name~"rawad-"

:put "=== [5/7] Verify Walled Garden ==="
/ip hotspot walled-garden ip print where comment~"rawad-guest-portal"

:put "=== [6/7] Verify Firewall Isolation & Top-Priority IPv6 Block ==="
/ip firewall filter print where comment~"rawad-guest-portal"
/ipv6 firewall filter print where comment~"rawad-guest-portal"

:put "=== [7/7] Verify Limited API User & Restricted www-ssl ==="
/user print where name="rawad-api"
/ip service print where name="www-ssl"

:put "=== VERIFICATION COMPLETE ==="

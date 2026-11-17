# ==============================================================================
# RAWAD TECH CAPTIVE PORTAL — MIKROTIK ROUTEROS v7 VERIFICATION
# Scoped strictly to ether10 and rawad-guest-portal items.
# ==============================================================================

:put "=== [1/5] Verify State & Anchor Scripts ==="
/system script print where name~"rawad-portal-"

:put "=== [2/5] Verify ether10 IP ==="
/ip address print where interface="ether10" && comment="rawad-guest-portal"

:put "=== [3/5] Verify DHCP Server & Option 114 on ether10 ==="
/ip dhcp-server print where name="rawad-guest-dhcp"
/ip dhcp-server option print where name="rawad-capport-114"

:put "=== [4/5] Verify HotSpot Server, Profile, Gate User & Walled Garden ==="
/ip hotspot print where name="rawad-guest-hotspot"
/ip hotspot user profile print where name="rawad-verified-prof"
/ip hotspot user print where name="rawad-gate"
/ip hotspot walled-garden print where comment="rawad-guest-portal-allow-supabase"

:put "=== [5/5] Verify ether10 Firewall & IPv6 Block ==="
/ip firewall filter print where comment~"rawad-guest-portal"
/ipv6 firewall filter print where comment~"rawad-guest-portal"

:put "=== VERIFICATION COMPLETE ==="

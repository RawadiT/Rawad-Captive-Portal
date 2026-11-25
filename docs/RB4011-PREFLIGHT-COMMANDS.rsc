# ==============================================================================
# RB4011 READ-ONLY PRE-FLIGHT AUDIT COMMAND PACK (RB-065)
# STRICTLY READ-ONLY — SAFE TO RUN ON PRODUCTION RB4011 WITHOUT ANY MUTATIONS.
# Usage: Run section-by-section or import in Terminal and save full output + /export.
# ==============================================================================

:put "=== [1/12] System Identity, RouterOS Version, Architecture & Resources ==="
/system identity print
/system resource print
/system package print

:put "=== [2/12] Interfaces & Ethernet Status (Full + ether10) ==="
/interface print detail
/interface ethernet print detail
/interface ethernet poe print

:put "=== [3/12] Bridge & Port Membership ==="
/interface bridge print detail
/interface bridge port print detail

:put "=== [4/12] VLANs & Switch Chip Configuration ==="
/interface vlan print detail
/interface ethernet switch print
/interface ethernet switch port print

:put "=== [5/12] IP Addresses, Pools & Routes ==="
/ip address print detail
/ip pool print detail
/ip route print detail

:put "=== [6/12] DHCP Servers, Networks & Active Leases Summary ==="
/ip dhcp-server print detail
/ip dhcp-server network print detail
/ip dhcp-server lease print count-only

:put "=== [7/12] DNS Configuration ==="
/ip dns print
/ip dns static print

:put "=== [8/12] IPv4 Firewall Filter, NAT, Mangle & Address Lists ==="
/ip firewall filter print detail
/ip firewall nat print detail
/ip firewall mangle print detail
/ip firewall address-list print count-only

:put "=== [9/12] IPv6 Firewall Filter (WAN DNS 53 & Interface Rules) ==="
/ipv6 firewall filter print detail

:put "=== [10/12] Existing HotSpot Servers, Profiles & Walled Garden ==="
/ip hotspot print detail
/ip hotspot profile print detail
/ip hotspot user profile print detail
/ip hotspot walled-garden print detail

:put "=== [11/12] Certificates, Clock, NTP & IP Services ==="
/certificate print
/system clock print
/system ntp client print
/ip service print detail

:put "=== [12/12] Existing Scripts & Schedulers ==="
/system script print
/system scheduler print detail

:put "=== READ-ONLY AUDIT COMPLETE (ALSO RUN: /export show-sensitive file=rb4011-audit) ==="

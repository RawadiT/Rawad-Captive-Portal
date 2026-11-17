# ==============================================================================
# RAWAD TECH CAPTIVE PORTAL — MIKROTIK ROUTEROS 7.x EXACT ROLLBACK SCRIPT
# Restores previous DNS, www-ssl, and only removes items created by deploy.rsc.
# ==============================================================================

:put "=== Rolling back Rawad Tech Captive Portal configuration ==="

:global rawadPrevDnsRemote
:global rawadPrevWwwSslDis
:global rawadPrevWwwSslAddr
:global rawadPrevWwwSslCert
:global rawadCreatedApiGroup
:global rawadCreatedApiUser

:if ([:len [/system script find where name="rawad-portal-state"]] > 0) do={
    /system script run rawad-portal-state
}

/ip hotspot remove [find where name="rawad-guest-hotspot"]
/ip hotspot user profile remove [find where name="rawad-free-30m"]
/ip hotspot user profile remove [find where name="rawad-user"]
/ip hotspot profile remove [find where name="rawad-hs-prof"]
/ip hotspot walled-garden ip remove [find where comment~"rawad-guest-portal"]

/ip firewall filter remove [find where comment~"rawad-guest-portal"]
/ipv6 firewall filter remove [find where comment~"rawad-guest-portal"]
/ip firewall nat remove [find where comment="rawad-guest-portal-nat"]

/ip dhcp-server remove [find where name="rawad-guest-dhcp"]
/ip dhcp-server network remove [find where comment="rawad-guest-portal"]
/ip dhcp-server option remove [find where name="rawad-capport-114"]
/ip pool remove [find where name="rawad-guest-pool"]
/ip dns static remove [find where comment="rawad-guest-portal"]
/ip address remove [find where comment="rawad-guest-portal"]

:if ([:typeof $rawadPrevDnsRemote] = "bool") do={
    /ip dns set allow-remote-requests=$rawadPrevDnsRemote
}
:if ([:typeof $rawadPrevWwwSslDis] = "bool") do={
    /ip service set www-ssl disabled=$rawadPrevWwwSslDis address=$rawadPrevWwwSslAddr certificate=$rawadPrevWwwSslCert
}
:if ($rawadCreatedApiUser = true) do={
    /user remove [find where name="rawad-api"]
}
:if ($rawadCreatedApiGroup = true) do={
    /user group remove [find where name="rawad-api-group"]
}

/system script remove [find where name="rawad-portal-state"]

:put "=== ROLLBACK COMPLETE (PREVIOUS STATE RESTORED) ==="

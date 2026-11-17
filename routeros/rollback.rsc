# ==============================================================================
# RAWAD TECH CAPTIVE PORTAL — MIKROTIK ROUTEROS v7 EXACT & SAFE ROLLBACK
# - Only removes items created by deploy.rsc (checked via ownership flags).
# - Restores previous DNS, www-ssl, NTP, and Timezone values.
# - Never touches ether1-ether9 or any pre-existing configuration.
# ==============================================================================

:put "=== Rolling back Rawad Tech Captive Portal (ether10 only) ==="

:global rawadPrevDnsRemote
:global rawadPrevWwwSslDis
:global rawadPrevWwwSslAddr
:global rawadPrevWwwSslCert
:global rawadPrevTz
:global rawadPrevNtpEn
:global rawadCreatedIpAddr
:global rawadCreatedPool
:global rawadCreatedDhcpOpt
:global rawadCreatedDhcpNet
:global rawadCreatedDhcpSrv
:global rawadCreatedStaticDns
:global rawadCreatedHsProf
:global rawadCreatedHsSrv
:global rawadCreatedWg
:global rawadCreatedNat
:global rawadCreatedApiGroup
:global rawadCreatedApiUser

:if ([:len [/system script find where name="rawad-portal-state"]] > 0) do={
    /system script run rawad-portal-state
}

/ip firewall filter remove [find where comment~"rawad-guest-portal:"]
/ipv6 firewall filter remove [find where comment~"rawad-guest-portal:"]
:if ($rawadCreatedNat = true) do={
    /ip firewall nat remove [find where comment="rawad-guest-portal-nat"]
}

/ip hotspot user remove [find where comment="rawad-guest-portal-managed"]
/ip hotspot user profile remove [find where comment="rawad-guest-portal-managed"]

:if ($rawadCreatedHsSrv = true) do={
    /ip hotspot remove [find where name="rawad-guest-hotspot"]
}
:if ($rawadCreatedHsProf = true) do={
    /ip hotspot profile remove [find where name="rawad-hs-prof"]
}
:if ($rawadCreatedWg = true) do={
    /ip hotspot walled-garden ip remove [find where comment="rawad-guest-portal-allow-https"]
}

:if ($rawadCreatedDhcpSrv = true) do={
    /ip dhcp-server remove [find where name="rawad-guest-dhcp"]
}
:if ($rawadCreatedDhcpNet = true) do={
    /ip dhcp-server network remove [find where comment="rawad-guest-portal"]
}
:if ($rawadCreatedDhcpOpt = true) do={
    /ip dhcp-server option remove [find where name="rawad-capport-114"]
}
:if ($rawadCreatedPool = true) do={
    /ip pool remove [find where name="rawad-guest-pool"]
}
:if ($rawadCreatedStaticDns = true) do={
    /ip dns static remove [find where comment="rawad-guest-portal"]
}
:if ($rawadCreatedIpAddr = true) do={
    /ip address remove [find where comment="rawad-guest-portal"]
}

:if ([:typeof $rawadPrevDnsRemote] = "bool") do={
    /ip dns set allow-remote-requests=$rawadPrevDnsRemote
}
:if ([:typeof $rawadPrevWwwSslDis] = "bool") do={
    /ip service set www-ssl disabled=$rawadPrevWwwSslDis address=$rawadPrevWwwSslAddr certificate=$rawadPrevWwwSslCert
}
:if ([:typeof $rawadPrevTz] = "str" && [:len $rawadPrevTz] > 0) do={
    /system clock set time-zone-name=$rawadPrevTz
}
:if ([:typeof $rawadPrevNtpEn] = "bool") do={
    /system ntp client set enabled=$rawadPrevNtpEn
}

:if ($rawadCreatedApiUser = true) do={
    /user remove [find where name="rawad-api"]
}
:if ($rawadCreatedApiGroup = true) do={
    /user group remove [find where name="rawad-api-group"]
}

/system script remove [find where name="rawad-portal-state"]

:put "=== ROLLBACK COMPLETE ==="

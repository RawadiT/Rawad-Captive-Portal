# ==============================================================================
# RAWAD TECH CAPTIVE PORTAL — MIKROTIK ROUTEROS v7 EXACT & SAFE ROLLBACK
# - Tracks and removes EVERY firewall rule and resource individually by ownership flag.
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
:global rawadCreatedFwPriv3
:global rawadCreatedFwPriv2
:global rawadCreatedFwPriv1
:global rawadCreatedFwPortal
:global rawadCreatedFwAdm
:global rawadCreatedFwDnsTcp
:global rawadCreatedFwDnsUdp
:global rawadCreatedFwMgmt
:global rawadCreatedV6Fwd
:global rawadCreatedV6In

:if ([:len [/system script find where name="rawad-portal-state"]] > 0) do={
    /system script run rawad-portal-state
}

# 1. Remove each firewall rule individually ONLY if created by deploy.rsc
:if ($rawadCreatedFwPriv3 = true) do={ /ip firewall filter remove [find where comment="rawad-guest-portal: drop ether10 to 172.16.0.0/12"] }
:if ($rawadCreatedFwPriv2 = true) do={ /ip firewall filter remove [find where comment="rawad-guest-portal: drop ether10 to 10.0.0.0/8"] }
:if ($rawadCreatedFwPriv1 = true) do={ /ip firewall filter remove [find where comment="rawad-guest-portal: drop ether10 to 192.168.0.0/16"] }
:if ($rawadCreatedFwPortal = true) do={ /ip firewall filter remove [find where comment="rawad-guest-portal: allow ether10 to portal https"] }
:if ($rawadCreatedFwAdm = true) do={ /ip firewall filter remove [find where comment="rawad-guest-portal: drop ether10 to admin and direct backend"] }
:if ($rawadCreatedFwDnsTcp = true) do={ /ip firewall filter remove [find where comment="rawad-guest-portal: drop ether10 external TCP DNS"] }
:if ($rawadCreatedFwDnsUdp = true) do={ /ip firewall filter remove [find where comment="rawad-guest-portal: drop ether10 external UDP DNS"] }
:if ($rawadCreatedFwMgmt = true) do={ /ip firewall filter remove [find where comment="rawad-guest-portal: drop ether10 to router mgmt"] }
:if ($rawadCreatedV6Fwd = true) do={ /ipv6 firewall filter remove [find where comment="rawad-guest-portal: block ether10 ipv6 forward"] }
:if ($rawadCreatedV6In = true) do={ /ipv6 firewall filter remove [find where comment="rawad-guest-portal: block ether10 ipv6 input"] }

:if ($rawadCreatedNat = true) do={
    /ip firewall nat remove [find where comment="rawad-guest-portal-nat"]
}

# 2. Remove HotSpot Server, Profile & Walled Garden only if created by deploy.rsc
# (Do NOT delete runtime application users/sessions during infrastructure rollback)

:if ($rawadCreatedHsSrv = true) do={
    /ip hotspot remove [find where name="rawad-guest-hotspot"]
}
:if ($rawadCreatedHsProf = true) do={
    /ip hotspot profile remove [find where name="rawad-hs-prof"]
}
:if ($rawadCreatedWg = true) do={
    /ip hotspot walled-garden ip remove [find where comment="rawad-guest-portal-allow-https"]
}

# 3. Remove DHCP, Pool, Static DNS & IP only if created by deploy.rsc
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

# 4. Restore previous DNS, www-ssl, Timezone, and NTP values
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

# 5. Remove API user & group only if created by deploy.rsc
:if ($rawadCreatedApiUser = true) do={
    /user remove [find where name="rawad-api"]
}
:if ($rawadCreatedApiGroup = true) do={
    /user group remove [find where name="rawad-api-group"]
}

/system script remove [find where name="rawad-portal-state"]

:put "=== ROLLBACK COMPLETE ==="

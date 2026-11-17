# ==============================================================================
# RAWAD TECH CAPTIVE PORTAL — MIKROTIK ROUTEROS v7 EXACT & SAFE ROLLBACK
# - Verifies rawad-portal-state .id, grammar, and dual polynomial digest BEFORE running.
# - Removes ONLY exact unmodified resources created by deploy.rsc.
# - Restores previous DNS, NTP, and Timezone only if not manually modified after deploy.
# ==============================================================================

:put "=== Rolling back Rawad Tech Captive Portal (ether10 only) ==="

:local anchorIds [/system script find where name="rawad-portal-anchor" && comment="rawad-guest-portal-anchor"]
:if ([:len $anchorIds] != 1) do={
    :error "ABORT: rawad-portal-anchor missing or duplicated. Cannot verify state script ownership before execution."
}
:local anchorSid [:pick $anchorIds 0]
:local anchorSrc [/system script get $anchorSid source]

:local pId [:find $anchorSrc "id="]
:local pLen [:find $anchorSrc ";len="]
:local pH1 [:find $anchorSrc ";h1="]
:local pH2 [:find $anchorSrc ";h2="]
:local pEnd [:find $anchorSrc ";" $pH2]
:if ([:typeof $pId] != "num" || [:typeof $pLen] != "num" || [:typeof $pH1] != "num" || [:typeof $pH2] != "num" || [:typeof $pEnd] != "num") do={
    :error "ABORT: rawad-portal-anchor format invalid. Refusing unsafe rollback."
}
:local expId [:pick $anchorSrc ($pId + 3) $pLen]
:local expLen [:tonum [:pick $anchorSrc ($pLen + 5) $pH1]]
:local expH1 [:tonum [:pick $anchorSrc ($pH1 + 4) $pH2]]
:local expH2 [:tonum [:pick $anchorSrc ($pH2 + 4) $pEnd]]

:local stateIds [/system script find where name="rawad-portal-state" && comment="rawad-guest-portal-state"]
:if ([:len $stateIds] != 1) do={
    :error "ABORT: rawad-portal-state missing or duplicated. Refusing unsafe rollback."
}
:local stateSid [:pick $stateIds 0]
:if ([:tostr $stateSid] != $expId) do={
    :error "ABORT: rawad-portal-state .id mismatch (script was replaced manually). Refusing to execute."
}

:local curSrc [/system script get $stateSid source]
:local expectedTail ("\n:global rawadStateBodyLen " . $expLen . ";\n:global rawadStateH1 " . $expH1 . ";\n:global rawadStateH2 " . $expH2 . ";")
:if ([:len $curSrc] != ($expLen + [:len $expectedTail]) || [:find $curSrc $expectedTail] != $expLen) do={
    :error "ABORT: rawad-portal-state length or footer mismatch. Refusing to execute."
}

:local stateBody [:pick $curSrc 0 $expLen]
:local ascii " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\n\r\t"
:local actH1 5381
:local actH2 216613626
:for i from=0 to=($expLen - 1) do={
    :local ch [:pick $stateBody $i ($i + 1)]
    :local code [:find $ascii $ch]
    :if ([:typeof $code] != "num") do={ :set code 127 }
    :set actH1 ((($actH1 * 131) + $code + $i) % 2147483647)
    :set actH2 ((($actH2 * 65599) + ($code * ($i + 1))) % 2147483647)
}
:if ($actH1 != $expH1 || $actH2 != $expH2) do={
    :error "ABORT: rawad-portal-state digest mismatch. Refusing to execute."
}

/system script run $stateSid

:global rawadPrevDnsRemote; :global rawadPrevTz; :global rawadPrevNtpEn
:global rawadSetDnsRemote; :global rawadSetTz; :global rawadSetNtpEn
:global rawadGuestIf; :global rawadGuestGw; :global rawadGuestNet; :global rawadSupabaseHost
:global rawadCreatedIpAddr; :global rawadIdIpAddr
:global rawadCreatedPool; :global rawadIdPool
:global rawadCreatedDhcpOpt; :global rawadIdDhcpOpt
:global rawadCreatedDhcpNet; :global rawadIdDhcpNet
:global rawadCreatedDhcpSrv; :global rawadIdDhcpSrv
:global rawadCreatedHsProf; :global rawadIdHsProf
:global rawadCreatedHsUsrProf; :global rawadIdHsUsrProf
:global rawadCreatedHsUsr; :global rawadIdHsUsr
:global rawadCreatedHsSrv; :global rawadIdHsSrv
:global rawadCreatedWg; :global rawadIdWg
:global rawadCreatedNat; :global rawadIdNat
:global rawadCreatedFwPriv3; :global rawadIdFwPriv3
:global rawadCreatedFwPriv2; :global rawadIdFwPriv2
:global rawadCreatedFwPriv1; :global rawadIdFwPriv1
:global rawadCreatedFwUnver; :global rawadIdFwUnver
:global rawadCreatedFwDnsTcp; :global rawadIdFwDnsTcp
:global rawadCreatedFwDnsUdp; :global rawadIdFwDnsUdp
:global rawadCreatedFwMgmt; :global rawadIdFwMgmt
:global rawadCreatedV6Fwd; :global rawadIdV6Fwd
:global rawadCreatedV6In; :global rawadIdV6In

# 1. Remove firewall rules & verified address-list entries
/ip firewall address-list remove [find where list="rawad-verified" && comment="rawad-guest-portal"]
:if ($rawadCreatedFwPriv3 = true && $rawadIdFwPriv3 != "") do={ :do { /ip firewall filter remove [find where .id=$rawadIdFwPriv3 && comment="rawad-guest-portal: drop ether10 to 172.16.0.0/12"] } on-error={} }
:if ($rawadCreatedFwPriv2 = true && $rawadIdFwPriv2 != "") do={ :do { /ip firewall filter remove [find where .id=$rawadIdFwPriv2 && comment="rawad-guest-portal: drop ether10 to 10.0.0.0/8"] } on-error={} }
:if ($rawadCreatedFwPriv1 = true && $rawadIdFwPriv1 != "") do={ :do { /ip firewall filter remove [find where .id=$rawadIdFwPriv1 && comment="rawad-guest-portal: drop ether10 to 192.168.0.0/16"] } on-error={} }
:if ($rawadCreatedFwUnver = true && $rawadIdFwUnver != "") do={ :do { /ip firewall filter remove [find where .id=$rawadIdFwUnver && comment="rawad-guest-portal: drop ether10 unverified forwarding"] } on-error={} }
:if ($rawadCreatedFwDnsTcp = true && $rawadIdFwDnsTcp != "") do={ :do { /ip firewall filter remove [find where .id=$rawadIdFwDnsTcp && comment="rawad-guest-portal: drop ether10 external TCP DNS"] } on-error={} }
:if ($rawadCreatedFwDnsUdp = true && $rawadIdFwDnsUdp != "") do={ :do { /ip firewall filter remove [find where .id=$rawadIdFwDnsUdp && comment="rawad-guest-portal: drop ether10 external UDP DNS"] } on-error={} }
:if ($rawadCreatedFwMgmt = true && $rawadIdFwMgmt != "") do={ :do { /ip firewall filter remove [find where .id=$rawadIdFwMgmt && comment="rawad-guest-portal: drop ether10 to router mgmt"] } on-error={} }
:if ($rawadCreatedV6Fwd = true && $rawadIdV6Fwd != "") do={ :do { /ipv6 firewall filter remove [find where .id=$rawadIdV6Fwd && comment="rawad-guest-portal: block ether10 ipv6 forward"] } on-error={} }
:if ($rawadCreatedV6In = true && $rawadIdV6In != "") do={ :do { /ipv6 firewall filter remove [find where .id=$rawadIdV6In && comment="rawad-guest-portal: block ether10 ipv6 input"] } on-error={} }
:if ($rawadCreatedNat = true && $rawadIdNat != "") do={ :do { /ip firewall nat remove [find where .id=$rawadIdNat && comment="rawad-guest-portal-nat"] } on-error={} }

# 2. Remove HotSpot resources (dependency-safe)
:if ($rawadCreatedHsSrv = true && $rawadIdHsSrv != "") do={ :do { /ip hotspot remove [find where .id=$rawadIdHsSrv && name="rawad-guest-hotspot"] } on-error={} }
:if ($rawadCreatedHsUsr = true && $rawadIdHsUsr != "") do={ :do { /ip hotspot user remove [find where .id=$rawadIdHsUsr && name="rawad-gate"] } on-error={} }
:if ($rawadCreatedHsUsrProf = true && $rawadIdHsUsrProf != "") do={ :if ([:len [/ip hotspot user find where profile="rawad-verified-prof"]] = 0) do={ :do { /ip hotspot user profile remove [find where .id=$rawadIdHsUsrProf && name="rawad-verified-prof"] } on-error={} } }
:if ($rawadCreatedHsProf = true && $rawadIdHsProf != "") do={ :if ([:len [/ip hotspot find where profile="rawad-hs-prof"]] = 0) do={ :do { /ip hotspot profile remove [find where .id=$rawadIdHsProf && name="rawad-hs-prof"] } on-error={} } }
:if ($rawadCreatedWg = true && $rawadIdWg != "") do={ :do { /ip hotspot walled-garden remove [find where .id=$rawadIdWg && comment="rawad-guest-portal-allow-supabase"] } on-error={} }

# 3. Remove DHCP, Pool & IP
:if ($rawadCreatedDhcpSrv = true && $rawadIdDhcpSrv != "") do={ :do { /ip dhcp-server remove [find where .id=$rawadIdDhcpSrv && name="rawad-guest-dhcp"] } on-error={} }
:if ($rawadCreatedDhcpNet = true && $rawadIdDhcpNet != "") do={ :do { /ip dhcp-server network remove [find where .id=$rawadIdDhcpNet && comment="rawad-guest-portal"] } on-error={} }
:if ($rawadCreatedDhcpOpt = true && $rawadIdDhcpOpt != "") do={ :if ([:len [/ip dhcp-server network find where dhcp-option~"rawad-capport-114"]] = 0) do={ :do { /ip dhcp-server option remove [find where .id=$rawadIdDhcpOpt && name="rawad-capport-114"] } on-error={} } }
:if ($rawadCreatedPool = true && $rawadIdPool != "") do={ :if ([:len [/ip dhcp-server find where address-pool="rawad-guest-pool"]] = 0 && [:len [/ip hotspot find where address-pool="rawad-guest-pool"]] = 0) do={ :do { /ip pool remove [find where .id=$rawadIdPool && name="rawad-guest-pool"] } on-error={} } }
:if ($rawadCreatedIpAddr = true && $rawadIdIpAddr != "") do={ :do { /ip address remove [find where .id=$rawadIdIpAddr && interface=$rawadGuestIf && comment="rawad-guest-portal"] } on-error={} }

# 4. Restore previous DNS, Timezone, and NTP ONLY if unmodified since deploy
:if ([:typeof $rawadPrevDnsRemote] = "bool" && [/ip dns get allow-remote-requests] = $rawadSetDnsRemote) do={ /ip dns set allow-remote-requests=$rawadPrevDnsRemote }
:if ([:typeof $rawadPrevTz] = "str" && [:len $rawadPrevTz] > 0 && [/system clock get time-zone-name] = $rawadSetTz) do={ /system clock set time-zone-name=$rawadPrevTz }
:if ([:typeof $rawadPrevNtpEn] = "bool" && [/system ntp client get enabled] = $rawadSetNtpEn) do={ /system ntp client set enabled=$rawadPrevNtpEn }

# 5. Remove verified state and anchor scripts
/system script remove $stateSid
/system script remove $anchorSid

:put "=== ROLLBACK COMPLETE ==="

# ==============================================================================
# RAWAD TECH CAPTIVE PORTAL — MIKROTIK ROUTEROS v7 DEPLOYMENT
# Target: MikroTik RB4011iGS+RM (RouterOS v7)
# STRICT SCOPE: Configured EXCLUSIVELY for ether10 (192.168.20.0/24).
# NEVER touches ether1-ether9, WAN, Staff bridges, or unrelated rules.
# ==============================================================================

:local guestIf "ether10"
:local guestGw "192.168.20.1"
:local guestNet "192.168.20.0/24"
:local backendServerIp "192.168.10.10"
:local portalDomain "wifi.YOUR_COMPANY_DOMAIN.com"
:local mikrotikCertName "rawad-mikrotik-cert"
:local apiPassword "CHANGE_THIS_STRONG_API_PASSWORD"

:local cPriv3 "rawad-guest-portal: drop ether10 to 172.16.0.0/12"
:local cPriv2 "rawad-guest-portal: drop ether10 to 10.0.0.0/8"
:local cPriv1 "rawad-guest-portal: drop ether10 to 192.168.0.0/16"
:local cPortal "rawad-guest-portal: allow ether10 to portal https"
:local cAdm "rawad-guest-portal: drop ether10 to admin and direct backend"
:local cDnsTcp "rawad-guest-portal: drop ether10 external TCP DNS"
:local cDnsUdp "rawad-guest-portal: drop ether10 external UDP DNS"
:local cMgmt "rawad-guest-portal: drop ether10 to router mgmt"
:local cV6Fwd "rawad-guest-portal: block ether10 ipv6 forward"
:local cV6In "rawad-guest-portal: block ether10 ipv6 input"

:put "=== [1/10] Pre-flight Security & Ownership Conflict Gate ==="
:if ($apiPassword = "" || $apiPassword = "CHANGE_THIS_STRONG_API_PASSWORD" || $apiPassword = "REPLACE_WITH_API_PASSWORD" || [:len $apiPassword] < 12) do={
    :error "ABORT: Set a strong apiPassword (>= 12 chars, not default) before deploying."
}
:if ($portalDomain = "" || $portalDomain = "wifi.YOUR_COMPANY_DOMAIN.com") do={
    :error "ABORT: Set portalDomain to your real company-owned domain before deploying."
}
:if ([:len [/interface bridge port find where interface=$guestIf]] > 0) do={
    :error "ABORT: ether10 is currently in a bridge. Remove it manually after review before deploying."
}
:if ([:len [/ip address find where address~"192.168.20." && comment!="rawad-guest-portal"]] > 0) do={
    :error "ABORT: Subnet 192.168.20.x conflicts with an existing IP address. Resolve manually."
}
:if ([:len [/certificate find where name=$mikrotikCertName]] = 0) do={
    :error ("ABORT: Certificate '" . $mikrotikCertName . "' not found. Import MikroTik TLS cert first.")
}
:if ([/ip dns get allow-remote-requests] = false && [:len [/ip firewall filter find where chain="input" && action="drop" && dst-port~"53" && disabled=no]] = 0) do={
    :error "ABORT: Cannot enable allow-remote-requests=yes without an existing active input firewall rule dropping external DNS (port 53), which would expose an open resolver. Configure your WAN DNS drop rule manually before deploying."
}

# Never claim ownership of pre-existing non-project resources on initial deploy
:if ([:len [/system script find where name="rawad-portal-state"]] = 0) do={
    :if ([:len [/ip pool find where name="rawad-guest-pool"]] > 0 || [:len [/ip dhcp-server find where name="rawad-guest-dhcp"]] > 0 || [:len [/ip dhcp-server option find where name="rawad-capport-114"]] > 0 || [:len [/ip hotspot profile find where name="rawad-hs-prof"]] > 0 || [:len [/ip hotspot find where name="rawad-guest-hotspot"]] > 0 || [:len [/user find where name="rawad-api"]] > 0 || [:len [/user group find where name="rawad-api-group"]] > 0) do={
        :error "ABORT: Pre-existing rawad-* resource found without rawad-portal-state. Resolve manually before deploying."
    }
}

:put "=== [2/10] Recording Full Individual Ownership & Previous State Snapshot ==="
:if ([:len [/system script find where name="rawad-portal-state"]] = 0) do={
    :local prevDns [/ip dns get allow-remote-requests]
    :local prevWwwSslDis [/ip service get www-ssl disabled]
    :local prevWwwSslAddr [/ip service get www-ssl address]
    :local prevWwwSslCert [/ip service get www-ssl certificate]
    :local prevTz [/system clock get time-zone-name]
    :local prevNtpEn [/system ntp client get enabled]

    :local crIpAddr ([:len [/ip address find where interface=$guestIf && comment="rawad-guest-portal"]] = 0)
    :local crPool ([:len [/ip pool find where name="rawad-guest-pool"]] = 0)
    :local crDhcpOpt ([:len [/ip dhcp-server option find where name="rawad-capport-114"]] = 0)
    :local crDhcpNet ([:len [/ip dhcp-server network find where address=$guestNet]] = 0)
    :local crDhcpSrv ([:len [/ip dhcp-server find where name="rawad-guest-dhcp"]] = 0)
    :local crStaticDns ([:len [/ip dns static find where name=$portalDomain]] = 0)
    :local crHsProf ([:len [/ip hotspot profile find where name="rawad-hs-prof"]] = 0)
    :local crHsSrv ([:len [/ip hotspot find where name="rawad-guest-hotspot"]] = 0)
    :local crWg ([:len [/ip hotspot walled-garden ip find where comment="rawad-guest-portal-allow-https"]] = 0)
    :local crNat ([:len [/ip firewall nat find where comment="rawad-guest-portal-nat"]] = 0)
    :local crApiGrp ([:len [/user group find where name="rawad-api-group"]] = 0)
    :local crApiUsr ([:len [/user find where name="rawad-api"]] = 0)

    :local crFwPriv3 ([:len [/ip firewall filter find where comment=$cPriv3]] = 0)
    :local crFwPriv2 ([:len [/ip firewall filter find where comment=$cPriv2]] = 0)
    :local crFwPriv1 ([:len [/ip firewall filter find where comment=$cPriv1]] = 0)
    :local crFwPortal ([:len [/ip firewall filter find where comment=$cPortal]] = 0)
    :local crFwAdm ([:len [/ip firewall filter find where comment=$cAdm]] = 0)
    :local crFwDnsTcp ([:len [/ip firewall filter find where comment=$cDnsTcp]] = 0)
    :local crFwDnsUdp ([:len [/ip firewall filter find where comment=$cDnsUdp]] = 0)
    :local crFwMgmt ([:len [/ip firewall filter find where comment=$cMgmt]] = 0)
    :local crV6Fwd ([:len [/ipv6 firewall filter find where comment=$cV6Fwd]] = 0)
    :local crV6In ([:len [/ipv6 firewall filter find where comment=$cV6In]] = 0)

    :local stateSrc (":global rawadPrevDnsRemote " . $prevDns . ";\n" . \
      ":global rawadPrevWwwSslDis " . $prevWwwSslDis . ";\n" . \
      ":global rawadPrevWwwSslAddr \"" . $prevWwwSslAddr . "\";\n" . \
      ":global rawadPrevWwwSslCert \"" . $prevWwwSslCert . "\";\n" . \
      ":global rawadPrevTz \"" . $prevTz . "\";\n" . \
      ":global rawadPrevNtpEn " . $prevNtpEn . ";\n" . \
      ":global rawadCreatedIpAddr " . $crIpAddr . ";\n" . \
      ":global rawadCreatedPool " . $crPool . ";\n" . \
      ":global rawadCreatedDhcpOpt " . $crDhcpOpt . ";\n" . \
      ":global rawadCreatedDhcpNet " . $crDhcpNet . ";\n" . \
      ":global rawadCreatedDhcpSrv " . $crDhcpSrv . ";\n" . \
      ":global rawadCreatedStaticDns " . $crStaticDns . ";\n" . \
      ":global rawadCreatedHsProf " . $crHsProf . ";\n" . \
      ":global rawadCreatedHsSrv " . $crHsSrv . ";\n" . \
      ":global rawadCreatedWg " . $crWg . ";\n" . \
      ":global rawadCreatedNat " . $crNat . ";\n" . \
      ":global rawadCreatedApiGroup " . $crApiGrp . ";\n" . \
      ":global rawadCreatedApiUser " . $crApiUsr . ";\n" . \
      ":global rawadCreatedFwPriv3 " . $crFwPriv3 . ";\n" . \
      ":global rawadCreatedFwPriv2 " . $crFwPriv2 . ";\n" . \
      ":global rawadCreatedFwPriv1 " . $crFwPriv1 . ";\n" . \
      ":global rawadCreatedFwPortal " . $crFwPortal . ";\n" . \
      ":global rawadCreatedFwAdm " . $crFwAdm . ";\n" . \
      ":global rawadCreatedFwDnsTcp " . $crFwDnsTcp . ";\n" . \
      ":global rawadCreatedFwDnsUdp " . $crFwDnsUdp . ";\n" . \
      ":global rawadCreatedFwMgmt " . $crFwMgmt . ";\n" . \
      ":global rawadCreatedV6Fwd " . $crV6Fwd . ";\n" . \
      ":global rawadCreatedV6In " . $crV6In . ";")

    /system script add name="rawad-portal-state" source=$stateSrc comment="rawad-guest-portal-state"
}

:put "=== [3/10] Assigning Guest Gateway IP 192.168.20.1/24 on ether10 ==="
:if ([:len [/ip address find where interface=$guestIf && comment="rawad-guest-portal"]] = 0) do={
    /ip address add address=($guestGw . "/24") interface=$guestIf network=192.168.20.0 comment="rawad-guest-portal"
}

:put "=== [4/10] Configuring Guest DHCP Pool, Network & Server on ether10 ==="
:if ([:len [/ip pool find where name="rawad-guest-pool"]] = 0) do={
    /ip pool add name="rawad-guest-pool" ranges=192.168.20.10-192.168.20.250
}
:if ([:len [/ip dhcp-server option find where name="rawad-capport-114"]] = 0) do={
    /ip dhcp-server option add code=114 name="rawad-capport-114" value=("'https://" . $portalDomain . "/api/guest/capport'")
}
:if ([:len [/ip dhcp-server network find where address=$guestNet]] = 0) do={
    /ip dhcp-server network add address=$guestNet gateway=$guestGw dns-server=$guestGw dhcp-option="rawad-capport-114" comment="rawad-guest-portal"
}
:if ([:len [/ip dhcp-server find where name="rawad-guest-dhcp"]] = 0) do={
    /ip dhcp-server add name="rawad-guest-dhcp" interface=$guestIf address-pool="rawad-guest-pool" lease-time=1h disabled=no comment="rawad-guest-portal"
}

:put "=== [5/10] Enabling Split-Horizon DNS & NTP (Ensure WAN firewall blocks external DNS 53) ==="
/ip dns set allow-remote-requests=yes
:if ([:len [/ip dns static find where name=$portalDomain]] = 0) do={
    /ip dns static add name=$portalDomain address=$backendServerIp comment="rawad-guest-portal"
}
/system clock set time-zone-name=Asia/Baghdad
/system ntp client set enabled=yes

:put "=== [6/10] Creating HotSpot Server Profile & Server on ether10 ==="
:if ([:len [/ip hotspot profile find where name="rawad-hs-prof"]] = 0) do={
    /ip hotspot profile add name="rawad-hs-prof" hotspot-address=$guestGw html-directory="hotspot" login-by=http-chap,http-pap use-radius=no
}
:if ([:len [/ip hotspot find where name="rawad-guest-hotspot"]] = 0) do={
    /ip hotspot add name="rawad-guest-hotspot" interface=$guestIf address-pool="rawad-guest-pool" profile="rawad-hs-prof" disabled=no
}

:put "=== [7/10] Configuring Walled Garden (Allow ONLY HTTPS Guest Portal Proxy) ==="
:if ([:len [/ip hotspot walled-garden ip find where comment="rawad-guest-portal-allow-https"]] = 0) do={
    /ip hotspot walled-garden ip add action=accept disabled=no dst-address=$backendServerIp dst-port=443 protocol=tcp comment="rawad-guest-portal-allow-https"
}

:put "=== [8/10] Idempotent & Deterministic Firewall Rules (Scoped strictly to ether10) ==="
:if ([:len [/ip firewall filter find where comment=$cPriv3]] = 0) do={
    :if ([:len [/ip firewall filter find]] > 0) do={
        /ip firewall filter add chain=forward in-interface=$guestIf dst-address=172.16.0.0/12 action=drop place-before=0 comment=$cPriv3
    } else={
        /ip firewall filter add chain=forward in-interface=$guestIf dst-address=172.16.0.0/12 action=drop comment=$cPriv3
    }
}
:if ([:len [/ip firewall filter find where comment=$cPriv2]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf dst-address=10.0.0.0/8 action=drop place-before=0 comment=$cPriv2
}
:if ([:len [/ip firewall filter find where comment=$cPriv1]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf dst-address=192.168.0.0/16 action=drop place-before=0 comment=$cPriv1
}
:if ([:len [/ip firewall filter find where comment=$cPortal]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf dst-address=$backendServerIp protocol=tcp dst-port=443 action=accept place-before=0 comment=$cPortal
}
:if ([:len [/ip firewall filter find where comment=$cAdm]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf dst-address=$backendServerIp protocol=tcp dst-port=8443,4000 action=drop place-before=0 comment=$cAdm
}
:if ([:len [/ip firewall filter find where comment=$cDnsTcp]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf protocol=tcp dst-port=53 action=drop place-before=0 comment=$cDnsTcp
}
:if ([:len [/ip firewall filter find where comment=$cDnsUdp]] = 0) do={
    /ip firewall filter add chain=forward in-interface=$guestIf protocol=udp dst-port=53 action=drop place-before=0 comment=$cDnsUdp
}
:if ([:len [/ip firewall filter find where comment=$cMgmt]] = 0) do={
    /ip firewall filter add chain=input in-interface=$guestIf protocol=tcp dst-port=22,23,80,443,8291,8728,8729 action=drop place-before=0 comment=$cMgmt
}

:if ([:len [/ipv6 firewall filter find where comment=$cV6Fwd]] = 0) do={
    :if ([:len [/ipv6 firewall filter find]] > 0) do={
        /ipv6 firewall filter add chain=forward in-interface=$guestIf action=drop place-before=0 comment=$cV6Fwd
    } else={
        /ipv6 firewall filter add chain=forward in-interface=$guestIf action=drop comment=$cV6Fwd
    }
}
:if ([:len [/ipv6 firewall filter find where comment=$cV6In]] = 0) do={
    /ipv6 firewall filter add chain=input in-interface=$guestIf action=drop place-before=0 comment=$cV6In
}

:put "=== [9/10] Adding NAT Masquerade for ether10 Guest Subnet ==="
:if ([:len [/ip firewall nat find where comment="rawad-guest-portal-nat"]] = 0) do={
    /ip firewall nat add chain=srcnat src-address=$guestNet dst-address=!192.168.0.0/16 action=masquerade comment="rawad-guest-portal-nat"
}

:put "=== [10/10] Configuring Limited REST API Account & Restricted HTTPS (www-ssl) ==="
:if ([:len [/user group find where name="rawad-api-group"]] = 0) do={
    /user group add name="rawad-api-group" policy=read,write,api,rest-api,!local,!telnet,!ssh,!ftp,!reboot,!policy,!sensitive,!winbox,!romon
}
:if ([:len [/user find where name="rawad-api"]] = 0) do={
    /user add name="rawad-api" group="rawad-api-group" password=$apiPassword comment="rawad-guest-portal"
}
/ip service set www-ssl disabled=no certificate=$mikrotikCertName address=($backendServerIp . "/32")

:put "=== DEPLOYMENT COMPLETE (ether10 ONLY) ==="

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

# Strict DNS Open-Resolver Gate: ALWAYS run regardless of current allow-remote-requests value.
# Verifies WAN input firewall drops BOTH TCP and UDP port 53 without bypass by earlier rules.
:local wanIfaces [:toarray ""]
:local wanListMembers [:toarray ""]
:foreach mid in=[/interface list member find where list="WAN"] do={
    :local mIf [/interface list member get $mid interface]
    :set wanListMembers ($wanListMembers, $mIf)
    :if ([:typeof [:find $wanIfaces $mIf]] != "num") do={
        :set wanIfaces ($wanIfaces, $mIf)
    }
}
:local defRoutes [/ip route find where dst-address="0.0.0.0/0" && active=yes]
:foreach dr in=$defRoutes do={
    :local igw [/ip route get $dr immediate-gw]
    :local routeIf ""
    :local pctPos [:find $igw "%"]
    :if ([:typeof $pctPos] = "num") do={
        :set routeIf [:pick $igw ($pctPos + 1) [:len $igw]]
    } else={
        :if ([:len [/interface find where name=$igw]] > 0) do={
            :set routeIf $igw
        }
    }
    :if ($routeIf != "") do={
        :if ([:typeof [:find $wanIfaces $routeIf]] != "num") do={
            :set wanIfaces ($wanIfaces, $routeIf)
        }
    } else={
        :if ([:len $wanListMembers] = 0) do={
            :error "ABORT: Cannot resolve WAN interface from active default route and WAN interface-list is empty. Cannot prove DNS port 53 protection."
        }
    }
}
:if ([:len $wanIfaces] = 0) do={
    :error "ABORT: Cannot determine WAN interface(s) to prove DNS port 53 protection."
}
:if ([:typeof [:find $wanIfaces $guestIf]] = "num") do={
    :error "ABORT: Guest interface ether10 appears in WAN interface list/route."
}

:local wanListCoversAll ([:len $wanListMembers] > 0)
:foreach wif in=$wanIfaces do={
    :if ([:typeof [:find $wanListMembers $wif]] != "num") do={
        :set wanListCoversAll false
    }
}

:local udp53CoveredIfs [:toarray ""]
:local tcp53CoveredIfs [:toarray ""]
:local udp53ViaWanList false
:local tcp53ViaWanList false
:local udp53Bypassed false
:local tcp53Bypassed false

:foreach rid in=[/ip firewall filter find where chain="input" && disabled=no] do={
    :local rAct [/ip firewall filter get $rid action]
    :local rInIf [/ip firewall filter get $rid in-interface]
    :local rInList [/ip firewall filter get $rid in-interface-list]
    :local rProto [/ip firewall filter get $rid protocol]
    :local rPort [/ip firewall filter get $rid dst-port]
    :local rConnState [/ip firewall filter get $rid connection-state]
    :local rSrcAddr [/ip firewall filter get $rid src-address]
    :local rSrcList [/ip firewall filter get $rid src-address-list]

    :local portCsv ("," . $rPort . ",")
    :local portExact53 ($rPort = "" || $rPort = "53" || [:typeof [:find $portCsv ",53,"]] = "num")
    :local portHasRange ([:typeof [:find $rPort "-"]] = "num")
    :local isEstabRelOnly ($rConnState != "" && ([:typeof [:find $rConnState "established"]] = "num" || [:typeof [:find $rConnState "related"]] = "num") && [:typeof [:find $rConnState "new"]] != "num" && [:typeof [:find $rConnState "invalid"]] != "num")

    :if ($rAct = "accept" || $rAct = "jump" || $rAct = "return") do={
        :local inIfIsNonWan ($rInIf != "" && [:typeof [:find $wanIfaces $rInIf]] != "num" && $rInList != "WAN")
        :local inListIsNonWan ($rInList != "" && $rInList != "WAN" && $rInIf = "")
        :local canHitWanNew (!$isEstabRelOnly && !$inIfIsNonWan && !$inListIsNonWan)
        :if ($canHitWanNew && ($portExact53 || $portHasRange)) do={
            :if ($rProto = "" || $rProto = "udp") do={
                :if (!$udp53ViaWanList && [:len $udp53CoveredIfs] < [:len $wanIfaces]) do={
                    :set udp53Bypassed true
                }
            }
            :if ($rProto = "" || $rProto = "tcp") do={
                :if (!$tcp53ViaWanList && [:len $tcp53CoveredIfs] < [:len $wanIfaces]) do={
                    :set tcp53Bypassed true
                }
            }
        }
    }

    :if ($rAct = "drop" && $rSrcAddr = "" && $rSrcList = "" && ($rConnState = "" || [:typeof [:find $rConnState "new"]] = "num")) do={
        :local coversWanList ($rInList = "WAN" && $wanListCoversAll && $rInIf = "")
        :local coversExactWanIf ($rInIf != "" && [:typeof [:find $wanIfaces $rInIf]] = "num" && $rInList = "")
        :if ($portExact53 && ($coversWanList || $coversExactWanIf)) do={
            :if ($rProto = "udp" || $rProto = "") do={
                :if ($coversWanList) do={ :set udp53ViaWanList true }
                :if ($coversExactWanIf && [:typeof [:find $udp53CoveredIfs $rInIf]] != "num") do={
                    :set udp53CoveredIfs ($udp53CoveredIfs, $rInIf)
                }
            }
            :if ($rProto = "tcp" || $rProto = "") do={
                :if ($coversWanList) do={ :set tcp53ViaWanList true }
                :if ($coversExactWanIf && [:typeof [:find $tcp53CoveredIfs $rInIf]] != "num") do={
                    :set tcp53CoveredIfs ($tcp53CoveredIfs, $rInIf)
                }
            }
        }
    }
}

:local udp53Protected ($udp53ViaWanList || ([:len $udp53CoveredIfs] = [:len $wanIfaces]))
:local tcp53Protected ($tcp53ViaWanList || ([:len $tcp53CoveredIfs] = [:len $wanIfaces]))
:if (!$udp53Protected || !$tcp53Protected || $udp53Bypassed || $tcp53Bypassed) do={
    :error "ABORT: Cannot prove WAN input firewall drops BOTH TCP and UDP port 53 without bypass (open resolver risk). Configure WAN input drop rules for TCP/UDP 53 above any permissive accept rules before deploying."
}

# Never claim ownership of ANY pre-existing non-project resource on initial deploy
:if ([:len [/system script find where name="rawad-portal-state"]] = 0) do={
    :if ([:len [/ip pool find where name="rawad-guest-pool"]] > 0 || [:len [/ip dhcp-server find where name="rawad-guest-dhcp"]] > 0 || [:len [/ip dhcp-server option find where name="rawad-capport-114"]] > 0 || [:len [/ip hotspot profile find where name="rawad-hs-prof"]] > 0 || [:len [/ip hotspot find where name="rawad-guest-hotspot"]] > 0 || [:len [/ip hotspot walled-garden ip find where comment="rawad-guest-portal-allow-https"]] > 0 || [:len [/ip firewall nat find where comment="rawad-guest-portal-nat"]] > 0 || [:len [/ip dns static find where name=$portalDomain]] > 0 || [:len [/user find where name="rawad-api"]] > 0 || [:len [/user group find where name="rawad-api-group"]] > 0) do={
        :error "ABORT: Pre-existing rawad-* resource or static DNS entry found without rawad-portal-state. Resolve manually before deploying."
    }
}

:put "=== [2/10] Recording Full Individual Ownership & Previous State Snapshot ==="
:local isInitialDeploy ([:len [/system script find where name="rawad-portal-state"]] = 0)
:local prevDns false
:local prevWwwSslDis true
:local prevWwwSslAddr ""
:local prevWwwSslCert ""
:local prevTz ""
:local prevNtpEn false

:local crIpAddr false
:local crPool false
:local crDhcpOpt false
:local crDhcpNet false
:local crDhcpSrv false
:local crStaticDns false
:local crHsProf false
:local crHsSrv false
:local crWg false
:local crNat false
:local crApiGrp false
:local crApiUsr false
:local crFwPriv3 false
:local crFwPriv2 false
:local crFwPriv1 false
:local crFwPortal false
:local crFwAdm false
:local crFwDnsTcp false
:local crFwDnsUdp false
:local crFwMgmt false
:local crV6Fwd false
:local crV6In false

:local idIpAddr ""
:local idPool ""
:local idDhcpOpt ""
:local idDhcpNet ""
:local idDhcpSrv ""
:local idStaticDns ""
:local idHsProf ""
:local idHsSrv ""
:local idWg ""
:local idNat ""
:local idApiGrp ""
:local idApiUsr ""
:local idFwPriv3 ""
:local idFwPriv2 ""
:local idFwPriv1 ""
:local idFwPortal ""
:local idFwAdm ""
:local idFwDnsTcp ""
:local idFwDnsUdp ""
:local idFwMgmt ""
:local idV6Fwd ""
:local idV6In ""

:if ($isInitialDeploy) do={
    :set prevDns [/ip dns get allow-remote-requests]
    :set prevWwwSslDis [/ip service get www-ssl disabled]
    :set prevWwwSslAddr [/ip service get www-ssl address]
    :set prevWwwSslCert [/ip service get www-ssl certificate]
    :set prevTz [/system clock get time-zone-name]
    :set prevNtpEn [/system ntp client get enabled]

    :set crIpAddr ([:len [/ip address find where interface=$guestIf && comment="rawad-guest-portal"]] = 0)
    :set crPool ([:len [/ip pool find where name="rawad-guest-pool"]] = 0)
    :set crDhcpOpt ([:len [/ip dhcp-server option find where name="rawad-capport-114"]] = 0)
    :set crDhcpNet ([:len [/ip dhcp-server network find where address=$guestNet]] = 0)
    :set crDhcpSrv ([:len [/ip dhcp-server find where name="rawad-guest-dhcp"]] = 0)
    :set crStaticDns ([:len [/ip dns static find where name=$portalDomain]] = 0)
    :set crHsProf ([:len [/ip hotspot profile find where name="rawad-hs-prof"]] = 0)
    :set crHsSrv ([:len [/ip hotspot find where name="rawad-guest-hotspot"]] = 0)
    :set crWg ([:len [/ip hotspot walled-garden ip find where comment="rawad-guest-portal-allow-https"]] = 0)
    :set crNat ([:len [/ip firewall nat find where comment="rawad-guest-portal-nat"]] = 0)
    :set crApiGrp ([:len [/user group find where name="rawad-api-group"]] = 0)
    :set crApiUsr ([:len [/user find where name="rawad-api"]] = 0)

    :set crFwPriv3 ([:len [/ip firewall filter find where comment=$cPriv3]] = 0)
    :set crFwPriv2 ([:len [/ip firewall filter find where comment=$cPriv2]] = 0)
    :set crFwPriv1 ([:len [/ip firewall filter find where comment=$cPriv1]] = 0)
    :set crFwPortal ([:len [/ip firewall filter find where comment=$cPortal]] = 0)
    :set crFwAdm ([:len [/ip firewall filter find where comment=$cAdm]] = 0)
    :set crFwDnsTcp ([:len [/ip firewall filter find where comment=$cDnsTcp]] = 0)
    :set crFwDnsUdp ([:len [/ip firewall filter find where comment=$cDnsUdp]] = 0)
    :set crFwMgmt ([:len [/ip firewall filter find where comment=$cMgmt]] = 0)
    :set crV6Fwd ([:len [/ipv6 firewall filter find where comment=$cV6Fwd]] = 0)
    :set crV6In ([:len [/ipv6 firewall filter find where comment=$cV6In]] = 0)

    :local initSrc (":global rawadPrevDnsRemote " . $prevDns . ";\n" . \
      ":global rawadPrevWwwSslDis " . $prevWwwSslDis . ";\n" . \
      ":global rawadPrevWwwSslAddr \"" . $prevWwwSslAddr . "\";\n" . \
      ":global rawadPrevWwwSslCert \"" . $prevWwwSslCert . "\";\n" . \
      ":global rawadPrevTz \"" . $prevTz . "\";\n" . \
      ":global rawadPrevNtpEn " . $prevNtpEn . ";")
    /system script add name="rawad-portal-state" source=$initSrc comment="rawad-guest-portal-state"
}

:put "=== [3/10] Assigning Guest Gateway IP 192.168.20.1/24 on ether10 ==="
:if ([:len [/ip address find where interface=$guestIf && comment="rawad-guest-portal"]] = 0) do={
    :set idIpAddr [/ip address add address=($guestGw . "/24") interface=$guestIf network=192.168.20.0 comment="rawad-guest-portal"]
}

:put "=== [4/10] Configuring Guest DHCP Pool, Network & Server on ether10 ==="
:if ([:len [/ip pool find where name="rawad-guest-pool"]] = 0) do={
    :set idPool [/ip pool add name="rawad-guest-pool" ranges=192.168.20.10-192.168.20.250]
}
:if ([:len [/ip dhcp-server option find where name="rawad-capport-114"]] = 0) do={
    :set idDhcpOpt [/ip dhcp-server option add code=114 name="rawad-capport-114" value=("'https://" . $portalDomain . "/api/guest/capport'")]
}
:if ([:len [/ip dhcp-server network find where address=$guestNet]] = 0) do={
    :set idDhcpNet [/ip dhcp-server network add address=$guestNet gateway=$guestGw dns-server=$guestGw dhcp-option="rawad-capport-114" comment="rawad-guest-portal"]
}
:if ([:len [/ip dhcp-server find where name="rawad-guest-dhcp"]] = 0) do={
    :set idDhcpSrv [/ip dhcp-server add name="rawad-guest-dhcp" interface=$guestIf address-pool="rawad-guest-pool" lease-time=1h disabled=no comment="rawad-guest-portal"]
}

:put "=== [5/10] Enabling Split-Horizon DNS & NTP (Ensure WAN firewall blocks external DNS 53) ==="
/ip dns set allow-remote-requests=yes
:if ([:len [/ip dns static find where name=$portalDomain]] = 0) do={
    :set idStaticDns [/ip dns static add name=$portalDomain address=$backendServerIp comment="rawad-guest-portal"]
}
/system clock set time-zone-name=Asia/Baghdad
/system ntp client set enabled=yes

:put "=== [6/10] Creating HotSpot Server Profile & Server on ether10 ==="
:if ([:len [/ip hotspot profile find where name="rawad-hs-prof"]] = 0) do={
    :set idHsProf [/ip hotspot profile add name="rawad-hs-prof" hotspot-address=$guestGw html-directory="hotspot" login-by=http-chap,http-pap use-radius=no]
}
:if ([:len [/ip hotspot find where name="rawad-guest-hotspot"]] = 0) do={
    :set idHsSrv [/ip hotspot add name="rawad-guest-hotspot" interface=$guestIf address-pool="rawad-guest-pool" profile="rawad-hs-prof" disabled=no]
}

:put "=== [7/10] Configuring Walled Garden (Allow ONLY HTTPS Guest Portal Proxy) ==="
:if ([:len [/ip hotspot walled-garden ip find where comment="rawad-guest-portal-allow-https"]] = 0) do={
    :set idWg [/ip hotspot walled-garden ip add action=accept disabled=no dst-address=$backendServerIp dst-port=443 protocol=tcp comment="rawad-guest-portal-allow-https"]
}

:put "=== [8/10] Idempotent & Deterministic Firewall Rules (Scoped strictly to ether10) ==="
:if ([:len [/ip firewall filter find where comment=$cPriv3]] = 0) do={
    :if ([:len [/ip firewall filter find]] > 0) do={
        :set idFwPriv3 [/ip firewall filter add chain=forward in-interface=$guestIf dst-address=172.16.0.0/12 action=drop place-before=0 comment=$cPriv3]
    } else={
        :set idFwPriv3 [/ip firewall filter add chain=forward in-interface=$guestIf dst-address=172.16.0.0/12 action=drop comment=$cPriv3]
    }
}
:if ([:len [/ip firewall filter find where comment=$cPriv2]] = 0) do={
    :set idFwPriv2 [/ip firewall filter add chain=forward in-interface=$guestIf dst-address=10.0.0.0/8 action=drop place-before=0 comment=$cPriv2]
}
:if ([:len [/ip firewall filter find where comment=$cPriv1]] = 0) do={
    :set idFwPriv1 [/ip firewall filter add chain=forward in-interface=$guestIf dst-address=192.168.0.0/16 action=drop place-before=0 comment=$cPriv1]
}
:if ([:len [/ip firewall filter find where comment=$cPortal]] = 0) do={
    :set idFwPortal [/ip firewall filter add chain=forward in-interface=$guestIf dst-address=$backendServerIp protocol=tcp dst-port=443 action=accept place-before=0 comment=$cPortal]
}
:if ([:len [/ip firewall filter find where comment=$cAdm]] = 0) do={
    :set idFwAdm [/ip firewall filter add chain=forward in-interface=$guestIf dst-address=$backendServerIp protocol=tcp dst-port=8443,4000 action=drop place-before=0 comment=$cAdm]
}
:if ([:len [/ip firewall filter find where comment=$cDnsTcp]] = 0) do={
    :set idFwDnsTcp [/ip firewall filter add chain=forward in-interface=$guestIf protocol=tcp dst-port=53 action=drop place-before=0 comment=$cDnsTcp]
}
:if ([:len [/ip firewall filter find where comment=$cDnsUdp]] = 0) do={
    :set idFwDnsUdp [/ip firewall filter add chain=forward in-interface=$guestIf protocol=udp dst-port=53 action=drop place-before=0 comment=$cDnsUdp]
}
:if ([:len [/ip firewall filter find where comment=$cMgmt]] = 0) do={
    :set idFwMgmt [/ip firewall filter add chain=input in-interface=$guestIf protocol=tcp dst-port=22,23,80,443,8291,8728,8729 action=drop place-before=0 comment=$cMgmt]
}

:if ([:len [/ipv6 firewall filter find where comment=$cV6Fwd]] = 0) do={
    :if ([:len [/ipv6 firewall filter find]] > 0) do={
        :set idV6Fwd [/ipv6 firewall filter add chain=forward in-interface=$guestIf action=drop place-before=0 comment=$cV6Fwd]
    } else={
        :set idV6Fwd [/ipv6 firewall filter add chain=forward in-interface=$guestIf action=drop comment=$cV6Fwd]
    }
}
:if ([:len [/ipv6 firewall filter find where comment=$cV6In]] = 0) do={
    :set idV6In [/ipv6 firewall filter add chain=input in-interface=$guestIf action=drop place-before=0 comment=$cV6In]
}

:put "=== [9/10] Adding NAT Masquerade for ether10 Guest Subnet ==="
:if ([:len [/ip firewall nat find where comment="rawad-guest-portal-nat"]] = 0) do={
    :set idNat [/ip firewall nat add chain=srcnat src-address=$guestNet dst-address=!192.168.0.0/16 action=masquerade comment="rawad-guest-portal-nat"]
}

:put "=== [10/10] Configuring Limited REST API Account & Restricted HTTPS (www-ssl) ==="
:if ([:len [/user group find where name="rawad-api-group"]] = 0) do={
    :set idApiGrp [/user group add name="rawad-api-group" policy=read,write,api,rest-api,!local,!telnet,!ssh,!ftp,!reboot,!policy,!sensitive,!winbox,!romon]
}
:if ([:len [/user find where name="rawad-api"]] = 0) do={
    :set idApiUsr [/user add name="rawad-api" group="rawad-api-group" password=$apiPassword comment="rawad-guest-portal"]
}
/ip service set www-ssl disabled=no certificate=$mikrotikCertName address=($backendServerIp . "/32")

:if ($isInitialDeploy) do={
    :local finalSrc (":global rawadPrevDnsRemote " . $prevDns . ";\n" . \
      ":global rawadPrevWwwSslDis " . $prevWwwSslDis . ";\n" . \
      ":global rawadPrevWwwSslAddr \"" . $prevWwwSslAddr . "\";\n" . \
      ":global rawadPrevWwwSslCert \"" . $prevWwwSslCert . "\";\n" . \
      ":global rawadPrevTz \"" . $prevTz . "\";\n" . \
      ":global rawadPrevNtpEn " . $prevNtpEn . ";\n" . \
      ":global rawadGuestIf \"" . $guestIf . "\";\n" . \
      ":global rawadGuestGw \"" . $guestGw . "\";\n" . \
      ":global rawadGuestNet \"" . $guestNet . "\";\n" . \
      ":global rawadBackendIp \"" . $backendServerIp . "\";\n" . \
      ":global rawadPortalDomain \"" . $portalDomain . "\";\n" . \
      ":global rawadCreatedIpAddr " . $crIpAddr . "; :global rawadIdIpAddr \"" . $idIpAddr . "\";\n" . \
      ":global rawadCreatedPool " . $crPool . "; :global rawadIdPool \"" . $idPool . "\";\n" . \
      ":global rawadCreatedDhcpOpt " . $crDhcpOpt . "; :global rawadIdDhcpOpt \"" . $idDhcpOpt . "\";\n" . \
      ":global rawadCreatedDhcpNet " . $crDhcpNet . "; :global rawadIdDhcpNet \"" . $idDhcpNet . "\";\n" . \
      ":global rawadCreatedDhcpSrv " . $crDhcpSrv . "; :global rawadIdDhcpSrv \"" . $idDhcpSrv . "\";\n" . \
      ":global rawadCreatedStaticDns " . $crStaticDns . "; :global rawadIdStaticDns \"" . $idStaticDns . "\";\n" . \
      ":global rawadCreatedHsProf " . $crHsProf . "; :global rawadIdHsProf \"" . $idHsProf . "\";\n" . \
      ":global rawadCreatedHsSrv " . $crHsSrv . "; :global rawadIdHsSrv \"" . $idHsSrv . "\";\n" . \
      ":global rawadCreatedWg " . $crWg . "; :global rawadIdWg \"" . $idWg . "\";\n" . \
      ":global rawadCreatedNat " . $crNat . "; :global rawadIdNat \"" . $idNat . "\";\n" . \
      ":global rawadCreatedApiGroup " . $crApiGrp . "; :global rawadIdApiGroup \"" . $idApiGrp . "\";\n" . \
      ":global rawadCreatedApiUser " . $crApiUsr . "; :global rawadIdApiUser \"" . $idApiUsr . "\";\n" . \
      ":global rawadCreatedFwPriv3 " . $crFwPriv3 . "; :global rawadIdFwPriv3 \"" . $idFwPriv3 . "\";\n" . \
      ":global rawadCreatedFwPriv2 " . $crFwPriv2 . "; :global rawadIdFwPriv2 \"" . $idFwPriv2 . "\";\n" . \
      ":global rawadCreatedFwPriv1 " . $crFwPriv1 . "; :global rawadIdFwPriv1 \"" . $idFwPriv1 . "\";\n" . \
      ":global rawadCreatedFwPortal " . $crFwPortal . "; :global rawadIdFwPortal \"" . $idFwPortal . "\";\n" . \
      ":global rawadCreatedFwAdm " . $crFwAdm . "; :global rawadIdFwAdm \"" . $idFwAdm . "\";\n" . \
      ":global rawadCreatedFwDnsTcp " . $crFwDnsTcp . "; :global rawadIdFwDnsTcp \"" . $idFwDnsTcp . "\";\n" . \
      ":global rawadCreatedFwDnsUdp " . $crFwDnsUdp . "; :global rawadIdFwDnsUdp \"" . $idFwDnsUdp . "\";\n" . \
      ":global rawadCreatedFwMgmt " . $crFwMgmt . "; :global rawadIdFwMgmt \"" . $idFwMgmt . "\";\n" . \
      ":global rawadCreatedV6Fwd " . $crV6Fwd . "; :global rawadIdV6Fwd \"" . $idV6Fwd . "\";\n" . \
      ":global rawadCreatedV6In " . $crV6In . "; :global rawadIdV6In \"" . $idV6In . "\";")
    /system script set [find where name="rawad-portal-state"] source=$finalSrc
}

:put "=== DEPLOYMENT COMPLETE (ether10 ONLY) ==="

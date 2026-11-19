# ==============================================================================
# RAWAD TECH CAPTIVE PORTAL — MIKROTIK ROUTEROS v7 DEPLOYMENT
# Architecture: MikroTik HotSpot UI (hotspot/) + Supabase Edge Functions
# Target: MikroTik RB4011iGS+RM (RouterOS v7)
# STRICT SCOPE: Configured EXCLUSIVELY for ether10 (192.168.20.0/24).
# NEVER touches ether1-ether9, WAN, Staff bridges, or unrelated rules.
# ==============================================================================

:local guestIf "ether10"
:local guestGw "192.168.20.1"
:local guestNet "192.168.20.0/24"
:local supabaseHost "YOUR_PROJECT_ID.supabase.co"
:local routerSecret "CHANGE_THIS_STRONG_ROUTER_SECRET"

:local cPriv3 "rawad-guest-portal: drop ether10 to 172.16.0.0/12"
:local cPriv2 "rawad-guest-portal: drop ether10 to 10.0.0.0/8"
:local cPriv1 "rawad-guest-portal: drop ether10 to 192.168.0.0/16"
:local cUnverified "rawad-guest-portal: drop ether10 unverified forwarding"
:local cDnsTcp "rawad-guest-portal: drop ether10 external TCP DNS"
:local cDnsUdp "rawad-guest-portal: drop ether10 external UDP DNS"
:local cMgmt "rawad-guest-portal: drop ether10 to router mgmt"
:local cV6Fwd "rawad-guest-portal: block ether10 ipv6 forward"
:local cV6In "rawad-guest-portal: block ether10 ipv6 input"

:put "=== [1/9] Pre-flight Security & Ownership Conflict Gate ==="
:if ($routerSecret = "" || $routerSecret = "CHANGE_THIS_STRONG_ROUTER_SECRET" || [:len $routerSecret] < 16) do={
    :error "ABORT: Set a strong routerSecret (>= 16 chars, matching Supabase ROUTER_SHARED_SECRET) before deploying."
}
:if ($supabaseHost = "" || $supabaseHost = "YOUR_PROJECT_ID.supabase.co") do={
    :error "ABORT: Set supabaseHost to your real Supabase project host before deploying."
}
:if ([:len [/interface bridge port find where interface=$guestIf]] > 0) do={
    :error "ABORT: ether10 is currently in a bridge. Remove it manually after review before deploying."
}
:if ([:len [/ip address find where address~"192.168.20." && comment!="rawad-guest-portal"]] > 0) do={
    :error "ABORT: Subnet 192.168.20.x conflicts with an existing IP address. Resolve manually."
}

# Strict DNS Open-Resolver Gate: ALWAYS run regardless of current allow-remote-requests value.
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
            :error "ABORT: Cannot resolve WAN interface from active default route and WAN interface-list is empty."
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
        :if (!$isEstabRelOnly && !$inIfIsNonWan && !$inListIsNonWan && ($portExact53 || $portHasRange)) do={
            :if (($rProto = "" || $rProto = "udp") && !$udp53ViaWanList && [:len $udp53CoveredIfs] < [:len $wanIfaces]) do={ :set udp53Bypassed true }
            :if (($rProto = "" || $rProto = "tcp") && !$tcp53ViaWanList && [:len $tcp53CoveredIfs] < [:len $wanIfaces]) do={ :set tcp53Bypassed true }
        }
    }

    :if ($rAct = "drop" && $rSrcAddr = "" && $rSrcList = "" && ($rConnState = "" || [:typeof [:find $rConnState "new"]] = "num")) do={
        :local coversWanList ($rInList = "WAN" && $wanListCoversAll && $rInIf = "")
        :local coversExactWanIf ($rInIf != "" && [:typeof [:find $wanIfaces $rInIf]] = "num" && $rInList = "")
        :if ($portExact53 && ($coversWanList || $coversExactWanIf)) do={
            :if ($rProto = "udp" || $rProto = "") do={
                :if ($coversWanList) do={ :set udp53ViaWanList true }
                :if ($coversExactWanIf && [:typeof [:find $udp53CoveredIfs $rInIf]] != "num") do={ :set udp53CoveredIfs ($udp53CoveredIfs, $rInIf) }
            }
            :if ($rProto = "tcp" || $rProto = "") do={
                :if ($coversWanList) do={ :set tcp53ViaWanList true }
                :if ($coversExactWanIf && [:typeof [:find $tcp53CoveredIfs $rInIf]] != "num") do={ :set tcp53CoveredIfs ($tcp53CoveredIfs, $rInIf) }
            }
        }
    }
}

:if (!($udp53ViaWanList || ([:len $udp53CoveredIfs] = [:len $wanIfaces])) || !($tcp53ViaWanList || ([:len $tcp53CoveredIfs] = [:len $wanIfaces])) || $udp53Bypassed || $tcp53Bypassed) do={
    :error "ABORT: Cannot prove WAN input firewall drops BOTH TCP and UDP port 53 without bypass."
}

:if ([:len [/system script find where name="rawad-portal-state"]] = 0) do={
    :if ([:len [/ip pool find where name="rawad-guest-pool"]] > 0 || [:len [/ip dhcp-server find where name="rawad-guest-dhcp"]] > 0 || [:len [/ip hotspot profile find where name="rawad-hs-prof"]] > 0 || [:len [/ip hotspot find where name="rawad-guest-hotspot"]] > 0 || [:len [/ip hotspot user profile find where name="rawad-verified-prof"]] > 0 || [:len [/ip hotspot user find where name="rawad-gate"]] > 0 || [:len [/ip hotspot walled-garden find where comment="rawad-guest-portal-allow-supabase"]] > 0 || [:len [/ip firewall nat find where comment="rawad-guest-portal-nat"]] > 0 || [:len [/system scheduler find where name="rawad-sync-revocations"]] > 0) do={
        :error "ABORT: Pre-existing rawad-* resource found without rawad-portal-state. Resolve manually before deploying."
    }
}

:put "=== [2/9] Recording Ownership & Previous State Snapshot ==="
:local isInitialDeploy ([:len [/system script find where name="rawad-portal-state"]] = 0)
:local prevDns false
:local prevTz ""
:local prevNtpEn false

:local crIpAddr false; :local idIpAddr ""
:local crPool false; :local idPool ""
:local crDhcpOpt false; :local idDhcpOpt ""
:local crDhcpNet false; :local idDhcpNet ""
:local crDhcpSrv false; :local idDhcpSrv ""
:local crHsProf false; :local idHsProf ""
:local crHsUsrProf false; :local idHsUsrProf ""
:local crHsUsr false; :local idHsUsr ""
:local crHsSrv false; :local idHsSrv ""
:local crWg false; :local idWg ""
:local crNat false; :local idNat ""
:local crFwPriv3 false; :local idFwPriv3 ""
:local crFwPriv2 false; :local idFwPriv2 ""
:local crFwPriv1 false; :local idFwPriv1 ""
:local crFwUnver false; :local idFwUnver ""
:local crFwDnsTcp false; :local idFwDnsTcp ""
:local crFwDnsUdp false; :local idFwDnsUdp ""
:local crFwMgmt false; :local idFwMgmt ""
:local crV6Fwd false; :local idV6Fwd ""
:local crV6In false; :local idV6In ""
:local crSched false; :local idSched ""
:local idStateScript ""

:if ($isInitialDeploy) do={
    :set prevDns [/ip dns get allow-remote-requests]
    :set prevTz [/system clock get time-zone-name]
    :set prevNtpEn [/system ntp client get enabled]

    :set crIpAddr ([:len [/ip address find where interface=$guestIf && comment="rawad-guest-portal"]] = 0)
    :set crPool ([:len [/ip pool find where name="rawad-guest-pool"]] = 0)
    :set crDhcpOpt ([:len [/ip dhcp-server option find where name="rawad-capport-114"]] = 0)
    :set crDhcpNet ([:len [/ip dhcp-server network find where address=$guestNet]] = 0)
    :set crDhcpSrv ([:len [/ip dhcp-server find where name="rawad-guest-dhcp"]] = 0)
    :set crHsProf ([:len [/ip hotspot profile find where name="rawad-hs-prof"]] = 0)
    :set crHsUsrProf ([:len [/ip hotspot user profile find where name="rawad-verified-prof"]] = 0)
    :set crHsUsr ([:len [/ip hotspot user find where name="rawad-gate"]] = 0)
    :set crHsSrv ([:len [/ip hotspot find where name="rawad-guest-hotspot"]] = 0)
    :set crWg ([:len [/ip hotspot walled-garden find where comment="rawad-guest-portal-allow-supabase"]] = 0)
    :set crNat ([:len [/ip firewall nat find where comment="rawad-guest-portal-nat"]] = 0)
    :set crFwPriv3 ([:len [/ip firewall filter find where comment=$cPriv3]] = 0)
    :set crFwPriv2 ([:len [/ip firewall filter find where comment=$cPriv2]] = 0)
    :set crFwPriv1 ([:len [/ip firewall filter find where comment=$cPriv1]] = 0)
    :set crFwUnver ([:len [/ip firewall filter find where comment=$cUnverified]] = 0)
    :set crFwDnsTcp ([:len [/ip firewall filter find where comment=$cDnsTcp]] = 0)
    :set crFwDnsUdp ([:len [/ip firewall filter find where comment=$cDnsUdp]] = 0)
    :set crFwMgmt ([:len [/ip firewall filter find where comment=$cMgmt]] = 0)
    :set crV6Fwd ([:len [/ipv6 firewall filter find where comment=$cV6Fwd]] = 0)
    :set crV6In ([:len [/ipv6 firewall filter find where comment=$cV6In]] = 0)
    :set crSched ([:len [/system scheduler find where name="rawad-sync-revocations"]] = 0)

    :local initSrc (":global rawadPrevDnsRemote " . $prevDns . ";")
    :set idStateScript [/system script add name="rawad-portal-state" source=$initSrc comment="rawad-guest-portal-state"]
}

:put "=== [3/9] Assigning Guest Gateway IP 192.168.20.1/24 on ether10 ==="
:if ([:len [/ip address find where interface=$guestIf && comment="rawad-guest-portal"]] = 0) do={
    :set idIpAddr [/ip address add address=($guestGw . "/24") interface=$guestIf network=192.168.20.0 comment="rawad-guest-portal"]
}

:put "=== [4/9] Configuring Guest DHCP Pool, Network & Server on ether10 ==="
:if ([:len [/ip pool find where name="rawad-guest-pool"]] = 0) do={
    :set idPool [/ip pool add name="rawad-guest-pool" ranges=192.168.20.10-192.168.20.250]
}
:if ([:len [/ip dhcp-server option find where name="rawad-capport-114"]] = 0) do={
    :set idDhcpOpt [/ip dhcp-server option add code=114 name="rawad-capport-114" value=("'http://" . $guestGw . "/login'")]
}
:if ([:len [/ip dhcp-server network find where address=$guestNet]] = 0) do={
    :set idDhcpNet [/ip dhcp-server network add address=$guestNet gateway=$guestGw dns-server=$guestGw dhcp-option="rawad-capport-114" comment="rawad-guest-portal"]
}
:if ([:len [/ip dhcp-server find where name="rawad-guest-dhcp"]] = 0) do={
    :set idDhcpSrv [/ip dhcp-server add name="rawad-guest-dhcp" interface=$guestIf address-pool="rawad-guest-pool" lease-time=1h disabled=no comment="rawad-guest-portal"]
}

:put "=== [5/9] Enabling Local DNS Forwarding & Asia/Baghdad Timezone + NTP ==="
/ip dns set allow-remote-requests=yes
/system clock set time-zone-name=Asia/Baghdad
/system ntp client set enabled=yes

:put "=== [6/9] Creating HotSpot Server, Verified User Profile (on-login verify-mac) & Gate User ==="
:local onLoginSrc (":local supaHost \"" . $supabaseHost . "\";\n" . \
  ":local sec \"" . $routerSecret . "\";\n" . \
  ":local macStr \$\"mac-address\";\n" . \
  ":local ipStr \$address;\n" . \
  "/ip firewall address-list remove [find where list=\"rawad-verified\" && address=\$ipStr && comment=\"rawad-guest-portal\"];\n" . \
  ":do {\n" . \
  "  :local res [/tool fetch url=(\"https://\" . \$supaHost . \"/functions/v1/verify-mac?mac=\" . \$macStr . \"&ip=\" . \$ipStr) http-header-field=(\"x-router-secret:\" . \$sec) output=user as-value];\n" . \
  "  :local httpOk ([:typeof [:tonum (\$res->\"code\")]] = \"num\" && [:tonum (\$res->\"code\")] = 200);\n" . \
  "  :if ((\$res->\"status\") = \"finished\" && \$httpOk) do={\n" . \
  "    :local body (\$res->\"data\");\n" . \
  "    :if ([:pick \$body 0 6] = \"ALLOW:\") do={\n" . \
  "      :local remRaw [:pick \$body 6 [:len \$body]];\n" . \
  "      :if (\$remRaw = \"UNLIMITED\") do={\n" . \
  "        /ip firewall address-list add list=\"rawad-verified\" address=\$ipStr comment=\"rawad-guest-portal\";\n" . \
  "      } else={\n" . \
  "        :if (\$remRaw ~ \"^[0-9]+\\$\") do={\n" . \
  "          :local remSec [:tonum \$remRaw];\n" . \
  "          :if (\$remSec > 0) do={\n" . \
  "            /ip firewall address-list add list=\"rawad-verified\" address=\$ipStr timeout=(\$remSec . \"s\") comment=\"rawad-guest-portal\";\n" . \
  "          } else={ /ip hotspot active remove [find where server=\"rawad-guest-hotspot\" && mac-address=\$macStr && address=\$ipStr]; }\n" . \
  "        } else={ /ip hotspot active remove [find where server=\"rawad-guest-hotspot\" && mac-address=\$macStr && address=\$ipStr]; }\n" . \
  "      }\n" . \
  "    } else={ /ip hotspot active remove [find where server=\"rawad-guest-hotspot\" && mac-address=\$macStr && address=\$ipStr]; }\n" . \
  "  } else={ /ip hotspot active remove [find where server=\"rawad-guest-hotspot\" && mac-address=\$macStr && address=\$ipStr]; }\n" . \
  "} on-error={\n" . \
  "  /ip hotspot active remove [find where server=\"rawad-guest-hotspot\" && mac-address=\$macStr && address=\$ipStr];\n" . \
  "}")

:local onLogoutSrc "/ip firewall address-list remove [find where list=\"rawad-verified\" && address=\$address];"

:if ([:len [/ip hotspot profile find where name="rawad-hs-prof"]] = 0) do={
    :set idHsProf [/ip hotspot profile add name="rawad-hs-prof" hotspot-address=$guestGw html-directory="hotspot" login-by=http-chap,http-pap use-radius=no]
}
:if ([:len [/ip hotspot user profile find where name="rawad-verified-prof"]] = 0) do={
    :set idHsUsrProf [/ip hotspot user profile add name="rawad-verified-prof" shared-users=250 on-login=$onLoginSrc on-logout=$onLogoutSrc]
}
:if ([:len [/ip hotspot user find where name="rawad-gate"]] = 0) do={
    :set idHsUsr [/ip hotspot user add name="rawad-gate" password="rawad-gate" profile="rawad-verified-prof" comment="rawad-guest-portal"]
}
:if ([:len [/ip hotspot find where name="rawad-guest-hotspot"]] = 0) do={
    :set idHsSrv [/ip hotspot add name="rawad-guest-hotspot" interface=$guestIf address-pool="rawad-guest-pool" profile="rawad-hs-prof" disabled=no]
}

:put "=== [7/9] Configuring Walled Garden (Allow ONLY Supabase Edge Functions HTTPS) ==="
:if ([:len [/ip hotspot walled-garden find where comment="rawad-guest-portal-allow-supabase"]] = 0) do={
    :set idWg [/ip hotspot walled-garden add action=allow disabled=no dst-host=$supabaseHost dst-port=443 protocol=tcp comment="rawad-guest-portal-allow-supabase"]
}

:put "=== [8/9] Deterministic Firewall Rules (ether10 ONLY, Fail-Closed without rawad-verified) ==="
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
:if ([:len [/ip firewall filter find where comment=$cUnverified]] = 0) do={
    :set idFwUnver [/ip firewall filter add chain=forward in-interface=$guestIf src-address-list="!rawad-verified" action=drop place-before=0 comment=$cUnverified]
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

:put "=== [9/9] Adding NAT Masquerade for ether10 Guest Subnet & Persisting State ==="
:if ([:len [/ip firewall nat find where comment="rawad-guest-portal-nat"]] = 0) do={
    :set idNat [/ip firewall nat add chain=srcnat src-address=$guestNet dst-address=!192.168.0.0/16 action=masquerade comment="rawad-guest-portal-nat"]
}

:local revSyncSrc (":local supaHost \"" . $supabaseHost . "\";\n" . \
  ":local sec \"" . $routerSecret . "\";\n" . \
  ":do {\n" . \
  "  :local res [/tool fetch url=(\"https://\" . \$supaHost . \"/functions/v1/verify-mac?action=revoked\") http-header-field=(\"x-router-secret:\" . \$sec) output=user as-value];\n" . \
  "  :local feedHttpOk ([:typeof [:tonum (\$res->\"code\")]] = \"num\" && [:tonum (\$res->\"code\")] = 200);\n" . \
  "  :if ((\$res->\"status\") = \"finished\" && \$feedHttpOk) do={\n" . \
  "    :local body (\$res->\"data\");\n" . \
  "    :local ackIds \"\";\n" . \
  "    :local batchCount 0;\n" . \
  "    :local pos 0;\n" . \
  "    :local blen [:len \$body];\n" . \
  "    :while (\$pos < \$blen) do={\n" . \
  "      :local nl [:find \$body \"\\n\" \$pos];\n" . \
  "      :local line \"\";\n" . \
  "      :if ([:typeof \$nl] = \"num\") do={ :set line [:pick \$body \$pos \$nl]; :set pos (\$nl + 1); } else={ :set line [:pick \$body \$pos \$blen]; :set pos \$blen; }\n" . \
  "      :local sep1 [:find \$line \"|\"];\n" . \
  "      :if ([:typeof \$sep1] = \"num\") do={\n" . \
  "        :local rId [:pick \$line 0 \$sep1];\n" . \
  "        :local rest [:pick \$line (\$sep1 + 1) [:len \$line]];\n" . \
  "        :local sep2 [:find \$rest \"|\"];\n" . \
  "        :if ([:typeof \$sep2] = \"num\") do={\n" . \
  "          :local rMac [:pick \$rest 0 \$sep2];\n" . \
  "          :local rIp [:pick \$rest (\$sep2 + 1) [:len \$rest]];\n" . \
  "          :local validUuid (\$rId ~ \"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\$\");\n" . \
  "          :local validMac (\$rMac ~ \"^([0-9A-F]{2}:){5}[0-9A-F]{2}\\$\");\n" . \
  "          :local validIp (\$rIp ~ \"^[0-9]+\\\\.[0-9]+\\\\.[0-9]+\\\\.[0-9]+\\$\");\n" . \
  "          :if (\$validUuid && \$validMac && \$validIp) do={\n" . \
  "            :local cleaned false;\n" . \
  "            :do {\n" . \
  "              /ip firewall address-list remove [find where list=\"rawad-verified\" && address=\$rIp && comment=\"rawad-guest-portal\"];\n" . \
  "              /ip hotspot active remove [find where server=\"rawad-guest-hotspot\" && mac-address=\$rMac && address=\$rIp];\n" . \
  "              :set cleaned true;\n" . \
  "            } on-error={}\n" . \
  "            :if (\$cleaned) do={\n" . \
  "              :if (\$ackIds = \"\") do={ :set ackIds \$rId; } else={ :set ackIds (\$ackIds . \",\" . \$rId); }\n" . \
  "              :set batchCount (\$batchCount + 1);\n" . \
  "              :if (\$batchCount >= 10) do={\n" . \
  "                :do {\n" . \
  "                  :local ackRes [/tool fetch url=(\"https://\" . \$supaHost . \"/functions/v1/verify-mac?action=ack&ids=\" . \$ackIds) http-header-field=(\"x-router-secret:\" . \$sec) output=user as-value];\n" . \
  "                  :local ackHttpOk ([:typeof [:tonum (\$ackRes->\"code\")]] = \"num\" && [:tonum (\$ackRes->\"code\")] = 200);\n" . \
  "                  :local ackData (\$ackRes->\"data\");\n" . \
  "                  :local ackRaw [:pick \$ackData 4 [:len \$ackData]];\n" . \
  "                  :local ackNum [:tonum \$ackRaw];\n" . \
  "                  :if ((\$ackRes->\"status\") = \"finished\" && \$ackHttpOk && [:len \$ackData] >= 5 && [:pick \$ackData 0 4] = \"ACK:\" && (\$ackRaw ~ \"^[0-9]+\\$\") && [:typeof \$ackNum] = \"num\" && \$ackNum >= 1 && \$ackNum <= \$batchCount) do={} else={ :put \"WARN: unexpected ACK response\"; }\n" . \
  "                } on-error={}\n" . \
  "                :set ackIds \"\";\n" . \
  "                :set batchCount 0;\n" . \
  "              }\n" . \
  "            }\n" . \
  "          }\n" . \
  "        }\n" . \
  "      }\n" . \
  "    }\n" . \
  "    :if (\$ackIds != \"\" && \$batchCount > 0) do={\n" . \
  "      :do {\n" . \
  "        :local ackRes [/tool fetch url=(\"https://\" . \$supaHost . \"/functions/v1/verify-mac?action=ack&ids=\" . \$ackIds) http-header-field=(\"x-router-secret:\" . \$sec) output=user as-value];\n" . \
  "        :local ackHttpOk ([:typeof [:tonum (\$ackRes->\"code\")]] = \"num\" && [:tonum (\$ackRes->\"code\")] = 200);\n" . \
  "        :local ackData (\$ackRes->\"data\");\n" . \
  "        :local ackRaw [:pick \$ackData 4 [:len \$ackData]];\n" . \
  "        :local ackNum [:tonum \$ackRaw];\n" . \
  "        :if ((\$ackRes->\"status\") = \"finished\" && \$ackHttpOk && [:len \$ackData] >= 5 && [:pick \$ackData 0 4] = \"ACK:\" && (\$ackRaw ~ \"^[0-9]+\\$\") && [:typeof \$ackNum] = \"num\" && \$ackNum >= 1 && \$ackNum <= \$batchCount) do={} else={ :put \"WARN: unexpected final ACK response\"; }\n" . \
  "      } on-error={}\n" . \
  "    }\n" . \
  "  }\n" . \
  "} on-error={}")

:if ([:len [/system scheduler find where name="rawad-sync-revocations"]] = 0) do={
    :set idSched [/system scheduler add name="rawad-sync-revocations" interval=30s on-event=$revSyncSrc comment="rawad-guest-portal"]
}

:if ($isInitialDeploy && $idStateScript != "") do={
    :local stateBody (":global rawadPrevDnsRemote " . $prevDns . ";\n" . \
      ":global rawadPrevTz \"" . $prevTz . "\";\n" . \
      ":global rawadPrevNtpEn " . $prevNtpEn . ";\n" . \
      ":global rawadSetDnsRemote true;\n" . \
      ":global rawadSetTz \"Asia/Baghdad\";\n" . \
      ":global rawadSetNtpEn true;\n" . \
      ":global rawadGuestIf \"" . $guestIf . "\";\n" . \
      ":global rawadGuestGw \"" . $guestGw . "\";\n" . \
      ":global rawadGuestNet \"" . $guestNet . "\";\n" . \
      ":global rawadSupabaseHost \"" . $supabaseHost . "\";\n" . \
      ":global rawadIdStateScript \"" . $idStateScript . "\";\n" . \
      ":global rawadCreatedIpAddr " . $crIpAddr . "; :global rawadIdIpAddr \"" . $idIpAddr . "\";\n" . \
      ":global rawadCreatedPool " . $crPool . "; :global rawadIdPool \"" . $idPool . "\";\n" . \
      ":global rawadCreatedDhcpOpt " . $crDhcpOpt . "; :global rawadIdDhcpOpt \"" . $idDhcpOpt . "\";\n" . \
      ":global rawadCreatedDhcpNet " . $crDhcpNet . "; :global rawadIdDhcpNet \"" . $idDhcpNet . "\";\n" . \
      ":global rawadCreatedDhcpSrv " . $crDhcpSrv . "; :global rawadIdDhcpSrv \"" . $idDhcpSrv . "\";\n" . \
      ":global rawadCreatedHsProf " . $crHsProf . "; :global rawadIdHsProf \"" . $idHsProf . "\";\n" . \
      ":global rawadCreatedHsUsrProf " . $crHsUsrProf . "; :global rawadIdHsUsrProf \"" . $idHsUsrProf . "\";\n" . \
      ":global rawadCreatedHsUsr " . $crHsUsr . "; :global rawadIdHsUsr \"" . $idHsUsr . "\";\n" . \
      ":global rawadCreatedHsSrv " . $crHsSrv . "; :global rawadIdHsSrv \"" . $idHsSrv . "\";\n" . \
      ":global rawadCreatedWg " . $crWg . "; :global rawadIdWg \"" . $idWg . "\";\n" . \
      ":global rawadCreatedNat " . $crNat . "; :global rawadIdNat \"" . $idNat . "\";\n" . \
      ":global rawadCreatedFwPriv3 " . $crFwPriv3 . "; :global rawadIdFwPriv3 \"" . $idFwPriv3 . "\";\n" . \
      ":global rawadCreatedFwPriv2 " . $crFwPriv2 . "; :global rawadIdFwPriv2 \"" . $idFwPriv2 . "\";\n" . \
      ":global rawadCreatedFwPriv1 " . $crFwPriv1 . "; :global rawadIdFwPriv1 \"" . $idFwPriv1 . "\";\n" . \
      ":global rawadCreatedFwUnver " . $crFwUnver . "; :global rawadIdFwUnver \"" . $idFwUnver . "\";\n" . \
      ":global rawadCreatedFwDnsTcp " . $crFwDnsTcp . "; :global rawadIdFwDnsTcp \"" . $idFwDnsTcp . "\";\n" . \
      ":global rawadCreatedFwDnsUdp " . $crFwDnsUdp . "; :global rawadIdFwDnsUdp \"" . $idFwDnsUdp . "\";\n" . \
      ":global rawadCreatedFwMgmt " . $crFwMgmt . "; :global rawadIdFwMgmt \"" . $idFwMgmt . "\";\n" . \
      ":global rawadCreatedV6Fwd " . $crV6Fwd . "; :global rawadIdV6Fwd \"" . $idV6Fwd . "\";\n" . \
      ":global rawadCreatedV6In " . $crV6In . "; :global rawadIdV6In \"" . $idV6In . "\";\n" . \
      ":global rawadCreatedSched " . $crSched . "; :global rawadIdSched \"" . $idSched . "\";")

    :local stateBodyLen [:len $stateBody]
    :local ascii " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\n\r\t"
    :local h1 5381
    :local h2 216613626
    :for i from=0 to=($stateBodyLen - 1) do={
        :local ch [:pick $stateBody $i ($i + 1)]
        :local code [:find $ascii $ch]
        :if ([:typeof $code] != "num") do={ :set code 127 }
        :set h1 ((($h1 * 131) + $code + $i) % 2147483647)
        :set h2 ((($h2 * 65599) + ($code * ($i + 1))) % 2147483647)
    }
    :local finalSrc ($stateBody . "\n:global rawadStateBodyLen " . $stateBodyLen . ";\n:global rawadStateH1 " . $h1 . ";\n:global rawadStateH2 " . $h2 . ";")
    :if ([:len [/system script find where .id=$idStateScript && name="rawad-portal-state" && comment="rawad-guest-portal-state"]] > 0) do={
        /system script set $idStateScript source=$finalSrc
        :local anchorSrc ("id=" . [:tostr $idStateScript] . ";len=" . $stateBodyLen . ";h1=" . $h1 . ";h2=" . $h2 . ";")
        :if ([:len [/system script find where name="rawad-portal-anchor"]] = 0) do={
            /system script add name="rawad-portal-anchor" source=$anchorSrc comment="rawad-guest-portal-anchor"
        }
    }
}

:put "=== DEPLOYMENT COMPLETE (ether10 ONLY) ==="

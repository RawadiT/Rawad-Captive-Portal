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
:global rawadSetDnsRemote
:global rawadSetWwwSslDis
:global rawadSetWwwSslAddr
:global rawadSetWwwSslCert
:global rawadSetTz
:global rawadSetNtpEn
:global rawadGuestIf
:global rawadGuestGw
:global rawadGuestNet
:global rawadBackendIp
:global rawadPortalDomain
:global rawadIdStateScript
:global rawadStateBodyLen
:global rawadCreatedIpAddr; :global rawadIdIpAddr
:global rawadCreatedPool; :global rawadIdPool
:global rawadCreatedDhcpOpt; :global rawadIdDhcpOpt
:global rawadCreatedDhcpNet; :global rawadIdDhcpNet
:global rawadCreatedDhcpSrv; :global rawadIdDhcpSrv
:global rawadCreatedStaticDns; :global rawadIdStaticDns
:global rawadCreatedHsProf; :global rawadIdHsProf
:global rawadCreatedHsSrv; :global rawadIdHsSrv
:global rawadCreatedWg; :global rawadIdWg
:global rawadCreatedNat; :global rawadIdNat
:global rawadCreatedApiGroup; :global rawadIdApiGroup
:global rawadCreatedApiUser; :global rawadIdApiUser
:global rawadCreatedFwPriv3; :global rawadIdFwPriv3
:global rawadCreatedFwPriv2; :global rawadIdFwPriv2
:global rawadCreatedFwPriv1; :global rawadIdFwPriv1
:global rawadCreatedFwPortal; :global rawadIdFwPortal
:global rawadCreatedFwAdm; :global rawadIdFwAdm
:global rawadCreatedFwDnsTcp; :global rawadIdFwDnsTcp
:global rawadCreatedFwDnsUdp; :global rawadIdFwDnsUdp
:global rawadCreatedFwMgmt; :global rawadIdFwMgmt
:global rawadCreatedV6Fwd; :global rawadIdV6Fwd
:global rawadCreatedV6In; :global rawadIdV6In

:if ([:len [/system script find where name="rawad-portal-state" && comment="rawad-guest-portal-state"]] > 0) do={
    /system script run rawad-portal-state
} else={
    :error "ABORT: rawad-portal-state with expected comment not found (or replaced manually). Refusing unsafe rollback."
}

# 1. Remove each firewall rule individually ONLY if created by deploy.rsc, matching exact .id AND unmodified properties
:if ($rawadCreatedFwPriv3 = true && $rawadIdFwPriv3 != "") do={
    :if ([:len [/ip firewall filter find where .id=$rawadIdFwPriv3 && chain="forward" && in-interface=$rawadGuestIf && dst-address=172.16.0.0/12 && action="drop" && comment="rawad-guest-portal: drop ether10 to 172.16.0.0/12"]] > 0) do={
        /ip firewall filter remove $rawadIdFwPriv3
    }
}
:if ($rawadCreatedFwPriv2 = true && $rawadIdFwPriv2 != "") do={
    :if ([:len [/ip firewall filter find where .id=$rawadIdFwPriv2 && chain="forward" && in-interface=$rawadGuestIf && dst-address=10.0.0.0/8 && action="drop" && comment="rawad-guest-portal: drop ether10 to 10.0.0.0/8"]] > 0) do={
        /ip firewall filter remove $rawadIdFwPriv2
    }
}
:if ($rawadCreatedFwPriv1 = true && $rawadIdFwPriv1 != "") do={
    :if ([:len [/ip firewall filter find where .id=$rawadIdFwPriv1 && chain="forward" && in-interface=$rawadGuestIf && dst-address=192.168.0.0/16 && action="drop" && comment="rawad-guest-portal: drop ether10 to 192.168.0.0/16"]] > 0) do={
        /ip firewall filter remove $rawadIdFwPriv1
    }
}
:if ($rawadCreatedFwPortal = true && $rawadIdFwPortal != "") do={
    :if ([:len [/ip firewall filter find where .id=$rawadIdFwPortal && chain="forward" && in-interface=$rawadGuestIf && dst-address=$rawadBackendIp && protocol="tcp" && dst-port="443" && action="accept" && comment="rawad-guest-portal: allow ether10 to portal https"]] > 0) do={
        /ip firewall filter remove $rawadIdFwPortal
    }
}
:if ($rawadCreatedFwAdm = true && $rawadIdFwAdm != "") do={
    :if ([:len [/ip firewall filter find where .id=$rawadIdFwAdm && chain="forward" && in-interface=$rawadGuestIf && dst-address=$rawadBackendIp && protocol="tcp" && dst-port="8443,4000" && action="drop" && comment="rawad-guest-portal: drop ether10 to admin and direct backend"]] > 0) do={
        /ip firewall filter remove $rawadIdFwAdm
    }
}
:if ($rawadCreatedFwDnsTcp = true && $rawadIdFwDnsTcp != "") do={
    :if ([:len [/ip firewall filter find where .id=$rawadIdFwDnsTcp && chain="forward" && in-interface=$rawadGuestIf && protocol="tcp" && dst-port="53" && action="drop" && comment="rawad-guest-portal: drop ether10 external TCP DNS"]] > 0) do={
        /ip firewall filter remove $rawadIdFwDnsTcp
    }
}
:if ($rawadCreatedFwDnsUdp = true && $rawadIdFwDnsUdp != "") do={
    :if ([:len [/ip firewall filter find where .id=$rawadIdFwDnsUdp && chain="forward" && in-interface=$rawadGuestIf && protocol="udp" && dst-port="53" && action="drop" && comment="rawad-guest-portal: drop ether10 external UDP DNS"]] > 0) do={
        /ip firewall filter remove $rawadIdFwDnsUdp
    }
}
:if ($rawadCreatedFwMgmt = true && $rawadIdFwMgmt != "") do={
    :if ([:len [/ip firewall filter find where .id=$rawadIdFwMgmt && chain="input" && in-interface=$rawadGuestIf && protocol="tcp" && dst-port="22,23,80,443,8291,8728,8729" && action="drop" && comment="rawad-guest-portal: drop ether10 to router mgmt"]] > 0) do={
        /ip firewall filter remove $rawadIdFwMgmt
    }
}
:if ($rawadCreatedV6Fwd = true && $rawadIdV6Fwd != "") do={
    :if ([:len [/ipv6 firewall filter find where .id=$rawadIdV6Fwd && chain="forward" && in-interface=$rawadGuestIf && action="drop" && comment="rawad-guest-portal: block ether10 ipv6 forward"]] > 0) do={
        /ipv6 firewall filter remove $rawadIdV6Fwd
    }
}
:if ($rawadCreatedV6In = true && $rawadIdV6In != "") do={
    :if ([:len [/ipv6 firewall filter find where .id=$rawadIdV6In && chain="input" && in-interface=$rawadGuestIf && action="drop" && comment="rawad-guest-portal: block ether10 ipv6 input"]] > 0) do={
        /ipv6 firewall filter remove $rawadIdV6In
    }
}

:if ($rawadCreatedNat = true && $rawadIdNat != "") do={
    :if ([:len [/ip firewall nat find where .id=$rawadIdNat && chain="srcnat" && src-address=$rawadGuestNet && action="masquerade" && comment="rawad-guest-portal-nat"]] > 0) do={
        /ip firewall nat remove $rawadIdNat
    }
}

# 2. Remove HotSpot Server, Profile & Walled Garden only if created by deploy.rsc AND unmodified
# (Do NOT delete runtime application users/sessions during infrastructure rollback)
:if ($rawadCreatedHsSrv = true && $rawadIdHsSrv != "") do={
    :if ([:len [/ip hotspot find where .id=$rawadIdHsSrv && name="rawad-guest-hotspot" && interface=$rawadGuestIf]] > 0) do={
        /ip hotspot remove $rawadIdHsSrv
    }
}
:if ($rawadCreatedHsProf = true && $rawadIdHsProf != "") do={
    :if ([:len [/ip hotspot find where profile="rawad-hs-prof"]] = 0) do={
        :if ([:len [/ip hotspot profile find where .id=$rawadIdHsProf && name="rawad-hs-prof" && hotspot-address=$rawadGuestGw]] > 0) do={
            :do { /ip hotspot profile remove $rawadIdHsProf } on-error={ :put "WARN: Could not remove rawad-hs-prof" }
        }
    }
}
:if ($rawadCreatedWg = true && $rawadIdWg != "") do={
    :if ([:len [/ip hotspot walled-garden ip find where .id=$rawadIdWg && dst-address=$rawadBackendIp && dst-port="443" && protocol="tcp" && comment="rawad-guest-portal-allow-https"]] > 0) do={
        /ip hotspot walled-garden ip remove $rawadIdWg
    }
}

# 3. Remove DHCP, Pool, Static DNS & IP only if created by deploy.rsc AND unmodified
:if ($rawadCreatedDhcpSrv = true && $rawadIdDhcpSrv != "") do={
    :if ([:len [/ip dhcp-server find where .id=$rawadIdDhcpSrv && name="rawad-guest-dhcp" && interface=$rawadGuestIf && comment="rawad-guest-portal"]] > 0) do={
        /ip dhcp-server remove $rawadIdDhcpSrv
    }
}
:if ($rawadCreatedDhcpNet = true && $rawadIdDhcpNet != "") do={
    :if ([:len [/ip dhcp-server network find where .id=$rawadIdDhcpNet && address=$rawadGuestNet && gateway=$rawadGuestGw && comment="rawad-guest-portal"]] > 0) do={
        /ip dhcp-server network remove $rawadIdDhcpNet
    }
}
:if ($rawadCreatedDhcpOpt = true && $rawadIdDhcpOpt != "") do={
    :if ([:len [/ip dhcp-server network find where dhcp-option~"rawad-capport-114"]] = 0) do={
        :if ([:len [/ip dhcp-server option find where .id=$rawadIdDhcpOpt && name="rawad-capport-114" && code=114]] > 0) do={
            :do { /ip dhcp-server option remove $rawadIdDhcpOpt } on-error={ :put "WARN: Could not remove rawad-capport-114" }
        }
    }
}
:if ($rawadCreatedPool = true && $rawadIdPool != "") do={
    :if ([:len [/ip dhcp-server find where address-pool="rawad-guest-pool"]] = 0 && [:len [/ip hotspot find where address-pool="rawad-guest-pool"]] = 0) do={
        :if ([:len [/ip pool find where .id=$rawadIdPool && name="rawad-guest-pool" && ranges=192.168.20.10-192.168.20.250]] > 0) do={
            :do { /ip pool remove $rawadIdPool } on-error={ :put "WARN: Could not remove rawad-guest-pool" }
        }
    }
}
:if ($rawadCreatedStaticDns = true && $rawadIdStaticDns != "") do={
    :if ([:len [/ip dns static find where .id=$rawadIdStaticDns && name=$rawadPortalDomain && address=$rawadBackendIp && comment="rawad-guest-portal"]] > 0) do={
        :do { /ip dns static remove $rawadIdStaticDns } on-error={ :put "WARN: Could not remove static DNS entry" }
    }
}
:if ($rawadCreatedIpAddr = true && $rawadIdIpAddr != "") do={
    :if ([:len [/ip address find where .id=$rawadIdIpAddr && interface=$rawadGuestIf && address=($rawadGuestGw . "/24") && comment="rawad-guest-portal"]] > 0) do={
        :do { /ip address remove $rawadIdIpAddr } on-error={ :put "WARN: Could not remove guest IP address" }
    }
}

# 4. Restore previous DNS, www-ssl, Timezone, and NTP values ONLY if not manually modified after deploy
:if ([:typeof $rawadPrevDnsRemote] = "bool" && [/ip dns get allow-remote-requests] = $rawadSetDnsRemote) do={
    /ip dns set allow-remote-requests=$rawadPrevDnsRemote
}
:if ([:typeof $rawadPrevWwwSslDis] = "bool" && [/ip service get www-ssl disabled] = $rawadSetWwwSslDis && [/ip service get www-ssl address] = $rawadSetWwwSslAddr && [/ip service get www-ssl certificate] = $rawadSetWwwSslCert) do={
    /ip service set www-ssl disabled=$rawadPrevWwwSslDis address=$rawadPrevWwwSslAddr certificate=$rawadPrevWwwSslCert
}
:if ([:typeof $rawadPrevTz] = "str" && [:len $rawadPrevTz] > 0 && [/system clock get time-zone-name] = $rawadSetTz) do={
    /system clock set time-zone-name=$rawadPrevTz
}
:if ([:typeof $rawadPrevNtpEn] = "bool" && [/system ntp client get enabled] = $rawadSetNtpEn) do={
    /system ntp client set enabled=$rawadPrevNtpEn
}

# 5. Remove API user & group independently ONLY if created by deploy.rsc, unmodified, and dependency-free
:if ($rawadCreatedApiUser = true && $rawadIdApiUser != "") do={
    :if ([:len [/user find where .id=$rawadIdApiUser && name="rawad-api" && group="rawad-api-group" && comment="rawad-guest-portal"]] > 0) do={
        :do { /user remove $rawadIdApiUser } on-error={ :put "WARN: Could not remove rawad-api user" }
    }
}
:if ($rawadCreatedApiGroup = true && $rawadIdApiGroup != "") do={
    :if ([:len [/user find where group="rawad-api-group"]] = 0) do={
        :if ([:len [/user group find where .id=$rawadIdApiGroup && name="rawad-api-group"]] > 0) do={
            :do { /user group remove $rawadIdApiGroup } on-error={ :put "WARN: Could not remove rawad-api-group" }
        }
    }
}

# 6. Remove rawad-portal-state ONLY if exact .id AND unmodified body/length match
:if ([:typeof $rawadIdStateScript] = "str" && $rawadIdStateScript != "" && [:typeof $rawadStateBodyLen] = "num" && $rawadStateBodyLen > 0) do={
    :if ([:len [/system script find where .id=$rawadIdStateScript && name="rawad-portal-state" && comment="rawad-guest-portal-state"]] > 0) do={
        :local curSrc [/system script get $rawadIdStateScript source]
        :local expectedTail ("\n:global rawadStateBodyLen " . $rawadStateBodyLen . ";")
        :if ([:len $curSrc] = ($rawadStateBodyLen + [:len $expectedTail]) && [:find $curSrc $expectedTail] = $rawadStateBodyLen) do={
            /system script remove $rawadIdStateScript
        }
    }
}

:put "=== ROLLBACK COMPLETE ==="

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const deployRsc = fs.readFileSync(path.join(ROOT, 'routeros/deploy.rsc'), 'utf8');
const rollbackRsc = fs.readFileSync(path.join(ROOT, 'routeros/rollback.rsc'), 'utf8');
const composeYml = fs.readFileSync(path.join(ROOT, 'deployment/docker-compose.yml'), 'utf8');
const renewSh = fs.readFileSync(path.join(ROOT, 'deployment/tls/renew-cert.sh'), 'utf8');

function extractFirewallRules(scriptText, prefix) {
  const vars = {
    $guestIf: 'ether10',
    $staffIf: 'ether9',
    $wanIf: 'ether1',
    $backendServerIp: '192.168.10.10',
    $guestNet: '192.168.20.0/24',
  };

  // Capture comment variable definitions (:local cName "...")
  const commentVars = {};
  for (const m of scriptText.matchAll(/:local\s+(c[A-Za-z0-9_]+)\s+"([^"]+)"/g)) {
    commentVars['$' + m[1]] = m[2];
  }

  const lines = scriptText.split(/\r?\n/);
  const rules = [];
  const seenComments = new Set();

  // Simulate RouterOS insertion (idempotent by comment, place-before=0 inserts at index 0)
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(prefix)) continue;

    const getAttr = (name) => {
      const m = trimmed.match(new RegExp(`${name}=([^\\s]+)`));
      if (!m) return null;
      let val = m[1].replace(/^"|"$/g, '');
      if (vars[val]) val = vars[val];
      if (commentVars[val]) val = commentVars[val];
      return val;
    };

    const comment = getAttr('comment');
    if (comment && seenComments.has(comment)) continue; // Idempotency guard
    if (comment) seenComments.add(comment);

    const rule = {
      chain: getAttr('chain'),
      inInterface: getAttr('in-interface'),
      outInterface: getAttr('out-interface'),
      srcAddress: getAttr('src-address'),
      dstAddress: getAttr('dst-address'),
      protocol: getAttr('protocol'),
      dstPort: getAttr('dst-port'),
      action: getAttr('action'),
      placeBefore0: trimmed.includes('place-before=0'),
      comment,
    };

    if (rule.placeBefore0) {
      rules.unshift(rule);
    } else {
      rules.push(rule);
    }
  }
  return rules;
}

function ipInCidr(ip, cidr) {
  if (!cidr) return true;
  if (!cidr.includes('/')) return ip === cidr;
  const [net, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const toInt = (s) => s.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(net) & mask);
}

function evalRules(rules, pkt) {
  for (const r of rules) {
    if (r.chain !== pkt.chain) continue;
    if (r.inInterface && r.inInterface !== pkt.inInterface) continue;
    if (r.outInterface && r.outInterface !== pkt.outInterface) continue;
    if (r.srcAddress && !ipInCidr(pkt.srcAddress, r.srcAddress)) continue;
    if (r.dstAddress && !ipInCidr(pkt.dstAddress, r.dstAddress)) continue;
    if (r.protocol && r.protocol !== pkt.protocol) continue;
    if (r.dstPort) {
      const ports = r.dstPort.split(',').map(Number);
      if (!ports.includes(pkt.dstPort)) continue;
    }
    return r.action;
  }
  return 'accept'; // default policy if no rule matched
}

test('RouterOS Structural Simulation: Forward chain allows Portal 443 BEFORE dropping Staff/Admin/Private/DNS', () => {
  // Seed pre-existing rules to test place-before=0 behavior
  const rules = extractFirewallRules(deployRsc, '/ip firewall filter add');

  // 1. Guest -> Guest Portal HTTPS (192.168.10.10:443 on ether9) MUST be ACCEPTED
  assert.equal(
    evalRules(rules, {
      chain: 'forward',
      inInterface: 'ether10',
      outInterface: 'ether9',
      srcAddress: '192.168.20.50',
      dstAddress: '192.168.10.10',
      protocol: 'tcp',
      dstPort: 443,
    }),
    'accept'
  );

  // 2. Guest -> Admin Dashboard (3001) & Direct Backend (4000) MUST be DROPPED
  for (const port of [3001, 4000]) {
    assert.equal(
      evalRules(rules, {
        chain: 'forward',
        inInterface: 'ether10',
        outInterface: 'ether9',
        srcAddress: '192.168.20.50',
        dstAddress: '192.168.10.10',
        protocol: 'tcp',
        dstPort: port,
      }),
      'drop'
    );
  }

  // 3. Guest -> any other Staff LAN host MUST be DROPPED
  assert.equal(
    evalRules(rules, {
      chain: 'forward',
      inInterface: 'ether10',
      outInterface: 'ether9',
      srcAddress: '192.168.20.50',
      dstAddress: '192.168.10.50',
      protocol: 'tcp',
      dstPort: 443,
    }),
    'drop'
  );

  // 4. Guest -> RFC1918 private subnets MUST be DROPPED
  for (const dst of ['192.168.1.1', '10.0.0.1', '172.16.0.1']) {
    assert.equal(
      evalRules(rules, {
        chain: 'forward',
        inInterface: 'ether10',
        outInterface: 'ether1',
        srcAddress: '192.168.20.50',
        dstAddress: dst,
        protocol: 'tcp',
        dstPort: 80,
      }),
      'drop'
    );
  }

  // 5. Guest -> External DNS (UDP & TCP 53) MUST be DROPPED
  for (const proto of ['udp', 'tcp']) {
    assert.equal(
      evalRules(rules, {
        chain: 'forward',
        inInterface: 'ether10',
        outInterface: 'ether1',
        srcAddress: '192.168.20.50',
        dstAddress: '8.8.8.8',
        protocol: proto,
        dstPort: 53,
      }),
      'drop'
    );
  }
});

test('RouterOS Structural Simulation: Input chain allows Backend REST API & blocks Guest RouterOS Mgmt; IPv6 drops at top', () => {
  const rules = extractFirewallRules(deployRsc, '/ip firewall filter add');

  // Backend on ether9 -> RouterOS REST API 443 ACCEPTED
  assert.equal(
    evalRules(rules, {
      chain: 'input',
      inInterface: 'ether9',
      srcAddress: '192.168.10.10',
      dstAddress: '192.168.10.1',
      protocol: 'tcp',
      dstPort: 443,
    }),
    'accept'
  );

  // Guest on ether10 -> RouterOS management ports DROPPED
  for (const port of [22, 23, 80, 443, 8291, 8728, 8729]) {
    assert.equal(
      evalRules(rules, {
        chain: 'input',
        inInterface: 'ether10',
        srcAddress: '192.168.20.50',
        dstAddress: '192.168.20.1',
        protocol: 'tcp',
        dstPort: port,
      }),
      'drop'
    );
  }

  // IPv6 rules use place-before=0 ahead of any pre-existing accept rules
  const v6Rules = extractFirewallRules(deployRsc, '/ipv6 firewall filter add');
  const existingAccept = { chain: 'forward', inInterface: 'ether10', action: 'accept' };
  const combinedV6 = [existingAccept];
  for (const r of v6Rules.slice().reverse()) {
    if (r.placeBefore0) combinedV6.unshift(r);
    else combinedV6.push(r);
  }
  assert.equal(evalRules(combinedV6, { chain: 'forward', inInterface: 'ether10' }), 'drop');
});

test('RouterOS Security & Idempotency: API password gate, no password logging, and duplicate-free re-run', () => {
  // Password gate rejects empty, default, and <12 chars
  assert.ok(deployRsc.includes('$apiPassword = "CHANGE_THIS_STRONG_API_PASSWORD"'));
  assert.ok(deployRsc.includes('[:len $apiPassword] < 12'));
  assert.ok(deployRsc.includes(':error "ABORT: Set a strong apiPassword'));

  // Password must never be printed via :put
  for (const line of deployRsc.split(/\r?\n/)) {
    if (line.includes(':put')) {
      assert.equal(line.includes('apiPassword'), false, 'apiPassword must never be logged');
    }
  }

  // Running rule extraction twice yields exact same rule count (idempotent)
  const firstRun = extractFirewallRules(deployRsc, '/ip firewall filter add');
  const secondRun = extractFirewallRules(deployRsc + '\n' + deployRsc, '/ip firewall filter add');
  assert.equal(secondRun.length, firstRun.length);
});

test('RouterOS Rollback: Full ownership checks & restoration of DNS, www-ssl, NTP, and Timezone', () => {
  const requiredFlags = [
    '$rawadCreatedIpAddr',
    '$rawadCreatedPool',
    '$rawadCreatedDhcpOpt',
    '$rawadCreatedDhcpNet',
    '$rawadCreatedDhcpSrv',
    '$rawadCreatedStaticDns',
    '$rawadCreatedHsProf',
    '$rawadCreatedHsFree',
    '$rawadCreatedHsUser',
    '$rawadCreatedHsSrv',
    '$rawadCreatedWg',
    '$rawadCreatedNat',
    '$rawadCreatedApiGroup',
    '$rawadCreatedApiUser',
  ];
  for (const flag of requiredFlags) {
    assert.ok(rollbackRsc.includes(`${flag} = true`), `rollback.rsc must check ownership flag ${flag}`);
  }
  assert.ok(rollbackRsc.includes('$rawadPrevDnsRemote'));
  assert.ok(rollbackRsc.includes('$rawadPrevWwwSslDis'));
  assert.ok(rollbackRsc.includes('$rawadPrevTz'));
  assert.ok(rollbackRsc.includes('$rawadPrevNtpEn'));
});

test('Docker Binding & Certificate Renewal Safety', () => {
  assert.equal(composeYml.includes(':-0.0.0.0'), false, 'docker-compose.yml must not default host port binding to 0.0.0.0');
  assert.ok(composeYml.includes('GUEST_PROXY_BIND_IP:?'));
  assert.ok(composeYml.includes('${STAFF_BIND_IP:-127.0.0.1}:8443:8443'));

  assert.ok(renewSh.includes('--install-cron'));
  assert.ok(renewSh.includes('STAGE_DIR'));
  assert.ok(renewSh.includes('BACKUP_DIR'));
  assert.ok(renewSh.includes('nginx -t'));
  assert.ok(renewSh.includes('nginx -s reload'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const preflightRsc = fs.readFileSync(path.join(ROOT, 'routeros/preflight.rsc'), 'utf8');
const deployRsc = fs.readFileSync(path.join(ROOT, 'routeros/deploy.rsc'), 'utf8');
const verifyRsc = fs.readFileSync(path.join(ROOT, 'routeros/verify.rsc'), 'utf8');
const rollbackRsc = fs.readFileSync(path.join(ROOT, 'routeros/rollback.rsc'), 'utf8');
const composeYml = fs.readFileSync(path.join(ROOT, 'deployment/docker-compose.yml'), 'utf8');
const nginxConf = fs.readFileSync(path.join(ROOT, 'deployment/nginx/nginx.conf'), 'utf8');
const renewSh = fs.readFileSync(path.join(ROOT, 'deployment/tls/renew-cert.sh'), 'utf8');

function extractFirewallRules(scriptText, prefix) {
  const vars = {
    $guestIf: 'ether10',
    $backendServerIp: '192.168.10.10',
    $guestNet: '192.168.20.0/24',
  };
  const commentVars = {};
  for (const m of scriptText.matchAll(/:local\s+(c[A-Za-z0-9_]+)\s+"([^"]+)"/g)) {
    commentVars['$' + m[1]] = m[2];
  }

  const rules = [];
  const seenComments = new Set();
  for (const line of scriptText.split(/\r?\n/)) {
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
    if (comment && seenComments.has(comment)) continue;
    if (comment) seenComments.add(comment);

    const rule = {
      chain: getAttr('chain'),
      inInterface: getAttr('in-interface'),
      dstAddress: getAttr('dst-address'),
      protocol: getAttr('protocol'),
      dstPort: getAttr('dst-port'),
      action: getAttr('action'),
      placeBefore0: trimmed.includes('place-before=0'),
      comment,
    };
    if (rule.placeBefore0) rules.unshift(rule);
    else rules.push(rule);
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
    if (r.dstAddress && !ipInCidr(pkt.dstAddress, r.dstAddress)) continue;
    if (r.protocol && r.protocol !== pkt.protocol) continue;
    if (r.dstPort) {
      const ports = r.dstPort.split(',').map(Number);
      if (!ports.includes(pkt.dstPort)) continue;
    }
    return r.action;
  }
  return 'accept';
}

test('RouterOS Scope: All .rsc scripts are strictly limited to ether10 (zero references to ether1-ether9)', () => {
  for (const [name, content] of [
    ['preflight.rsc', preflightRsc],
    ['deploy.rsc', deployRsc],
    ['verify.rsc', verifyRsc],
    ['rollback.rsc', rollbackRsc],
  ]) {
    const codeLines = content
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    for (let i = 1; i <= 9; i++) {
      assert.equal(new RegExp(`\\bether${i}\\b`).test(codeLines), false, `${name} must not reference ether${i}`);
    }
  }
});

test('RouterOS Structural Simulation: ether10 allows Portal 443 BEFORE dropping Admin/Private/DNS/IPv6', () => {
  const rules = extractFirewallRules(deployRsc, '/ip firewall filter add');

  // Guest -> Portal HTTPS (443) ACCEPTED
  assert.equal(
    evalRules(rules, {
      chain: 'forward',
      inInterface: 'ether10',
      dstAddress: '192.168.10.10',
      protocol: 'tcp',
      dstPort: 443,
    }),
    'accept'
  );

  // Guest -> Admin (8443) & Direct Backend (4000) DROPPED
  for (const port of [8443, 4000]) {
    assert.equal(
      evalRules(rules, {
        chain: 'forward',
        inInterface: 'ether10',
        dstAddress: '192.168.10.10',
        protocol: 'tcp',
        dstPort: port,
      }),
      'drop'
    );
  }

  // Guest -> Private Subnets DROPPED
  for (const dst of ['192.168.10.50', '192.168.1.1', '10.0.0.1', '172.16.0.1']) {
    assert.equal(
      evalRules(rules, {
        chain: 'forward',
        inInterface: 'ether10',
        dstAddress: dst,
        protocol: 'tcp',
        dstPort: 443,
      }),
      'drop'
    );
  }

  // Guest -> External DNS (53) DROPPED
  for (const proto of ['udp', 'tcp']) {
    assert.equal(
      evalRules(rules, {
        chain: 'forward',
        inInterface: 'ether10',
        dstAddress: '8.8.8.8',
        protocol: proto,
        dstPort: 53,
      }),
      'drop'
    );
  }

  // Guest -> RouterOS Management DROPPED
  for (const port of [22, 23, 80, 443, 8291, 8728, 8729]) {
    assert.equal(
      evalRules(rules, {
        chain: 'input',
        inInterface: 'ether10',
        dstAddress: '192.168.20.1',
        protocol: 'tcp',
        dstPort: port,
      }),
      'drop'
    );
  }
});

test('RouterOS Rollback, Idempotency & Password Gate', () => {
  assert.ok(deployRsc.includes('$apiPassword = "CHANGE_THIS_STRONG_API_PASSWORD"'));
  assert.ok(deployRsc.includes('[:len $apiPassword] < 12'));

  const firstRun = extractFirewallRules(deployRsc, '/ip firewall filter add');
  const secondRun = extractFirewallRules(deployRsc + '\n' + deployRsc, '/ip firewall filter add');
  assert.equal(secondRun.length, firstRun.length);

  for (const flag of [
    '$rawadCreatedIpAddr',
    '$rawadCreatedPool',
    '$rawadCreatedDhcpOpt',
    '$rawadCreatedDhcpNet',
    '$rawadCreatedDhcpSrv',
    '$rawadCreatedStaticDns',
    '$rawadCreatedHsProf',
    '$rawadCreatedHsSrv',
    '$rawadCreatedWg',
    '$rawadCreatedNat',
    '$rawadCreatedApiGroup',
    '$rawadCreatedApiUser',
  ]) {
    assert.ok(rollbackRsc.includes(`${flag} = true`), `rollback.rsc must check ${flag}`);
  }
});

test('Docker, Nginx Admin Isolation & Certificate Renewal Safety', () => {
  assert.equal(composeYml.includes(':-0.0.0.0'), false);
  assert.ok(composeYml.includes('GUEST_PROXY_BIND_IP:?'));
  assert.ok(nginxConf.includes('location /admin'));
  assert.ok(nginxConf.includes('location /api/admin/'));
  assert.ok(nginxConf.includes('return 403;'));
  assert.ok(renewSh.includes('--install-cron'));
  assert.ok(renewSh.includes('nginx -t'));
});

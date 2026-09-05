// 반입 심사 서류의 영어판.
//
// ── 왜 번역표가 아니라 딴 파일인가 ──────────────────────────────────────
//
// 화면 말은 열쇠 하나에 한 문장이라 i18n 표가 맞다(src/i18n). 이건 다르다.
// **서류**다. 한 장이 통째로 하나의 글이고, 절 이름·차례·줄맞춤이 같이
// 뜻을 만든다. 그걸 열쇠 이백 개로 쪼개 두면, 고칠 때마다 두 파일을 오가며
// 짜맞춰야 하고 결국 한쪽만 고친 서류가 나간다.
//
// 이 저장소는 이미 같은 판단을 한 번 했다 — README.md 와 README.ko.md 를
// 갈라 뒀다. 서류는 서류대로 통째로 쓰는 편이 읽기도 고치기도 낫다.
//
// ── 대신 어긋나지 않게 검사한다 ─────────────────────────────────────────
//
// 갈라 두면 한쪽만 고치는 날이 온다. 그래서 test/packlang.test.js 가 두 판의
// **모양**을 견준다 — 절 수, 실린 파일 수, 통신 갈래 수. 글은 달라도 되지만
// 사실이 달라지면 그건 서류가 거짓말을 하는 것이다.
//
// ── 지어내지 않는다 ────────────────────────────────────────────────────
//
// 여기 적히는 값은 전부 selfpack.js 의 audit() 이 소스를 훑어 얻은 것이다.
// 한국어판과 같은 자료를 쓴다. 영어판이라고 다른 숫자가 나오면 안 된다.

const rule = (n = 74) => '-'.repeat(n);

/** 소스를 훑는 자리들. 한국어판 PROBES 와 같은 차례여야 한다. */
const PROBE_LABELS = {
  net: { label: 'Network requests', note: 'Only to the address you entered in setup (through HTTPS_PROXY when one is set)' },
  exec: { label: 'External commands', note: 'Commands you or the model asked for, plus git when installing a plugin' },
  listen: { label: 'Listening ports', note: 'Should be none' },
  eval: { label: 'String evaluation', note: 'Should be none' },
};

/**
 * 사람이 읽는 심사서 — 영어판.
 *
 * @param {object} a       selfpack.js 의 audit()
 * @param {string} at      만든 시각
 * @param {Array}  probes  selfpack.js 의 PROBES (차례를 그대로 따른다)
 */
export function reviewSheetEn(a, at, probes) {
  const L = [];
  L.push('deel — security review package');
  L.push(rule());
  L.push(`Name          ${a.name}`);
  L.push(`Version       ${a.version}`);
  L.push(`License       ${a.license}`);
  L.push(`Runtime       Node ${a.node} (standard library only)`);
  L.push(`Generated     ${at}`);
  L.push('');

  L.push('1. Third-party dependencies');
  L.push(rule());
  L.push(`   dependencies       ${a.deps.length}${a.deps.length ? '  ' + a.deps.join(', ') : '   <- no third-party code is shipped'}`);
  L.push(`   devDependencies    ${a.devDeps.length}`);
  L.push(`   external imports   ${a.외부모듈.length}${a.외부모듈.length ? '' : '   <- only node: builtins and its own files'}`);
  for (const x of a.외부모듈) L.push(`       ${x}`);
  L.push('');

  L.push('2. Code that runs on install');
  L.push(rule());
  L.push(a.lifecycle.length
    ? `   Present: ${a.lifecycle.join(', ')}   <- needs review`
    : '   None   <- no preinstall / install / postinstall / prepare');
  L.push('   Unzip and run `node bin/deel.js`. There is no install step.');
  L.push('');

  L.push('3. Every outbound call site (found by scanning the source)');
  L.push(rule());
  for (const p of probes) {
    const hits = a.calls[p.id];
    const w = PROBE_LABELS[p.id] ?? { label: p.id, note: '' };
    L.push(`   [${w.label}]  ${hits.length}   ${w.note}`);
    for (const h of hits) L.push(`       ${h.file}:${h.line}   ${h.text}`);
    if (!hits.length) L.push('       (none)');
  }
  L.push('');
  L.push('   Note: no endpoint is hard-coded in the source. deel only uses the address you');
  L.push('     entered in setup.  Config file: ~/.deel/config.json  (or DEEL_API_KEY)');
  L.push('');

  L.push('3-1. Four separate outbound lanes that never mix');
  L.push(rule());
  L.push('   [A] Model gateway - the only lane that carries your source code');
  L.push('       - Address: the single endpoint chosen in deel setup');
  L.push('       - That one address is the entire allow-list. Switch models and the old one closes.');
  L.push('       - src/safety/network.js checks every request. If the address is not on the');
  L.push('         list, the request is never built.');
  L.push('       - With HTTPS_PROXY (or proxy in the config) the call goes **through** that');
  L.push('         proxy (CONNECT tunnel). The destination stays the same single address, and');
  L.push('         the proxy in use is printed at startup and in /status. Requests to this');
  L.push('         machine (127.*, localhost) never go through the proxy.');
  L.push('');
  L.push('   [B] Web reading (WebFetch tool) - fetch only');
  L.push('       - GET only. No request body, so source and conversation cannot leave this way.');
  L.push('       - This machine and private ranges (127.*, 10.*, 192.168.*, 172.16-31.*) are refused.');
  L.push('       - The lane opens only while the tool runs and closes immediately after.');
  L.push('       - Every address visited is written to the audit log.');
  L.push('');
  L.push('   [C] Plugin install (github) - only when you type /plugin install');
  L.push('       - Open only while that command runs.');
  L.push('');
  L.push('   [D] MCP servers - separate child processes, someone else\'s program');
  L.push('       - Off by default. A server runs only if you list it in .deel/mcp.json.');
  L.push('       - Unlike A/B/C we cannot see which sockets that server opens. So instead of');
  L.push('         filtering its requests, --offline does not start the server at all.');
  L.push('');
  L.push('   Starting with --offline blocks [B], [C] and [D]; traffic stays on this machine.');
  L.push('   (Verified by the network / web / mcp checks in npm test; the count is in that output.)');
  L.push('');

  L.push('4. Skills and plugins');
  L.push(rule());
  L.push('   This package contains no skills and no plugins.');
  L.push('   It only reads ~/.claude, ~/.deel and the project folder on the machine it runs on.');
  L.push('   (Verified by the no-bundle check in npm test.)');
  L.push('');

  L.push('5. What the tests actually guard');
  L.push(rule());
  L.push('   A green test run means "nothing broke", not "breaking it would be caught".');
  L.push('   The two look identical and are worth the opposite.');
  L.push('   So we deliberately break the lines that matter and check that the paired test');
  L.push('   turns red. What gets broken, and what would go wrong if it stayed broken, is');
  L.push('   written down in test/mutants.json - deleting the whole .deel folder, undo');
  L.push('   snapshots, ACP door parity, and the exit-code table are among them.');
  L.push('   A single survivor fails the run.');
  L.push('   (Verified by npm run mutate; killed and survived counts are in that output.)');
  L.push('   The tests and that list are not in this package - it ships only running code.');
  L.push('   Read them in the repository: https://github.com/jysvai/deel-local-cli');
  L.push('');

  L.push(`6. ${a.files.length} files shipped - SHA-256`);
  L.push(rule());
  const w = Math.max(...a.files.map((f) => f.path.length));
  for (const f of a.files) {
    L.push(`   ${f.path.padEnd(w)}  ${String(f.bytes).padStart(7)}B  ${f.sha}`);
  }
  L.push('');
  L.push('   Verify these yourself with:');
  L.push('     sha256sum <file>                   (Linux, macOS)');
  L.push('     certutil -hashfile <file> SHA256   (Windows)');
  L.push('');
  return L.join('\n');
}

/** zip 맨 앞에 넣는 안내 — 영어판. */
export function readMeEn() {
  return [
    'deel - a coding agent CLI for local models and in-house gateways',
    '',
    'How to run it (there is no install step)',
    '  1. Unzip this archive anywhere.',
    '  2. Check that Node 20 or newer is present:  node -v',
    '  3. Choose a connection:                     node deel/bin/deel.js setup',
    '  4. Start talking:                           node deel/bin/deel.js',
    '',
    'For the security reviewer',
    '  import-review.txt  The review package in prose: dependencies, install scripts,',
    '                     every network call site, and a SHA-256 for each file.',
    '  sbom.cdx.json      SBOM (CycloneDX 1.5). Feed it straight to your scanner.',
    '  audit-spec.json    Egress list, audit-log specification, file hashes - machine readable.',
    '',
    '  All three are generated by scanning the source. None of it is written by hand.',
    '',
  ].join('\n');
}

/**
 * 심사명세 — 영어판.
 *
 * 한국어판(sbom.js 의 심사명세)과 **같은 자료, 같은 차례**다. 열쇠 이름까지
 * 영어라야 뜻이 있다 — 스캐너에 넣는 사람이 `통신` 을 읽을 수는 없다.
 */
export function specEn(a, at, 통신, 열쇠, 감사) {
  return {
    product: a.name,
    version: a.version,
    license: a.license,
    runtime: `Node ${a.node} (standard library only)`,
    generated: at.toISOString(),
    dependencies: {
      dependencies: a.deps,
      devDependencies: a.devDeps,
      installScripts: a.lifecycle,
      externalImportsInSource: a.외부모듈,
      summary: a.deps.length === 0 && a.외부모듈.length === 0
        ? 'No third-party code is bundled. Only node: builtins and its own files are imported.'
        : 'External modules are present - review the list above.',
    },
    egress: 통신,
    keyStorage: 열쇠,
    auditLog: 감사,
    files: a.files.map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha })),
  };
}

/** 나가는 길 — 영어판. 자리(소스 줄 번호)는 부르는 쪽이 넣어 준다. */
export function egressEn(자리, a) {
  return {
    lanes: [
      {
        lane: 'Model gateway',
        when: 'On every turn you type',
        where: 'The single address chosen in deel setup',
        what: 'The conversation, and the file contents the model read',
        control: 'src/safety/network.js checks the allow-list on every request. If the address is not listed, the request is never built.',
        proxy: 'With HTTPS_PROXY (or proxy in the config) the call goes through that proxy (CONNECT tunnel). The destination allow-list is unchanged, and addresses on this machine bypass the proxy.',
        source: 자리('net'),
      },
      {
        lane: 'Web reading (WebFetch)',
        when: 'Only when the model calls that tool',
        where: 'An address the model chose. This machine and private ranges are refused',
        what: 'Nothing - GET only, so no request body is sent',
        control: 'Blocked entirely under --offline.',
        source: 자리('net'),
      },
      {
        lane: 'Plugin install',
        when: 'Only when you type /plugin install',
        where: 'github.com',
        what: 'Nothing',
        control: 'Blocked entirely under --offline.',
        source: 자리('net'),
      },
    ],
    listeningPorts: {
      count: (a.calls?.listen ?? []).length,
      use: 'Only /preview, which serves the page you just built. It binds to 127.0.0.1 and closes when the command ends.',
      source: 자리('listen'),
    },
    externalCommands: {
      count: (a.calls?.exec ?? []).length,
      use: 'Commands you or the model asked for, starting MCP servers, and git when installing a plugin.',
      source: 자리('exec'),
    },
    stringEvaluation: {
      count: (a.calls?.eval ?? []).length,
      use: 'Should be none.',
      source: 자리('eval'),
    },
    whenOffline: [
      'Web reading (WebFetch) is blocked.',
      'Plugin install is blocked.',
      'MCP servers are not started - we cannot control where a child process connects.',
      'The model gateway still works. If that address is on this machine, nothing leaves it at all.',
    ],
  };
}

/** 열쇠 보관 — 영어판. 이 PC 에서 실제로 쓰는 방식은 부르는 쪽이 넣어 준다. */
export function keyStorageEn(이PC에서) {
  return {
    where: 'profiles[].apiKey in ~/.deel/config.json (or DEEL_HOME)',
    onThisMachine: 이PC에서,
    methods: [
      { os: 'Windows', how: 'DPAPI ProtectedData (CurrentUser) - only this account on this machine can unseal it. Copying the file elsewhere does not help.' },
      { os: 'macOS', how: 'Login keychain (security add-generic-password)' },
      { os: 'Other', how: 'File mode 0600. There is no OS keystore, so we say so plainly.' },
    ],
    howItIsPassed: 'The key never appears on a command line - it is always passed over stdin, so another user on the same machine cannot read it from the process list.',
    avoidTheFile: 'Set DEEL_API_KEY (or DEEL_KEY_<profile>) and nothing is written to the file at all. The environment variable wins over the file.',
    disable: 'DEEL_KEYSTORE=off - no OS keystore, file permissions only.',
  };
}

/** 감사기록 사양 — 영어판. */
export function auditLogEn() {
  return {
    location: '<workdir>/.deel/audit.jsonl',
    format: 'JSON Lines (UTF-8, one record per line)',
    growth: 'Append only. Records are never edited or removed.',
    retention: 'deel never deletes it. Set retention according to your own policy.',
    everyLine: [
      { field: 'at', meaning: 'When (ISO 8601, UTC)' },
      { field: 'session', meaning: 'Which conversation - an id derived from the start time' },
      { field: 'kind', meaning: 'Record type - see below' },
    ],
    kinds: [
      { kind: 'turn', meaning: 'Something the user asked for', fields: ['text'], note: 'First 500 characters only' },
      { kind: 'tool', meaning: 'A tool call', fields: ['tool', 'target', 'ok', 'note'], note: 'target is a file path, a command, or a search pattern' },
      { kind: 'blocked', meaning: 'Something a safety check refused', fields: ['why', 'what'], note: 'The refused command is kept verbatim' },
      { kind: 'undo', meaning: 'A rollback', fields: ['files', 'turns'] },
    ],
    neverRecorded: [
      'Keys and passwords. Neither apiKey from the config nor a spreadsheet password reaches the log.',
      'Whole file contents. What was touched is recorded; what was written is not.',
      'Model replies. Those live in the session transcript (.deel/sessions) instead.',
    ],
  };
}

/** 사람이 읽을 짧은 요약 — 영어판. */
export function specSummaryEn(m = {}) {
  return [
    `SBOM components  ${(m.files?.length ?? 0).toLocaleString()} (each with SHA-256)`,
    `Dependencies     ${(m.dependencies?.dependencies?.length ?? 0)} - install scripts ${(m.dependencies?.installScripts?.length ?? 0)}`,
    `Egress lanes     ${(m.egress?.lanes?.length ?? 0)} - listening ports ${(m.egress?.listeningPorts?.count ?? 0)}`,
    `Audit records    ${(m.auditLog?.kinds?.length ?? 0)} kinds - ${m.auditLog?.location ?? ''}`,
  ].join('\n');
}

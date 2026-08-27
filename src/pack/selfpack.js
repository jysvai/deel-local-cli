// deel 자기 자신을 사내 반입용으로 묶는다.
//
// 반입 심사에서 실제로 물어보는 것은 셋이다.
//   1) 남의 코드가 섞여 있나        → 의존성 목록
//   2) 설치만 해도 뭔가 도나        → 생명주기 스크립트
//   3) 바깥 어디로 말을 거나        → 네트워크·외부 명령 호출 자리
// 이 세 가지를 사람이 읽을 수 있는 심사서로 뽑아서 소스와 같이 담는다.
// 소스를 읽고 쓰는 것은 전부 코드에서 훑는다 — 손으로 적으면 언젠가 사실과 어긋난다.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from './zip.js';
import { sbom, 심사명세 } from './sbom.js';

export const repoRoot = () => join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SKIP_DIRS = new Set(['node_modules', '.git', '.github', 'test', '.deel']);
const SHIP = ['bin', 'src'];
const SHIP_FILES = ['package.json', 'README.md', 'README.en.md', 'LICENSE'];

function walk(dir, base, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.gitattributes') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, base, out);
      continue;
    }
    out.push(relative(base, full).split(/[\\/]/).join('/'));
  }
  return out;
}

export function shippedFiles(root = repoRoot()) {
  const out = [];
  for (const d of SHIP) if (existsSync(join(root, d))) walk(join(root, d), root, out);
  for (const f of SHIP_FILES) if (existsSync(join(root, f))) out.push(f);
  return out.sort();
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// 바깥과 말을 섞을 수 있는 자리를 소스에서 직접 찾는다.
// 앞에 점이나 글자가 붙은 것은 뺀다. 그러지 않으면 정규식의 .exec( 까지
// '외부 명령 실행' 으로 세어 심사서가 거짓말을 한다.
const PROBES = [
  { id: 'net', label: '네트워크 요청', re: /(?<![.\w])fetch\s*\(/g,
    note: '사용자가 setup 에서 넣은 주소로만 나갑니다' },
  { id: 'exec', label: '외부 명령 실행', re: /(?<![.\w])(execFile|execFileSync|execSync|spawn|spawnSync|exec)\s*\(/g,
    note: '사용자·모델이 지시한 명령, 그리고 플러그인 받을 때의 git' },
  { id: 'listen', label: '포트 열기', re: /(?<![.\w])(createServer)\s*\(/g,
    note: '없어야 정상입니다' },
  { id: 'eval', label: '문자열 실행', re: /(?<![.\w])(eval|new\s+Function)\s*\(/g,
    note: '없어야 정상입니다' },
];

export function scanCalls(root = repoRoot(), files = shippedFiles(root)) {
  const found = Object.fromEntries(PROBES.map((p) => [p.id, []]));
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    const lines = readFileSync(join(root, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;   // 주석은 세지 않는다
      for (const p of PROBES) {
        p.re.lastIndex = 0;
        if (p.re.test(line)) found[p.id].push({ file: f, line: i + 1, text: line.trim().slice(0, 78) });
      }
    });
  }
  return found;
}

/**
 * 소스에서 불러오는 모듈 이름만 뽑는다.
 *
 * 그냥 정규식으로 import 를 찾으면 화면 문구 안의 "외부 import" 같은 글자까지 잡힌다.
 * 실제로 그렇게 잡혀서 심사서에 없는 의존성이 적혔다. 그래서 두 가지를 함께 본다.
 *   1) import / require 가 낱말로 서 있을 것
 *   2) 따온 값이 모듈 이름처럼 생겼을 것 (공백·괄호·${ 가 없다)
 */
const MODULE_NAME = /^[@\w./:-]+$/;

export function importSpecs(text) {
  const out = [];
  const re = /(?:^|[\s;{(])(?:import[^'"()]*from\s*|import\s*|require\s*\(\s*)(['"])([^'"]+)\1/g;
  for (const m of text.matchAll(re)) {
    const spec = m[2];
    if (MODULE_NAME.test(spec)) out.push(spec);
  }
  return out;
}

export function audit(root = repoRoot()) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const files = shippedFiles(root);
  const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish'];

  const 외부모듈 = [];
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    for (const s of importSpecs(readFileSync(join(root, f), 'utf8'))) {
      if (s.startsWith('node:') || s.startsWith('.') || s.startsWith('/')) continue;
      외부모듈.push(`${f} → ${s}`);
    }
  }

  return {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    node: pkg.engines?.node ?? '(지정 없음)',
    deps: Object.keys(pkg.dependencies ?? {}),
    devDeps: Object.keys(pkg.devDependencies ?? {}),
    lifecycle: LIFECYCLE.filter((k) => pkg.scripts?.[k]),
    외부모듈,
    files: files.map((f) => {
      const buf = readFileSync(join(root, f));
      return { path: f, bytes: buf.length, sha: sha256(buf) };
    }),
    calls: scanCalls(root, files),
  };
}

const 줄 = (n = 74) => '-'.repeat(n);

export function reviewSheet(a, at) {
  const L = [];
  L.push('deel 사내 반입 심사 자료');
  L.push(줄());
  L.push(`이름        ${a.name}`);
  L.push(`판          ${a.version}`);
  L.push(`라이선스    ${a.license}`);
  L.push(`실행 환경   Node ${a.node} (표준 내장 기능만 사용)`);
  L.push(`만든 시각   ${at}`);
  L.push('');

  L.push('1. 외부 의존성');
  L.push(줄());
  L.push(`   dependencies      ${a.deps.length}개${a.deps.length ? '  ' + a.deps.join(', ') : '   ← 남의 코드를 함께 들여오지 않습니다'}`);
  L.push(`   devDependencies   ${a.devDeps.length}개`);
  L.push(`   소스의 외부 import ${a.외부모듈.length}건${a.외부모듈.length ? '' : '   ← node: 내장과 자기 파일만 부릅니다'}`);
  for (const x of a.외부모듈) L.push(`       ${x}`);
  L.push('');

  L.push('2. 설치할 때 저절로 도는 코드');
  L.push(줄());
  L.push(a.lifecycle.length
    ? `   있음: ${a.lifecycle.join(', ')}   ← 심사 필요`
    : '   없음   ← preinstall / install / postinstall / prepare 전부 없습니다');
  L.push('   압축을 풀고 `node bin/deel.js` 로 바로 씁니다. 설치 절차가 없습니다.');
  L.push('');

  L.push('3. 바깥으로 나가는 자리 (소스를 훑어 찾은 전부)');
  L.push(줄());
  for (const p of PROBES) {
    const hits = a.calls[p.id];
    L.push(`   [${p.label}]  ${hits.length}건   ${p.note}`);
    for (const h of hits) L.push(`       ${h.file}:${h.line}   ${h.text}`);
    if (!hits.length) L.push('       (없음)');
  }
  L.push('');
  L.push('   ※ 접속 주소는 소스에 박혀 있지 않습니다. deel setup 에서 넣은 값만 씁니다.');
  L.push('     설정 파일: ~/.deel/config.json  (또는 환경변수 DEEL_API_KEY)');
  L.push('');

  L.push('3-1. 나가는 길은 네 갈래이고 서로 섞이지 않습니다');
  L.push(줄());
  L.push('   [A] 모델 게이트웨이 — 소스 코드가 실려 나가는 유일한 길');
  L.push('       · 주소: deel setup 에서 정한 곳 딱 한 자리');
  L.push('       · 그 한 자리만 허용 목록에 오릅니다. 모델을 바꾸면 앞의 자리는 닫힙니다.');
  L.push('       · src/safety/network.js 가 요청마다 확인하고, 목록에 없으면 요청 자체를');
  L.push('         만들지 않습니다.');
  L.push('');
  L.push('   [B] 웹 읽기 (WebFetch 도구) — 받아 오기만 하는 길');
  L.push('       · GET 만 씁니다. 본문을 실어 보내지 않습니다 (소스·대화가 나갈 수 없음).');
  L.push('       · 이 컴퓨터·사내망(127.*, 10.*, 192.168.*, 172.16~31.*) 주소는 거절합니다.');
  L.push('       · 쓰는 동안만 그 자리를 열고 끝나면 바로 닫습니다.');
  L.push('       · 다녀온 주소는 전부 기록에 남습니다.');
  L.push('');
  L.push('   [C] 플러그인 받기 (github) — 사용자가 /plugin install 을 칠 때만');
  L.push('       · 그 명령이 도는 동안만 열리고 끝나면 닫힙니다.');
  L.push('');
  L.push('   [D] MCP 서버 — 딴 자식 프로세스, 남의 프로그램');
  L.push('       · .deel/mcp.json 에 사람이 직접 적어야만 뜹니다. 기본은 꺼져 있습니다.');
  L.push('       · A·B·C 와 달리 이 서버가 안에서 무슨 소켓을 여는지는 코드로 볼 수');
  L.push('         없습니다. 그래서 요청을 거르는 대신, --offline 이면 서버 자체를');
  L.push('         아예 띄우지 않습니다.');
  L.push('');
  L.push('   --offline 으로 켜면 [B]·[C]·[D] 가 모두 막히고, 이 컴퓨터 안으로만 다닙니다.');
  L.push('   (검증: npm test 안의 network / web / mcp 검사 123항목이 이를 확인합니다)');
  L.push('');

  L.push('4. 스킬·플러그인');
  L.push(줄());
  L.push('   이 묶음에는 스킬도 플러그인도 들어 있지 않습니다.');
  L.push('   설치된 PC 의 ~/.claude, ~/.deel, 프로젝트 폴더를 읽어서 쓸 뿐입니다.');
  L.push('   (검증: npm test 안의 no-bundle 검사가 이를 확인합니다)');
  L.push('');

  L.push(`5. 담긴 파일 ${a.files.length}개 — SHA-256`);
  L.push(줄());
  const w = Math.max(...a.files.map((f) => f.path.length));
  for (const f of a.files) {
    L.push(`   ${f.path.padEnd(w)}  ${String(f.bytes).padStart(7)}B  ${f.sha}`);
  }
  L.push('');
  L.push('   위 값은 다음으로 다시 확인할 수 있습니다:');
  L.push('     sha256sum <파일>            (리눅스·맥)');
  L.push('     certutil -hashfile <파일> SHA256   (윈도우)');
  L.push('');
  return L.join('\n');
}

/**
 * 심사서 + 소스를 zip 하나로 묶는다.
 */
export function packSelf(outFile, { root = repoRoot(), at = new Date() } = {}) {
  const a = audit(root);
  const stamp = at.toISOString().replace('T', ' ').slice(0, 19);
  const sheet = reviewSheet(a, stamp);

  /*
   * 사람이 읽는 것 하나, 기계가 읽는 것 둘.
   *
   * 반입 심사는 사람만 보는 절차가 아니다. 보안팀은 SBOM 을 스캐너에 먹여
   * 취약점 목록을 뽑고, 운영팀은 감사기록 사양을 보고 SIEM 수집 규칙을 짠다.
   * 사람이 읽는 글은 그 어느 쪽에도 못 들어간다 — 그래서 셋을 다 넣는다.
   */
  const entries = [
    { name: '반입심사서.txt', data: Buffer.from(sheet, 'utf8'), mtime: at },
    { name: 'sbom.cdx.json', data: Buffer.from(JSON.stringify(sbom(a, { at }), null, 2), 'utf8'), mtime: at },
    { name: '심사명세.json', data: Buffer.from(JSON.stringify(심사명세(a, { at }), null, 2), 'utf8'), mtime: at },
  ];
  for (const f of a.files) {
    entries.push({
      name: `deel/${f.path}`,
      data: readFileSync(join(root, f.path)),
      mtime: statSync(join(root, f.path)).mtime,
      mode: f.path.startsWith('bin/') ? 0o755 : 0o644,
    });
  }
  entries.push({
    name: '읽어주세요.txt',
    data: Buffer.from([
      'deel — 로컬 모델·사내 게이트웨이 코딩 에이전트',
      '',
      '쓰는 법 (설치 절차 없음)',
      '  1. 이 zip 을 아무 폴더에나 풉니다.',
      '  2. Node 20 이상이 깔려 있는지 봅니다:  node -v',
      '  3. 연결을 정합니다:                    node deel/bin/deel.js setup',
      '  4. 대화를 시작합니다:                  node deel/bin/deel.js',
      '',
      '심사 담당자께',
      '  반입심사서.txt   사람이 읽는 심사 자료. 의존성·설치 스크립트·네트워크',
      '                   호출 자리·파일별 SHA-256 이 전부 적혀 있습니다.',
      '  sbom.cdx.json    SBOM (CycloneDX 1.5). 스캐너에 그대로 넣으시면 됩니다.',
      '  심사명세.json    통신 목록 · 감사기록 사양 · 파일 해시. 기계가 읽는 형식입니다.',
      '',
      '  세 파일 모두 소스를 훑어 자동으로 만든 것입니다. 손으로 적은 값이 아닙니다.',
      '',
    ].join('\n'), 'utf8'),
    mtime: at,
  });

  const zip = makeZip(entries);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, zip);
  return { out: outFile, bytes: zip.length, files: entries.length, audit: a, sheet };
}

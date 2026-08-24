// 배포 묶음에 남의 것이 한 톨도 섞이지 않았음을 증명한다.
//
// 이 파일이 있는 이유:
//  npm install 로그에 다른 패키지 이름이 뜨면 "얘가 딸려왔나?" 하고 놀라게 된다.
//  실제로 한 번 그랬다. 그래서 사람 기억 대신 테스트가 지키게 한다.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { discover } from '../src/skills/discover.js';
import { importSpecs } from '../src/pack/selfpack.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));

// 1) 남의 코드에 기대지 않는다 — 반입 심사에 내는 증거가 이것이다.
const deps = Object.keys(pkg.dependencies ?? {});
const devs = Object.keys(pkg.devDependencies ?? {});
check('dependencies 0개', deps.length === 0, deps.join(', '));
check('devDependencies 0개', devs.length === 0, devs.join(', '));
check('optional/peer 없음',
  !pkg.optionalDependencies && !pkg.peerDependencies && !pkg.bundleDependencies);

// 2) 설치만 해도 저절로 돌아가는 코드가 없다.
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'preuninstall'];
const live = LIFECYCLE.filter((k) => pkg.scripts?.[k]);
check('설치 때 자동 실행 스크립트 없음', live.length === 0, live.join(', '));

// 3) npm 이 실제로 담는 파일 목록을 받아 본다. 짐작이 아니라 npm 이 부는 답이다.
let shipped = [];
try {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'],
    { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' });
  shipped = JSON.parse(out)[0].files.map((f) => f.path.replaceAll('\\', '/'));
} catch (err) {
  check('npm pack 목록 확보', false, String(err.message).slice(0, 80));
}

if (shipped.length) {
  // 스킬·플러그인은 '설치된 PC' 에서 찾아 쓰는 것이지 담아 가는 것이 아니다.
  const 이물질 = shipped.filter((p) =>
    /SKILL\.md$/i.test(p) ||
    /\.claude-plugin\//.test(p) ||
    // src/skills · src/plugins 는 '찾아 읽는 코드' 라서 통과. 담긴 '내용물'만 잡는다.
    /(^|\/)(skills|commands|agents|plugins|marketplaces)\/.*\.(md|ya?ml|json)$/i.test(p) ||
    /(^|\/)node_modules\//.test(p) ||
    /\.(zip|tgz|tar\.gz)$/i.test(p));
  check('담긴 스킬·플러그인 0개', 이물질.length === 0, 이물질.slice(0, 5).join(', '));

  const 비밀 = shipped.filter((p) => /(^|\/)\.(env|npmrc|credentials)/i.test(p) || /\.deel\//.test(p));
  check('설정·자격 파일 0개', 비밀.length === 0, 비밀.join(', '));

  check('bin·src·문서만 담김',
    shipped.every((p) => /^(bin|src)\//.test(p) || ['package.json', 'LICENSE', 'README.md', 'README.en.md'].includes(p)),
    shipped.filter((p) => !/^(bin|src)\//.test(p) && !['package.json', 'LICENSE', 'README.md', 'README.en.md'].includes(p)).join(', '));
}

// 4) 소스가 바깥 패키지를 부르지 않는다 (node: 내장과 상대경로만).
const srcFiles = shipped.length ? shipped.filter((p) => /\.js$/.test(p))
  : ['bin/deel.js'];
const 바깥 = [];
for (const f of srcFiles) {
  for (const spec of importSpecs(readFileSync(join(repo, f), 'utf8'))) {
    if (spec.startsWith('node:') || spec.startsWith('.') || spec.startsWith('/')) continue;
    바깥.push(`${f} → ${spec}`);
  }
}
check('바깥 패키지 import 0개', 바깥.length === 0, 바깥.slice(0, 5).join(' · '));

// 5) 아무것도 안 깔린 PC 에서는 스킬이 0개여야 한다.
//    0개가 아니면 어딘가에 스킬을 품고 다닌다는 뜻이다.
const 빈PC = join(tmpdir(), 'deel-nobundle-home');
rmSync(빈PC, { recursive: true, force: true });
mkdirSync(join(빈PC, 'proj'), { recursive: true });
const r = discover(join(빈PC, 'proj'), { home: 빈PC });
check('빈 PC 에서 스킬 0개', r.skills.length === 0, `${r.skills.length}개 나옴`);
check('빈 PC 에서 플러그인 0개', r.plugins.length === 0, `${r.plugins.length}개 나옴`);
check('빈 PC 에서 명령 0개', r.commands.length === 0, `${r.commands.length}개 나옴`);
rmSync(빈PC, { recursive: true, force: true });

// --- 결과 ---------------------------------------------------------------
const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n반입 묶음 검사 — 남의 것이 섞이지 않았는가\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패`);
if (shipped.length) console.log(`  ${D}담긴 파일 ${shipped.length}개 — 전부 bin/ · src/ · 문서${X}`);
console.log('');
process.exit(fail.length ? 1 : 0);

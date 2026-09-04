// 도구 부름을 **무엇으로 알아보나** — 다섯 자리가 같은 답을 하는가.
//
// ── 무엇이 문제였나 ─────────────────────────────────────────────────────
//
// 화면(repl) · 기록(oneshot) · 편집기 붙임(acp) · 보고서(export) · 감사기록
// (audit). 다섯 자리가 전부 「이 부름을 대표하는 인자 하나」 를 골라 괄호에
// 넣는데, 그 **고르는 차례가 다섯 벌 따로** 적혀 있었다. 그래서 조금씩
// 어긋나 있었다:
//
//   보고서    `url` 이 없다        → 웹을 읽은 줄이 `WebFetch()` 로 남는다
//   감사기록  `url`·`name` 이 없다 → 무엇을 향한 부름인지가 안 남는다
//
// 셋이 다른 말을 하면 무엇이 맞는지 알 길이 없다. 그래서 목록을
// `src/tools/label.js` 한 곳으로 모았고, 이 검사가 **다시 흩어지는 것을** 막는다.
//
// ── 무엇을 지키나 ───────────────────────────────────────────────────────
//
//   1. 첫이름() 이 차례대로 고른다. 빈 값은 건너뛴다.
//   2. 다섯 자리 어디에도 그 목록이 다시 적혀 있지 않다. ★ 이게 핵심이다.
//   3. 목록에 있는 이름은 전부 실제로 화면 이름표가 된다.
//   4. 감사기록도 url·name 을 남긴다 — 예전에 빠져 있던 자리다.
//   5. 감사기록이 가릴 열쇠를 하나만 알고 있지 않다.
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 첫이름, 이름칸들 } from '../src/tools/label.js';
import { 도구이름표 } from '../src/acp/map.js';
import { Audit, 열쇠묻기 } from '../src/safety/audit.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 읽기 = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

trace('1-차례');

// ── 1. 차례대로 고른다 ──────────────────────────────────────────────────
{
  check('file_path 가 제일 앞', 첫이름({ file_path: 'a.js', pattern: 'x', name: 'n' }) === 'a.js');
  check('앞엣것이 없으면 뒤로 넘어간다', 첫이름({ url: 'https://x', 목적: '뒤' }) === 'https://x');
  check('목적(옛 이름)도 본다', 첫이름({ 목적: '무엇을 시켰나' }) === '무엇을 시켰나');
  check('purpose 가 목적보다 앞', 첫이름({ 목적: '옛', purpose: '새' }) === '새');

  // 빈 값을 「있다」 로 세면 그 자리에서 멈춰 뒤엣것을 못 본다 — 빈 괄호가 뜬다.
  check('★ 빈 글은 건너뛴다', 첫이름({ file_path: '', name: '진짜' }) === '진짜');
  check('★ null·undefined 도 건너뛴다',
    첫이름({ file_path: null, pattern: undefined, path: '/tmp' }) === '/tmp');

  // 숫자로 오는 인자도 있다. `0` 이 조용히 떨어지면 안 된다.
  check('숫자는 글로 바꿔 쓴다', 첫이름({ name: 0 }) === '0');

  check('아무것도 없으면 null', 첫이름({}) === null);
  check('인자가 없어도 안 터진다', 첫이름(undefined) === null && 첫이름(null) === null);
}

trace('2-한곳에만');

// ── 2. ★ 목록이 다시 흩어지지 않았나 ────────────────────────────────────
//
// 이 검사가 이 파일이 있는 이유다. 위의 1번은 label.js 만 보면 되는데, 진짜
// 문제는 「누군가 제 자리에 목록을 또 적는 것」 이었다.
{
  const 자리들 = [
    ['src/repl.js', '../src/repl.js'],
    ['src/oneshot.js', '../src/oneshot.js'],
    ['src/acp/map.js', '../src/acp/map.js'],
    ['src/ui/export.js', '../src/ui/export.js'],
    ['src/safety/audit.js', '../src/safety/audit.js'],
  ];
  // 「인자에서 이름 후보를 둘 이상 이어 고르는」 꼴을 찾는다.
  // 주석 줄은 뺀다 — 왜 모았는지 적어 둔 설명까지 잡으면 설명을 못 적게 된다.
  const 흩어진꼴 = new RegExp(
    '(?:file_path|pattern|purpose|목적)[^\\n]{0,40}\\?\\?[^\\n]{0,40}'
    + '(?:file_path|pattern|path|url|name|purpose|목적)',
  );
  const 걸린것 = [];
  for (const [보일이름, 길] of 자리들) {
    const 글 = 읽기(길);
    const 몸통 = 글.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    if (흩어진꼴.test(몸통)) 걸린것.push(보일이름);
    check(`${보일이름} 이 label.js 를 쓴다`, /from '[^']*tools\/label\.js'/.test(글), '');
  }
  check('★★ 이름 목록을 다시 적은 자리가 없다', 걸린것.length === 0, 걸린것.join(' '));
}

trace('3-전부-이름표가-된다');

// ── 3. 목록에 있는 이름은 전부 이름표가 된다 ────────────────────────────
//
// 목록에만 넣고 실제로는 안 쓰이는 이름이 있으면, 그 이름을 쓰는 도구가
// 생겼을 때 조용히 빈 괄호가 된다.
{
  const 빈것 = [];
  for (const 칸 of 이름칸들) {
    const 표 = 도구이름표('Read', { [칸]: '값하나' });
    if (표 !== 'Read(값하나)') 빈것.push(`${칸}→${표}`);
  }
  check('★ 목록의 모든 이름이 이름표가 된다', 빈것.length === 0, 빈것.join(' '));

  // url 은 예전에 보고서·감사기록에서 빠져 있던 이름이다.
  check('웹 주소가 이름표에 들어간다',
    도구이름표('WebFetch', { url: 'https://example.com/a' }) === 'WebFetch(https://example.com/a)');
}

trace('4-감사기록');

// ── 4. 감사기록도 같은 답을 한다 ────────────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), 'deel-label-'));
  const a = new Audit(root, { 열쇠들: [] });
  a.tool('WebFetch', { url: 'https://example.com/x' }, { summary: '읽음' });
  a.tool('Skill', { name: '검수' }, { summary: '됨' });
  const 줄들 = readFileSync(join(root, '.deel', 'audit.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));

  check('★ 감사기록에 웹 주소가 남는다', 줄들[0]?.target === 'https://example.com/x',
    String(줄들[0]?.target));
  check('★ 감사기록에 부른 이름이 남는다', 줄들[1]?.target === '검수', String(줄들[1]?.target));
}

trace('5-열쇠');

// ── 5. 가릴 열쇠를 하나만 알고 있지 않은가 ──────────────────────────────
//
// 감사기록은 사람이 읽고 남에게도 보여 주는 글이다. 가려 준다고 해 놓고
// 새면 안 가린 것보다 나쁘다 — 가려졌다고 믿기 때문이다.
{
  const 옛열쇠 = process.env.DEEL_API_KEY;
  process.env.DEEL_API_KEY = 'sk-main-000';
  process.env.DEEL_KEY_WORK = 'sk-work-111';
  const 아는것 = 열쇠묻기({ key: 'sk-conn-222' })();
  delete process.env.DEEL_KEY_WORK;
  if (옛열쇠 == null) delete process.env.DEEL_API_KEY;
  else process.env.DEEL_API_KEY = 옛열쇠;

  check('설정에 든 열쇠를 안다', 아는것.includes('sk-conn-222'));
  check('DEEL_API_KEY 를 안다', 아는것.includes('sk-main-000'));
  check('★★ 이름 붙인 열쇠(DEEL_KEY_*)도 안다', 아는것.includes('sk-work-111'), 아는것.join(' '));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n도구 이름표 한 벌  ${D}(다섯 자리가 같은 답을 하는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

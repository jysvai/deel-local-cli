// 「다 됐습니다」 와 「이게 증거입니다」 는 다른 말이다.
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// 2026년 소나 조사로는 개발자의 **96%가 AI 가 쓴 코드를 온전히 믿지 않는데,
// 실제로 매번 확인하는 사람은 48%** 다. 38%는 "사람 코드보다 리뷰가 더 힘들다"고
// 답한다. 에이전트는 단위 검사 하나 돌리고 "끝났습니다" 라고 말해 버린다.
//
// 그 간극은 에이전트가 **말을 하기 때문에** 생긴다. 말은 검토할 수 없다.
// 검토할 수 있는 것은 증거다 — 무엇을 바꿨고, 무엇을 돌렸고, 무엇이 그것을
// 증명하는가.
//
// 여기서 재는 것 중 제일 중요한 것은 **증명 안 된 것을 증명 안 됐다고 하는가**
// 이다. 바꾼 것을 늘어놓는 것은 /diff 도 한다. 안 한 것을 말하는 도구는 없다.
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 증거모으기, 증거글, 증거적기 } from '../src/agent/evidence.js';
import { Session } from '../src/agent/session.js';
import { Audit } from '../src/safety/audit.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-evid-'));
const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', model: '검사용', ctx: 32768 };

// 절마다 폴더를 따로 준다.
//
// 감사기록은 폴더에 파일 하나로 쌓인다. 같은 폴더를 나눠 쓰면 앞 절에서 돌린
// 명령이 뒤 절의 증거로 붙어서, 검사가 서로를 오염시킨다. 실제로 그렇게 한 번
// 틀렸다 — '실패한 명령은 증명이 아니다' 가 앞 절의 성공한 npm test 때문에
// 통과해 버렸다.
let 절번호 = 0;
const 새것 = () => {
  const 방 = join(root, `절${++절번호}`);
  mkdirSync(방, { recursive: true });
  const s = new Session(conn, { root: 방 });
  const a = new Audit(방);
  return { s, a, 방 };
};

trace('1-아무것도안했으면');

// ── 아무것도 안 했으면 없다고 말한다 ────────────────────────────────────
{
  const { s, a } = 새것();
  const e = 증거모으기(s, { audit: a });
  check('바꾼 것이 없으면 빈 목록', e.바꾼것.length === 0);
  check('돌린 것이 없으면 빈 목록', e.돌린것.length === 0);
  check('증명 못 한 것도 없다', e.증명안된것.length === 0);
  check('글로 뽑아도 안 죽는다', typeof 증거글(e) === 'string' && 증거글(e).length > 0);
}

trace('2-고치고안돌렸으면');

// ── 고쳐 놓고 아무것도 안 돌렸으면 ──────────────────────────────────────
//
// 여기가 이 기능의 핵심이다. 파일을 고쳤는데 그 뒤에 아무것도 안 돌렸으면
// **아무것도 증명되지 않았다.** 그런데도 에이전트는 "고쳤습니다" 라고 말한다.
{
  const { s, a } = 새것();
  s.noteChange('src/runner.js', { added: 12, removed: 3 });
  s.noteChange('src/worker.js', { added: 4, removed: 0 });

  const e = 증거모으기(s, { audit: a });
  check('바꾼 파일이 잡힌다', e.바꾼것.length === 2, JSON.stringify(e.바꾼것.map((x) => x.파일)));
  check('줄 수도 같이 잡힌다', e.바꾼것[0]?.더한줄 === 12 && e.바꾼것[0]?.뺀줄 === 3,
    JSON.stringify(e.바꾼것[0]));
  check('둘 다 증명 안 됐다고 한다', e.증명안된것.length === 2,
    JSON.stringify(e.증명안된것.map((x) => x.파일)));
  check('왜 증명 안 됐는지도 적는다', e.증명안된것.every((x) => typeof x.왜 === 'string' && x.왜.length > 3),
    JSON.stringify(e.증명안된것[0]));

  const 글 = 증거글(e);
  check('글에도 증명 안 됨이 드러난다', /증명|확인 안|안 돌/.test(글), 글.slice(0, 120));
  check('바꾼 파일 이름이 글에 있다', 글.includes('src/runner.js'));
}

trace('3-돌렸으면');

// ── 고치고 실제로 돌렸으면 ──────────────────────────────────────────────
{
  const { s, a } = 새것();
  s.noteChange('src/runner.js', { added: 12, removed: 3 });
  a.tool('Bash', { command: 'npm test' }, { summary: '2,657개 통과' });

  const e = 증거모으기(s, { audit: a });
  check('돌린 명령이 잡힌다', e.돌린것.length === 1 && /npm test/.test(e.돌린것[0].무엇),
    JSON.stringify(e.돌린것));
  check('됐는지 안 됐는지 적힌다', e.돌린것[0].됐나 === true);
  check('검사를 돌렸으면 증명된 것으로 본다', e.증명안된것.length === 0,
    JSON.stringify(e.증명안된것));
  check('무엇이 증명했는지 남는다', e.바꾼것[0]?.증명 && /npm test/.test(e.바꾼것[0].증명),
    JSON.stringify(e.바꾼것[0]));
}

trace('4-돌렸는데실패했으면');

// ── 돌렸는데 실패했으면 증명이 아니다 ───────────────────────────────────
//
// 이걸 놓치면 제일 나쁘다. 검사를 돌렸다는 사실만 보고 초록으로 칠하면,
// **빨간 검사를 증거로 내미는** 셈이 된다.
{
  const { s, a } = 새것();
  s.noteChange('src/runner.js', { added: 12, removed: 3 });
  a.tool('Bash', { command: 'npm test' }, { error: '3개 실패' });

  const e = 증거모으기(s, { audit: a });
  check('실패한 명령은 증명이 아니다', e.증명안된것.length === 1, JSON.stringify(e.증명안된것));
  check('실패했다고 분명히 적는다', e.돌린것[0]?.됐나 === false && /실패/.test(e.돌린것[0]?.남긴말 ?? ''),
    JSON.stringify(e.돌린것[0]));
  check('글에서도 실패가 보인다', /실패|✗/.test(증거글(e)));
}

trace('4-1-나중에깨지면');

// ── 나중에 깨진 것이 앞의 성공을 덮는다 ─────────────────────────────────
//
// 화면에서 실제로 잡힌 결함이다. 빌드는 통과하고 그 **뒤에** 검사가 깨졌는데
// "증명 안 된 것 없음" 이 떴다. 성공한 것 중 마지막을 골랐기 때문이다.
//
// 사람이 보는 순서로 생각하면 답이 분명하다 — 마지막에 돌린 것이 빨간데
// 그 앞의 초록을 들고 와서 "확인됐습니다" 하면 그게 거짓 증거다.
{
  const { s, a } = 새것();
  s.noteChange('src/runner.js', { added: 12, removed: 3 });
  a.tool('Bash', { command: 'npm run build' }, { summary: 'ok' });   // 먼저 통과하고
  a.tool('Bash', { command: 'npm test' }, { error: '3개 실패' });     // 그 뒤에 깨졌다

  const e = 증거모으기(s, { audit: a });
  check('뒤에 깨졌으면 앞의 통과는 증거가 아니다', e.증명안된것.length === 1,
    JSON.stringify(e.바꾼것[0]));
  check('마지막 확인이 깨졌다고 말한다', /실패|깨/.test(e.증명안된것[0]?.왜 ?? ''),
    e.증명안된것[0]?.왜 ?? '');
}

trace('5-고친뒤에돌려야한다');

// ── 순서가 중요하다 ─────────────────────────────────────────────────────
//
// 고치기 **전에** 돌린 검사는 고친 것을 증명하지 못한다. 시각을 안 보면
// "아까 돌렸으니 됐다" 가 되어 버린다 — 그게 제일 흔한 자기기만이다.
{
  const { s, a } = 새것();
  a.tool('Bash', { command: 'npm test' }, { summary: '통과' });    // 먼저 돌리고
  const 돌린때 = new Date();
  s.noteChange('src/runner.js', { added: 12, removed: 3 });          // 그 뒤에 고쳤다

  const e = 증거모으기(s, { audit: a, 바꾼때: new Date(돌린때.getTime() + 60_000) });
  check('고치기 전에 돌린 것은 증명이 아니다', e.증명안된것.length === 1,
    JSON.stringify(e.증명안된것.map((x) => x.왜)));
  check('왜 아닌지 말한다', /전에|먼저|뒤에/.test(e.증명안된것[0]?.왜 ?? ''),
    e.증명안된것[0]?.왜 ?? '');
}

trace('6-파일로남기기');

// ── 파일로 남길 수 있는가 ───────────────────────────────────────────────
//
// 화면은 스크롤로 사라진다. 검토는 나중에, 다른 사람이 한다.
{
  const { s, a, 방 } = 새것();
  s.noteChange('src/runner.js', { added: 12, removed: 3 });
  a.tool('Bash', { command: 'npm test' }, { summary: '통과' });

  const 적은곳 = 증거적기(방, 증거모으기(s, { audit: a }), '검사용-1');
  check('파일로 남는다', 적은곳 && existsSync(적은곳), String(적은곳));
  check('.deel 안에 남는다', String(적은곳).includes('.deel'), String(적은곳));

  const 글 = readFileSync(적은곳, 'utf8');
  check('마크다운으로 적힌다', /^#/m.test(글), 글.slice(0, 40));
  check('바꾼 것과 돌린 것이 다 있다', 글.includes('src/runner.js') && 글.includes('npm test'));

  // 못 적는 자리에서도 대화는 계속돼야 한다.
  check('못 적어도 안 죽는다', 증거적기(join(root, '없는', '폴더', '깊이'), { 바꾼것: [], 돌린것: [], 증명안된것: [] }, 'x') !== undefined);
}

trace('7-자리를안먹는다');

// ── 증거는 프롬프트에 안 실린다 ─────────────────────────────────────────
//
// 이건 사람이 보는 것이지 모델에게 먹이는 것이 아니다. 실으면 컨텍스트만 먹고,
// 모델이 제가 만든 증거를 다시 읽는 이상한 고리가 생긴다.
{
  const { s, a } = 새것();
  s.noteChange('src/runner.js', { added: 100, removed: 50 });
  a.tool('Bash', { command: 'npm test' }, { summary: '통과' });
  const 전 = s.systemPrompt().length;
  증거모으기(s, { audit: a });
  check('증거를 모아도 프롬프트가 안 커진다', s.systemPrompt().length === 전,
    `${전} → ${s.systemPrompt().length}`);
}

trace('8-기록이샐때');

/*
 * ── ★ 기록을 못 적으면 「안 했다」가 아니라 「못 적었다」라고 해야 한다 ──
 *
 * 이 화면은 감사기록을 읽어서 만든다. 그런데 적는 쪽이 조용히 삼키고 있었다 —
 * 디스크가 차거나 폴더가 읽기 전용이면 한 줄도 안 적히는데 화면은 아무 말이
 * 없었다. 그러면 「이번 대화에서 아직 바꾸거나 돌린 것이 없습니다」가 뜬다.
 * **안 한 것을 말하라고 만든 화면이 안 한 것처럼 보이게 하는** 자리다.
 *
 * 못 쓰는 상황은 파일 자리에 폴더를 세워서 만든다 — 권한을 건드리지 않고
 * 어느 OS 에서나 똑같이 EISDIR/EPERM 이 난다.
 */
{
  const { s, a } = 새것();
  const 원래 = a.file;
  rmSync(원래, { force: true });
  mkdirSync(원래, { recursive: true });          // 파일 자리에 폴더 → 못 적는다

  check('기록이 멀쩡할 때는 아무 말도 안 한다', 증거모으기(s, { audit: a }).기록못씀 === null);

  a.tool('Bash', { command: 'npm test' }, { summary: '통과' });
  s.noteChange('src/runner.js', { added: 10, removed: 2 });
  a.tool('Bash', { command: 'npm run build' }, { summary: '통과' });

  const e = 증거모으기(s, { audit: a });
  check('★ 기록이 샜다고 말한다 (몇 건인지까지)', e.기록못씀 != null && e.기록못씀.수 === 2,
    JSON.stringify(e.기록못씀));
  check('★ 왜 못 적었는지도 남긴다', (e.기록못씀?.까닭 ?? '').length > 0, e.기록못씀?.까닭 ?? '(없음)');
  // 여기가 요점이다 — 기록이 없으니 돌린 것은 0건이다.
  // 그 0 을 「안 돌렸다」로 읽으면 안 된다는 표시가 위의 기록못씀이다.
  check('★ 그래서 돌린 것이 0건으로 보인다 (이게 거짓말이 되는 자리)',
    e.돌린것.length === 0 && e.바꾼것.length === 1, `돌린것 ${e.돌린것.length} · 바꾼것 ${e.바꾼것.length}`);

  rmSync(원래, { recursive: true, force: true });
}

rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n증거 검사  ${D}(「다 됐습니다」 말고 검토할 수 있는 것을 내놓는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

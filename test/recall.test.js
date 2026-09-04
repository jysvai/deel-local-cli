// 지난 대화 찾기.
//
// 무엇을 확인하나:
//   1) 한국어를 조사째 쳐도 찾는가       — 못 찾으면 "없다" 로 읽히고 기록이 무의미해진다
//   2) 못 찾은 것과 안 찾은 것을 구분하는가 — 이게 섞이면 모델이 "그런 적 없습니다" 라고 단정한다
//   3) 한 대화가 결과를 독차지하지 않는가  — 열 줄이 몰리면 다른 대화를 못 본다
//   4) 큰 기록에서 멈추지 않는가          — 몇 주 쓰면 수십 MB 가 된다
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 찾기, 낱말쪼개기, 토막내기 } from '../src/agent/recall.js';
import { TOOLS } from '../src/tools/index.js';
import { makeScope } from '../src/safety/guard.js';
import { Audit } from '../src/safety/audit.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-낱말쪼개기');

// ── 한국어를 조사째 쳐도 찾아야 한다 ────────────────────────────────────
//
// 형태소 분석기를 붙일 수 없다(의존성 0). 조사처럼 보이는 꼬리를 떼어
// 둘 다 찾는 것으로 갈음한다. 완벽하진 않아도 실제로 치는 말은 대부분 걸린다.
{
  const w = 낱말쪼개기('인코딩을 어떻게 했더라');
  check('조사를 뗀 낱말도 같이 찾는다', w.includes('인코딩') && w.includes('인코딩을'), w.join(' '));
  check('한 글자는 안 찾는다', !낱말쪼개기('그 일 을 다시').some((x) => x.length < 2),
    낱말쪼개기('그 일 을 다시').join(' '));
  check('영문은 소문자로 맞춘다', 낱말쪼개기('CP949 Encoding').every((x) => x === x.toLowerCase()),
    낱말쪼개기('CP949 Encoding').join(' '));
  check('빈 물음은 빈 목록', 낱말쪼개기('').length === 0);
  check('없는 값도 안 터진다', Array.isArray(낱말쪼개기(null)));
  check('구두점으로 쪼갠다', 낱말쪼개기('엑셀, 인코딩.').includes('엑셀'), 낱말쪼개기('엑셀, 인코딩.').join(' '));

  const 긴글 = '앞말 '.repeat(40) + '여기가맞은자리' + ' 뒷말'.repeat(40);
  const t = 토막내기(긴글, ['여기가맞은자리']);
  check('토막이 맞은 자리를 담는다', t.includes('여기가맞은자리'), t.slice(0, 60));
  check('토막이 너무 길지 않다', t.length <= 160, String(t.length));
  check('짧은 글은 그대로', 토막내기('짧다', ['짧']) === '짧다');
}

trace('2-찾기');

const root = mkdtempSync(join(tmpdir(), 'deel-recall-'));
const dir = join(root, '.deel', 'sessions');
mkdirSync(dir, { recursive: true });

function 대화(id, 메시지들, model = '스텁모델') {
  const 줄 = [JSON.stringify({ t: 'meta', at: new Date().toISOString(), model })];
  for (const m of 메시지들) 줄.push(JSON.stringify(m));
  writeFileSync(join(dir, `${id}.jsonl`), 줄.join('\n') + '\n', 'utf8');
}

대화('20260801-100000', [
  { role: 'user', content: '엑셀 파일이 한글로 깨져서 열려요' },
  { role: 'assistant', content: 'CP949 인코딩 문제입니다. 읽을 때 인코딩을 재서 그대로 되돌려 쓰면 됩니다.' },
  { role: 'tool', content: '파일 내용: 어쩌고저쩌고 CP949 어쩌고' },
]);
대화('20260810-090000', [
  { role: 'user', content: '로그 형식 통일해줘' },
  { role: 'assistant', content: 'logger 형식으로 바꿨습니다.' },
]);
대화('20260820-140000', [
  { role: 'user', content: '그 인코딩 이야기 다시 해줄래' },
  { role: 'assistant', content: '앞에서 CP949 로 정했습니다.' },
  { role: 'assistant', content: null, tool_calls: [{ function: { name: 'Read', arguments: '{"file_path":"보고서.csv"}' } }] },
]);

{
  const r = 찾기(root, '인코딩');
  check('내용으로 찾는다', r.맞은것.length >= 2, `${r.맞은것.length}건`);
  check('어느 대화인지 알려 준다', r.맞은것.every((h) => /^\d{8}-\d{6}$/.test(h.세션)),
    r.맞은것.map((h) => h.세션).join(', '));
  check('누가 한 말인지 알려 준다', r.맞은것.every((h) => ['나', '모델'].includes(h.누구)),
    r.맞은것.map((h) => h.누구).join(', '));
  check('뒤진 대화 수를 말한다', r.본파일 === 3, String(r.본파일));

  // 조사를 붙여 쳐도 같은 것이 나와야 한다. 여기가 한국어의 핵심이다.
  const r2 = 찾기(root, '인코딩을 어떻게');
  check('조사째 쳐도 찾는다', r2.맞은것.length >= 2, `${r2.맞은것.length}건`);

  // 도구 결과는 기본으로 안 뒤진다 — 파일 내용이 통째로 들어 있어 잡음이 크다.
  check('기본은 도구 결과를 안 뒤진다', 찾기(root, '어쩌고저쩌고').맞은것.length === 0);
  check('시키면 도구 결과도 뒤진다', 찾기(root, '어쩌고저쩌고', { 도구결과까지: true }).맞은것.length === 1);

  // 도구 호출은 content 가 비어 있고 tool_calls 에 들어 있다. 그것도 글로 봐야 한다.
  check('도구 호출도 찾는다', 찾기(root, '보고서.csv', { 도구결과까지: true }).맞은것.length >= 1,
    JSON.stringify(찾기(root, '보고서.csv', { 도구결과까지: true }).맞은것.map((h) => h.토막)));

  // 낱말이 다 맞는 쪽이 위로 와야 쓸모가 있다.
  const r3 = 찾기(root, 'CP949 인코딩');
  check('낱말이 다 맞는 것이 위로 온다', /CP949/.test(r3.맞은것[0]?.글 ?? ''), r3.맞은것[0]?.토막 ?? '');

  check('없는 말은 없다고 한다', 찾기(root, '존재하지않는낱말입니다').맞은것.length === 0);
  check('없어도 뒤진 개수는 말한다', 찾기(root, '존재하지않는낱말입니다').본파일 === 3);
  check('한 글자만 치면 안 찾는다', 찾기(root, '가').맞은것.length === 0);
}

trace('3-쏠림과예산');

// ── 한 대화가 결과를 독차지하면 안 된다 ─────────────────────────────────
{
  const 많은방 = mkdtempSync(join(tmpdir(), 'deel-recall2-'));
  const d2 = join(많은방, '.deel', 'sessions');
  mkdirSync(d2, { recursive: true });
  const 긴대화 = [{ t: 'meta', at: new Date().toISOString(), model: 'm' }];
  for (let i = 0; i < 40; i++) 긴대화.push({ role: 'user', content: `똑같은말 ${i}` });
  writeFileSync(join(d2, '20260101-000000.jsonl'), 긴대화.map((x) => JSON.stringify(x)).join('\n'), 'utf8');
  writeFileSync(join(d2, '20260102-000000.jsonl'), [
    JSON.stringify({ t: 'meta', at: new Date().toISOString(), model: 'm' }),
    JSON.stringify({ role: 'user', content: '똑같은말 딴 대화' }),
  ].join('\n'), 'utf8');

  const r = 찾기(많은방, '똑같은말', { limit: 8 });
  const 세션들 = new Set(r.맞은것.map((h) => h.세션));
  check('한 대화가 결과를 독차지하지 않는다', 세션들.size === 2, [...세션들].join(', '));
  check('세션당 셋까지만 올린다',
    r.맞은것.filter((h) => h.세션 === '20260101-000000').length <= 3,
    String(r.맞은것.filter((h) => h.세션 === '20260101-000000').length));
  check('전체 맞은 수는 따로 센다', r.전체맞음 > r.맞은것.length, `${r.전체맞음} vs ${r.맞은것.length}`);

  // 예산에 걸려 멈추면 **멈췄다고 말해야 한다.** 이게 없으면
  // "못 찾았습니다" 가 "그런 대화 없습니다" 로 읽힌다.
  const 짧은예산 = 찾기(많은방, '똑같은말', { 예산: 10 });
  check('예산이 모자라면 그렇다고 말한다', 짧은예산.예산초과 === true);
  check('예산이 모자라면 안 뒤진 것이 남는다', 짧은예산.본파일 < 짧은예산.전체파일,
    `${짧은예산.본파일}/${짧은예산.전체파일}`);

  rmSync(많은방, { recursive: true, force: true });
}

// 기록이 없어도 안 터져야 한다. 첫 대화가 그렇다.
{
  const 빈방 = mkdtempSync(join(tmpdir(), 'deel-recall3-'));
  const r = 찾기(빈방, '아무거나');
  check('기록이 없어도 안 터진다', r.맞은것.length === 0 && r.전체파일 === 0);
  rmSync(빈방, { recursive: true, force: true });
}

trace('4-도구로');

// ── 모델이 스스로 부를 수 있어야 한다 ───────────────────────────────────
{
  const ctx = { scope: makeScope(root), audit: new Audit(root) };
  const r = await TOOLS.Recall.run({ query: '인코딩' }, ctx);
  check('Recall 도구가 찾아 준다', (r.hits?.length ?? 0) >= 2, JSON.stringify(r.summary));
  check('모델이 읽을 글로 돌려준다', typeof r.text === 'string' && /CP949/.test(r.text), (r.text ?? '').slice(0, 80));
  check('언제·누구인지 붙여 준다', /\d{8}-\d{6}/.test(r.text ?? '') && /(나|모델)/.test(r.text ?? ''));

  const 없음 = await TOOLS.Recall.run({ query: '존재하지않는낱말입니다' }, ctx);
  check('없으면 몇 개를 뒤졌는지 말한다', /다 뒤졌지만 없습니다/.test(없음.summary ?? ''), 없음.summary);
  check('없을 때 partial 이 거짓', 없음.partial === false, String(없음.partial));

  const 빈것 = await TOOLS.Recall.run({ query: '  ' }, ctx);
  check('빈 물음은 오류로 돌려준다', !!빈것.error, JSON.stringify(빈것));

  // 도구는 작업 범위 안의 기록만 본다.
  check('도구가 이 폴더 기록만 본다', r.hits.every((h) => /^\d{8}-\d{6}$/.test(h.session)));
}

trace('5-옮겨온기록');

// ── 폴더째 옮겨 와도 날짜가 맞는가 ──────────────────────────────────────
//
// 이 도구는 오프라인 PC 로 폴더를 옮겨 다니는 것을 전제로 만들었다.
// 그렇게 옮기면 파일이 만져진 날(mtime)은 옮긴 날로 전부 바뀐다. 그걸 그대로
// 찍으면 반 년 치 대화가 하나같이 "오늘" 이 되고, 이 화면은 아무 말도 안 하게 된다.
{
  const 옮김 = mkdtempSync(join(tmpdir(), 'deel-recall-옮김-'));
  const d = join(옮김, '.deel', 'sessions');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '20260214-093000.jsonl'), [
    JSON.stringify({ t: 'meta', at: '2026-02-14T09:30:00.000Z', model: '스텁모델' }),
    JSON.stringify({ role: 'user', content: '반출 심사서 양식이 어디 있었죠' }),
  ].join('\n') + '\n', 'utf8');
  // 방금 만들었으니 mtime 은 오늘이다 — 옮겨 온 상황과 똑같다.

  const r = 찾기(옮김, '심사서 양식');
  const 날 = r.맞은것[0]?.언제;
  check('대화가 적어 둔 날을 쓴다', 날 instanceof Date && 날.toISOString().startsWith('2026-02-14'),
    String(날));

  // meta 가 없는 옛 기록·깨진 기록에서도 죽지 않아야 한다.
  writeFileSync(join(d, '20251101-120000.jsonl'), [
    JSON.stringify({ t: 'meta', at: '이건 날짜가 아니다' }),
    JSON.stringify({ role: 'user', content: '심사서 양식 이야기 또' }),
  ].join('\n') + '\n', 'utf8');
  writeFileSync(join(d, '20251102-120000.jsonl'),
    JSON.stringify({ role: 'user', content: '심사서 양식 meta 없는 옛 기록' }) + '\n', 'utf8');
  const r2 = 찾기(옮김, '심사서 양식');
  check('meta 가 깨져도 안 죽는다', r2.맞은것.length === 3, String(r2.맞은것.length));
  check('날짜를 못 읽으면 파일 날로 갈음한다', r2.맞은것.every((h) => h.언제 instanceof Date),
    r2.맞은것.map((h) => String(h.언제)).join(' | '));

  rmSync(옮김, { recursive: true, force: true });
}

/*
 * ★★ Anthropic 꼴 도구 부름·결과도 찾힌다.
 *
 * `글로()` 가 `m.tool_calls` 와 `p?.text` 로만 읽었다. 그 규격의 부름
 * (`tool_use`)에는 `.text` 가 없고 결과(`tool_result`)는 `.content` 라
 * 둘 다 빈 글로 떨어졌고, 빈 글은 버려진다. 그래서 그 창구로 한 일은
 * 아무리 찾아도 안 나왔다 — 「그런 적 없다」 와 구별이 안 된다.
 */
{
  const 방 = join(root, '.deel', 'sessions');
  mkdirSync(방, { recursive: true });
  const 줄 = [
    JSON.stringify({ t: 'meta', 때: Date.now(), 방: '앤트로픽판' }),
    JSON.stringify({ role: 'user', content: '토큰 세는 데를 고쳐줘' }),
    JSON.stringify({
      role: 'assistant',
      content: [
        { type: 'text', text: '토큰 세는 자리를 보겠습니다.' },
        { type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: 'src/backend/tokens.js' } },
      ],
    }),
    JSON.stringify({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: '자모범위가 빠져 있었다' }] }),
  ].join(String.fromCharCode(10));
  writeFileSync(join(방, '20260904-9999.jsonl'), 줄 + String.fromCharCode(10), 'utf8');

  const 찾음 = 찾기(root, 'tokens.js').맞은것;
  check('★★ Anthropic 꼴 도구 부름의 인자로 찾힌다', 찾음.length > 0,
    `${찾음.length}건`);
  const 찾음2 = 찾기(root, '자모범위', { 도구결과까지: true }).맞은것;
  check('★★ Anthropic 꼴 도구 결과 알맹이로도 찾힌다', 찾음2.length > 0,
    `${찾음2.length}건`);
  const 찾음3 = 찾기(root, '자모범위').맞은것;
  check('★ 도구 결과까지 안 켜면 결과 알맹이는 안 뒤진다', 찾음3.length === 0,
    `${찾음3.length}건`);
}

rmSync(root, { recursive: true, force: true });

trace('6-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n지난 대화 찾기 검사  ${D}(기록이 있는데 못 찾으면 없는 것과 같다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

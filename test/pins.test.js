// 못 박은 것이 정말 안 지워지는가.
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// 긴 대화는 결국 접히고 요약된다. 그런데 2026년에 나온 재기(arXiv 2608.22752)로는
// 요약 압축이 **안전 제약의 절반만** 남긴다. 132k 토큰을 2.3k 로 줄이면서(98%)
// 무엇을 버렸는지는 아무도 안 알려 준다.
//
// 사람이 "이 폴더는 CP949 다", "운영 DB 는 건드리지 마라" 하고 못 박은 말이
// 그 절반에 들어가면, 모델은 **그 말을 들은 적 없는 상태로** 계속 일한다.
// 여기서 재는 것은 하나다 — **못 박은 것은 무슨 일이 있어도 남는가.**
//
//   1) 접어도 남는가
//   2) 요약해도 남는가
//   3) 대화를 비워도 남는가
//   4) 껐다 켜도 남는가
//   5) 자리를 얼마나 먹나 (상한을 지키는가)
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 못박기, 최대개수, 최대토큰 as 못박기상한 } from '../src/agent/pins.js';
import { Session, estimateTokens } from '../src/agent/session.js';
import { Store } from '../src/agent/store.js';
import { foldToolResults } from '../src/agent/compact.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-pins-'));

trace('1-못박고빼기');

// ── 못 박고 빼기 ────────────────────────────────────────────────────────
{
  const p = new 못박기();
  check('처음엔 아무것도 없다', p.목록().length === 0 && p.요약() === null);

  const r = p.더하기('이 폴더 문서는 CP949 다');
  check('못 박으면 번호를 준다', r.ok && r.번호 === 1, JSON.stringify(r));
  check('목록에 남는다', p.목록()[0]?.말 === '이 폴더 문서는 CP949 다');

  p.더하기('운영 DB 는 건드리지 마라');
  check('두 번째는 2번', p.목록()[1]?.번호 === 2, JSON.stringify(p.목록()));

  // 같은 말을 두 번 박으면 늘어나기만 한다. 한 번만 센다.
  const 또 = p.더하기('이 폴더 문서는 CP949 다');
  check('같은 말은 두 번 안 박는다', !또.ok && p.목록().length === 2, JSON.stringify(또));

  check('빈 말은 안 박는다', !p.더하기('   ').ok && !p.더하기(null).ok);

  const 뺀것 = p.지우기('1');
  check('번호로 뺀다', 뺀것.ok && p.목록().length === 1, JSON.stringify(뺀것));
  check('뺀 뒤 번호가 다시 매겨진다', p.목록()[0]?.번호 === 1, JSON.stringify(p.목록()));
  check('없는 번호는 조용히 알려 준다', !p.지우기('99').ok);

  p.지우기('전부');
  check('전부 빼면 비워진다', p.목록().length === 0 && p.요약() === null);
}

trace('2-상한');

// ── 자리를 얼마나 먹나 ──────────────────────────────────────────────────
//
// 프롬프트에 매 턴 들어가는 글이다. 사람이 백 줄을 박아 두면 그것만으로
// 창이 찬다 — 못 박은 것 때문에 대화가 못 가면 앞뒤가 안 맞는다.
{
  const p = new 못박기();
  for (let i = 0; i < 30; i++) p.더하기(`제약 ${i} ${'가'.repeat(60)}`);
  check('개수 상한을 넘지 않는다', p.목록().length <= 최대개수, `${p.목록().length}개 / 상한 ${최대개수}`);
  check('프롬프트에 실리는 양이 상한 안', estimateTokens(p.요약() ?? '') <= 못박기상한,
    `${estimateTokens(p.요약() ?? '')}토큰 / 상한 ${못박기상한}`);
  check('한 줄이 너무 길면 자른다', p.목록().every((x) => x.말.length <= 200),
    `${Math.max(...p.목록().map((x) => x.말.length))}자`);

  const 꽉찬뒤 = p.더하기('더 넣기');
  check('꽉 찼으면 그렇다고 말한다', !꽉찬뒤.ok && /가득|상한|많/.test(꽉찬뒤.why ?? ''), JSON.stringify(꽉찬뒤));
}

trace('3-접어도남는가');

// ── 접기·요약·비우기를 견디는가 ─────────────────────────────────────────
//
// 여기가 이 기능의 전부다. 못 박은 것은 **메시지가 아니라 프롬프트**로 들어간다.
// 접기와 요약은 메시지를 건드리므로, 애초에 닿을 수 없는 자리에 둔 것이다.
{
  const s = new Session({ model: 'm', ctx: 8000 }, { root });
  s.못박은것.더하기('이 폴더 문서는 CP949 다');
  s.못박은것.더하기('운영 DB 는 건드리지 마라');

  const 처음 = s.systemPrompt();
  check('못 박은 것이 프롬프트에 실린다',
    처음.includes('CP949') && 처음.includes('운영 DB'), '둘 다 있어야 한다');
  check('못 박았다고 분명히 적는다', /못 박|반드시|지켜/.test(처음));

  // 도구 결과를 잔뜩 쌓고 접는다.
  for (let i = 0; i < 10; i++) {
    s.messages.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'Read', arguments: '{"path":"a.js"}' } }] });
    s.messages.push({ role: 'tool', tool_call_id: `c${i}`, content: 'x'.repeat(3000) });
  }
  foldToolResults(s, { keep: 2, min: 100 });
  check('접어도 못 박은 것은 남는다', s.systemPrompt().includes('CP949'));

  // 대화를 통째로 비워도(요약이 하는 일의 극단) 남아야 한다.
  s.messages = [];
  check('대화를 비워도 못 박은 것은 남는다',
    s.systemPrompt().includes('CP949') && s.systemPrompt().includes('운영 DB'));
}

trace('4-껐다켜도');

// ── 껐다 켜도 남는가 ────────────────────────────────────────────────────
{
  const store = new Store(root, 'pin-이어하기');
  store.begin({ model: 'm', root });
  store.append({ role: 'user', content: '시작' });
  store.못박기목록([{ 번호: 1, 말: '이 폴더 문서는 CP949 다' }]);
  store.append({ role: 'assistant', content: '네' });

  const 다시 = new Store(root, 'pin-이어하기');
  check('저장된 것을 다시 읽는다', 다시.못박은것읽기()[0]?.말 === '이 폴더 문서는 CP949 다',
    JSON.stringify(다시.못박은것읽기()));
  check('메시지는 그대로 읽힌다', 다시.load().messages.length === 2);

  // 압축이 일어나면 store.replace 가 파일을 새로 쓴다. 그때 같이 지워지면
  // '접혀도 남는다' 는 말이 거짓이 된다 — 여기가 제일 놓치기 쉬운 자리다.
  다시.replace([{ role: 'user', content: '요약된 것' }], '압축');
  const 압축뒤 = new Store(root, 'pin-이어하기');
  check('압축으로 파일을 새로 써도 못 박은 것은 남는다',
    압축뒤.못박은것읽기()[0]?.말 === '이 폴더 문서는 CP949 다',
    JSON.stringify(압축뒤.못박은것읽기()));
  check('압축 뒤 메시지는 새것으로 바뀐다', 압축뒤.load().messages.length === 1);

  const 글 = readFileSync(join(root, '.deel', 'sessions', 'pin-이어하기.jsonl'), 'utf8');
  check('한 줄로 적힌다', 글.split('\n').filter((l) => l.includes('"t":"pins"')).length === 1,
    `${글.split('\n').filter((l) => l.includes('"t":"pins"')).length}줄`);
}

trace('5-무엇을버렸나');

// ── 접을 때 무엇을 버렸는지 알려 주는가 ─────────────────────────────────
//
// 조용히 버리면 사람이 모른다. 무엇이 줄었는지 한 줄로라도 남겨야
// "아까 그 파일 내용 어디 갔지" 를 스스로 답할 수 있다.
{
  const s = new Session({ model: 'm', ctx: 8000 }, { root });
  for (let i = 0; i < 8; i++) {
    s.messages.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'Read', arguments: `{"path":"src/f${i}.js"}` } }] });
    s.messages.push({ role: 'tool', tool_call_id: `c${i}`, content: 'y'.repeat(2500) });
  }
  const r = foldToolResults(s, { keep: 2, min: 100 });
  check('무엇을 접었는지 이름으로 알려 준다', Array.isArray(r.접은것들) && r.접은것들.length > 0,
    JSON.stringify(r.접은것들?.slice(0, 3)));
  check('접은 것 개수와 목록 길이가 맞는다', r.접은것들?.length === r.접은것,
    `${r.접은것들?.length} vs ${r.접은것}`);
  check('어느 파일이었는지 남는다', /f\d+\.js/.test(JSON.stringify(r.접은것들 ?? [])),
    JSON.stringify(r.접은것들?.[0]));
}

rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n못 박은 것 검사  ${D}(접히고 요약돼도 지켜야 할 말이 남는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

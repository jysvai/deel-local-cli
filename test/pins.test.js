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
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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

  // 긴 핀은 토큰 상한이 먼저 막는다(6회차 W3 — 안 실릴 핀은 안 받음). 개수 상한은 짧은 핀으로 채워 잰다.
  const 짧게 = new 못박기();
  for (let i = 0; i < 30; i++) 짧게.더하기(`제약 ${i}`);
  check('짧은 핀은 개수 상한까지 받고 다 실린다', 짧게.개수() === 최대개수 && 짧게.실린것().다실렸나, `${짧게.개수()}개 · ${JSON.stringify(짧게.실린것())}`);
  const 꽉찬뒤 = 짧게.더하기('더 넣기');
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

trace('4b-못-이어받아도-핀은-따라간다');

/*
 * ── ★★★ 되살린 핀이 **새 대화 파일에 적히는가** (막판 훑기) ──────────────
 *
 * `--resume` 이 파일은 찾았는데 남은 말이 중단된 도구 호출뿐이면 새 대화로
 * 넘어간다. 그때도 못 박은 것은 되살려서 화면에 「그대로 이어 받았습니다」 라고
 * 적는다. repl.js 의 그 자리 머리말도 「되살린 핀은 새로 열리는 대화에 같이
 * 적힌다」 고 적어 뒀는데 — **적는 자리가 없었다.** `begin()` 은 meta 한 줄만
 * 쓰고, `못박기목록` 을 부르는 데는 `/pin` 하나뿐이다.
 *
 * 그래서 핀이 그 판에서만 살아 있었다. 다음에 그 새 대화를 `--resume` 하면
 * 하나도 없다. 사람은 이미 말했다고 믿으니 다시 말하지 않는다 — 핀을 되살리는
 * 까닭으로 이 파일 머리말이 적어 둔 바로 그 고장이다.
 *
 * 여기서는 그 길을 진짜로 걷는다(`deel --resume <중단된대화>` 를 띄운다).
 * 화면 글자만 재면 「적힌다」 는 말을 못 잰다 — 재야 할 것은 **파일**이다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-pin-이어-'));
  const 집 = mkdtempSync(join(tmpdir(), 'deel-pin-집-'));
  const 자리 = join(방, '.deel', 'sessions');
  mkdirSync(자리, { recursive: true });
  const 옛이름 = '20260101-000000';
  const 핀말 = '빌드 전에 npm run check 를 꼭 돌린다';
  // 남은 것이 **중단된 도구 호출뿐**인 대화 — 이어받기가 안 되는 그 자리.
  writeFileSync(join(자리, `${옛이름}.jsonl`), `${[
    JSON.stringify({ t: 'meta', at: '2026-01-01T00:00:00.000Z', model: 'm', base: 'x', root: 방 }),
    JSON.stringify({ t: 'pins', at: '2026-01-01T00:00:01.000Z', 목록: [핀말] }),
    JSON.stringify({
      t: 'msg',
      at: '2026-01-01T00:00:02.000Z',
      m: { role: 'assistant', content: '', tool_calls: [{ id: 'z', type: 'function', function: { name: 'Read', arguments: '{}' } }] },
    }),
  ].join('\n')}\n`, 'utf8');
  // 열쇠는 없는 가짜 연결이다. 모델에 붙을 일이 없다 — `/exit` 로 바로 끝낸다.
  writeFileSync(join(집, 'config.json'), JSON.stringify({
    version: 1,
    active: 'p',
    profiles: [{ id: 'p', name: '스텁', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', auth: 'none', apiKey: '', model: 'm', ctx: 8192 }],
  }, null, 2), 'utf8');

  const r = spawnSync(process.execPath, [
    fileURLToPath(new URL('../bin/deel.js', import.meta.url)), '--resume', 옛이름,
  ], {
    cwd: 방,
    env: { ...process.env, DEEL_HOME: 집, DEEL_LANG: 'ko', NO_COLOR: '1' },
    input: '/exit\n',
    encoding: 'utf8',
    timeout: 90000,
  });

  const 화면 = String(r.stdout ?? '');
  check('먼저: 그 대화는 이어받지 못한다', /이어받을 말이 없습니다/.test(화면), 화면.split('\n').find((l) => /이어받을|못 읽었습니다/.test(l)) ?? '');
  check('먼저: 그래도 못 박은 것은 되살렸다고 말한다', /못 박아 둔 것/.test(화면), 화면.split('\n').find((l) => /못 박아 둔 것/.test(l)) ?? '');

  const 새것 = readdirSync(자리).filter((f) => f.endsWith('.jsonl') && !f.startsWith(옛이름));
  const 핀든새것 = 새것.filter((f) => readFileSync(join(자리, f), 'utf8').includes('"t":"pins"'));
  check('★★★ 되살린 핀이 새로 열린 대화 파일에도 적힌다',
    새것.length === 1 && 핀든새것.length === 1, `새 대화 ${새것.length}개 · 핀 적힌 것 ${핀든새것.length}개`);
  check('★★ 적힌 것이 그 핀 그대로다',
    핀든새것.length === 1 && readFileSync(join(자리, 핀든새것[0]), 'utf8').includes(핀말),
    핀든새것[0] ?? '');
  // (짝) 이어쓰는 자리에는 같은 줄을 한 번 더 얹지 않는다 — 위 4절이 「한 줄로 적힌다」 를 잰다.

  rmSync(방, { recursive: true, force: true });
  rmSync(집, { recursive: true, force: true });
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

trace('6-받은것은실린다');

// ── 받았다고 한 핀은 정말 실리는가 ──────────────────────────────────────
//
// 6회차 Gemini 못박기6u W3. 토큰 상한(240)에 걸려 프롬프트에 안 실릴 핀도
// 더하기가 ok 로 받았다. 영어 200자 핀 12개가 다 박혔다고 나오고 실린 것은
// 3개 — 한글은 180자 한 줄이면 혼자서도 안 실렸다. /pin 추가 화면은 「접거나
// 요약해도 안 지워집니다」 만 찍는다. 이 기능이 막으려던 바로 그 꼴이다.
{
  const p = new 못박기();
  let 받은수 = 0;
  let 거절 = null;
  for (let i = 0; i < 12; i++) {
    const r = p.더하기(`rule ${i} ${'x'.repeat(190)}`);
    if (r.ok) 받은수++; else { 거절 = r; break; }
  }
  const 실림 = p.실린것();
  check('★ (6회차 W3) 더하기가 받은 핀은 전부 프롬프트에 실린다', 실림.다실렸나 && 실림.개수 === 받은수 && p.개수() === 받은수,
    `받은 ${받은수} · 실린 ${JSON.stringify(실림)}`);
  check('★ (6회차 W3) 자리가 모자라면 받지 않고 그렇다고 말한다', !!거절 && !거절.ok && /자리|상한/.test(거절.why ?? ''), JSON.stringify(거절));

  const 한 = new 못박기();
  const 긴한글 = 한.더하기('가'.repeat(190));
  check('★ (6회차 W3) 혼자서도 안 실릴 긴 한 줄은 받지 않는다', !긴한글.ok && 한.개수() === 0 && 한.요약() === null, JSON.stringify(긴한글).slice(0, 80));
  const 짧은것 = 한.더하기('운영 DB 는 건드리지 마라');
  check('짝: 짧은 핀은 그대로 받고 실린다', 짧은것.ok && 한.실린것().다실렸나 && 한.요약()?.includes('운영 DB'), JSON.stringify(짧은것));
}

// ── 한 줄 상한에서 글자를 반쪽으로 자르나 ────────────────────────────────
//
// 6회차 Gemini 못박기6u W2. 다듬기() 가 UTF-16 칸으로 200 을 자르면 이모지가
// 반쪽(짝 없는 서로게이트)으로 남는다. 매 턴 시스템 프롬프트에 실리는 글이라
// 그런 글자를 거절하는 서버면 핀을 뺄 때까지 모든 턴이 깨진다.
{
  const p = new 못박기();
  const r = p.더하기(`${'x'.repeat(199)}🍎끝`);
  check('★ (6회차 W2) 한 줄 상한에서 이모지를 반쪽으로 안 자른다', r.ok && r.말.isWellFormed() && r.잘렸나 === true, JSON.stringify(r.말?.slice(-4)));
  const 되살림 = new 못박기([{ 말: `${'x'.repeat(199)}🍎` }]);
  check('★ (6회차 W2) 되살린 핀도 반쪽 글자를 안 남긴다', 되살림.목록()[0]?.말.isWellFormed() === true, JSON.stringify(되살림.목록()[0]?.말.slice(-4)));
  const 온전 = new 못박기().더하기(`${'x'.repeat(198)}🍎`);
  check('짝: 상한 안에 온전히 드는 이모지는 그대로 둔다', 온전.ok && 온전.말.endsWith('🍎') && 온전.잘렸나 === false, JSON.stringify(온전.말?.slice(-4)));
}

// ── 에디터(ACP) 되살리기도 다 실리는지 보나 (6회차 못박기6u W4) ──────────
// 터미널 쪽은 resume.test 가 실제로 띄워 본다. ACP 는 로그로만 적어 모양으로 본다.
{
  const 에디터 = readFileSync(new URL('../src/acp/serve.js', import.meta.url), 'utf8');
  const 자리 = 에디터.indexOf('new 못박기(박힌것)');
  check('★ (6회차 W4) 에디터(ACP) 되살리기도 다 실리는지 보고 적는다', 자리 > 0 && /실린것\(\)/.test(에디터.slice(자리, 자리 + 400)), `자리 ${자리}`);
}

rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n못 박은 것 검사  ${D}(접히고 요약돼도 지켜야 할 말이 남는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
{
  /*
   * 6회차 Gemini 스레드6 — 한 줄 상한(200자)을 넘긴 핀은 조용히 잘렸는데, /pin 화면은 자르기
   * **전** 원문을 박았다고 보여 줬다. 사람은 뒤쪽 조건까지 박힌 줄 안다.
   */
  const p = new 못박기();
  const 긴말 = '운영 DB 는 건드리지 마라 '.repeat(20).trim();
  const r = p.더하기(긴말);
  check('한 줄 상한을 넘긴 핀은 잘렸다고 알린다', r.ok && r.잘렸나 === true && r.말 === p.목록()[0].말 && r.말.length < 긴말.length, JSON.stringify(r).slice(0, 120));
  const r2 = p.더하기('짧은 말');
  check('상한 안의 핀은 잘렸다고 안 한다', r2.ok && r2.잘렸나 === false && r2.말 === '짧은 말', JSON.stringify(r2));
  const 화면 = readFileSync(new URL('../src/commands/work.js', import.meta.url), 'utf8');
  check('/pin 화면은 실제로 박힌 말(r.말)을 보여 주고, 잘렸으면 말한다', /\$\{r\.말\}/.test(화면) && /r\.잘렸나/.test(화면), '');
}

console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

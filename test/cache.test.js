/**
 * 로컬 모델의 숨은 지연 — 프롬프트 앞머리가 안 흔들리는가.
 *
 * ── 왜 재나 ─────────────────────────────────────────────────────────────
 *
 * Ollama·llama.cpp 는 **앞부분이 지난 요청과 같을 때만** 계산을 재쓴다
 * (프리픽스 캐시). 앞부분이 한 글자라도 다르면 거기서부터 끝까지 —
 * 시스템 프롬프트 나머지에 **대화 전체까지** — 다시 계산한다.
 *
 * deel 은 말을 던질 때마다 알맞은 모드로 저절로 옮겨 간다(route.js). 그 모드
 * 지시문이 시스템 프롬프트의 **세 번째 자리**에 있었다. 모드가 바뀌는 순간
 * 그 뒤 전부가 무효가 된다 — 긴 대화일수록 매 턴 몇천 토큰을 다시 계산하고,
 * 로컬 모델에서는 그게 그대로 몇 초의 기다림이다. 오류가 아니라서 아무 데도
 * 안 찍히고, 사람 눈에는 그냥 "로컬이라 느리다" 로 보인다.
 *
 * 그래서 변하는 것(모드·핀)을 끝으로 보내고, 변하지 않는 것(규칙·폴더·급말·
 * 지문·사용자 규칙·기억·스킬)을 앞에 굳힌다. 이 검사는 그 순서가 다시
 * 무너지지 않게 지킨다 — 순서는 눈에 안 보여서, 검사가 없으면 다음 기능이
 * 아무 데나 끼어든다.
 */
import { Session } from '../src/agent/session.js';
import { buildBody } from '../src/backend/adapter.js';
import { 언어정하기 } from '../src/i18n/index.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 적어둘것 = [];

언어정하기('ko');
const root = mkdtempSync(join(tmpdir(), 'deel-cache-'));
writeFileSync(join(root, 'DEEL.md'), '- 사용자 규칙 한 줄\n', 'utf8');
const conn = (ctx = 32768) => ({ kind: 'openai', base: 'http://127.0.0.1:1/v1', model: '검사용', ctx });

/** 두 글의 공통 앞머리 길이. */
const 공통앞 = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

// ══ 1. 같은 상태면 같은 글 ══════════════════════════════════════════════
trace('1-결정적');
{
  const s = new Session(conn(), { root, work: 'code' });
  check('연이어 만들어도 한 글자도 안 다르다', s.systemPrompt() === s.systemPrompt());
  // 시각·난수가 섞이면 캐시는 영영 안 맞는다. 이건 그 문을 잠그는 검사다.
  const 다시 = new Session(conn(), { root, work: 'code' });
  check('새로 만들어도 같다 — 시각·난수가 안 섞인다', s.systemPrompt() === 다시.systemPrompt());
}

// ══ 2. 모드가 바뀌어도 앞머리가 안 흔들린다 ═════════════════════════════
trace('2-모드전환');
{
  const s = new Session(conn(), { root, work: 'code' });
  const 코드판 = s.systemPrompt();
  s.work = 'debug';
  const 디버그판 = s.systemPrompt();
  s.work = 'ask';
  const 묻기판 = s.systemPrompt();

  check('모드가 다르면 글이 다르다', 코드판 !== 디버그판, '');

  // 핵심: 모드 표식 앞까지는 **한 글자도** 안 달라야 한다.
  const 표식 = '--- 지금 모드';
  const i1 = 코드판.indexOf(표식);
  const i2 = 디버그판.indexOf(표식);
  const i3 = 묻기판.indexOf(표식);
  check('모드 표식이 있다', i1 > 0 && i2 > 0 && i3 > 0, `${i1} ${i2} ${i3}`);
  check('모드 앞까지는 같은 자리다', i1 === i2 && i2 === i3, `${i1} ${i2} ${i3}`);
  check('모드 앞까지는 같은 글이다', 코드판.slice(0, i1) === 디버그판.slice(0, i2) && 코드판.slice(0, i1) === 묻기판.slice(0, i3));

  // 굳은 앞머리가 전체의 대부분이어야 값이 있다. 모드 절이 앞에 있으면
  // 이 몫이 확 떨어진다 — 그게 바로 고치기 전의 모습이다.
  const 몫 = 공통앞(코드판, 디버그판) / Math.max(코드판.length, 디버그판.length);
  check('굳은 앞머리가 전체의 60% 이상', 몫 >= 0.6, `${(몫 * 100).toFixed(1)}%`);
  적어둘것.push(`모드 전환에도 앞 ${(몫 * 100).toFixed(1)}% 가 그대로 — 그만큼 로컬 캐시가 산다`);
}

// ══ 3. 변하지 않는 것들이 모드보다 앞에 있다 ════════════════════════════
trace('3-차례');
{
  const s = new Session(conn(), { root, work: 'code' });
  s.못박은것.더하기('이 말은 못 박은 것');
  const 글 = s.systemPrompt();

  const 자리 = (t) => 글.indexOf(t);
  const 모드 = 자리('--- 지금 모드');
  check('작업 폴더가 모드보다 앞', 자리('작업 폴더:') >= 0 && 자리('작업 폴더:') < 모드, '');
  check('사용자 규칙이 모드보다 앞', 자리('사용자 규칙') >= 0 && 자리('사용자 규칙') < 모드, `${자리('사용자 규칙')} vs ${모드}`);
  // 못 박은 것은 여전히 **맨 끝**이다 — lost-in-the-middle 를 피하는 자리.
  // 캐시를 지키자고 이 자리를 내주면 안 된다: 핀은 바뀌는 일이 드물어서
  // 끝에 있어도 캐시 값이 거의 안 든다.
  check('못 박은 것이 모드보다도 뒤 — 맨 끝', 자리('이 말은 못 박은 것') > 모드, '');
  check('모드 지시문이 끝쪽에 있다', 모드 > 글.length * 0.5, `${모드} / ${글.length}`);
}

// ══ 4. 영어판도 같은 규칙 ═══════════════════════════════════════════════
trace('4-영어판');
{
  언어정하기('en');
  const s = new Session(conn(), { root, work: 'code' });
  const a = s.systemPrompt();
  s.work = 'debug';
  const b = s.systemPrompt();
  const 표식 = '--- current mode';
  const ia = a.indexOf(표식);
  check('영어판에도 모드 표식이 있다', ia > 0, '');
  check('영어판도 모드 앞까지 같다', ia === b.indexOf(표식) && a.slice(0, ia) === b.slice(0, ia), '');
  언어정하기('ko');
}

// ══ 5. Ollama 에는 keep_alive 를 보낸다 ═════════════════════════════════
trace('5-keep_alive');
{
  /*
   * Ollama 는 5분 동안 조용하면 모델을 내린다. 다음 말을 걸면 모델을 다시
   * 올리고 **대화 전체를 다시 계산한다** — 캐시가 통째로 없어진 것과 같다.
   * 로컬 대화는 사람이 생각하고 다른 창을 보다 돌아오는 것이라 5분 넘게
   * 조용한 것이 보통이다. 한 시간을 잡아 둔다.
   *
   * -1(영원히)로 안 하는 이유: 모델을 갈아탄 뒤에도 이전 모델이 램을 물고
   * 있게 된다. 8GB 램에서 그건 다음 모델이 못 올라온다는 뜻이다.
   */
  const b = buildBody('ollama', { model: 'm', messages: [], maxTokens: 100 });
  check('ollama: keep_alive 가 실린다', b.keep_alive === '60m', String(b.keep_alive));
  check('ollama: num_ctx 는 그대로 (회귀)', buildBody('ollama', { model: 'm', messages: [], ctx: 8192 }).options.num_ctx === 8192);

  // 게이트웨이(OpenAI 규격)는 모르는 이름에 400 을 내는 것이 있다. 안 보낸다.
  const g = buildBody('openai', { model: 'm', messages: [], maxTokens: 100 });
  check('openai 규격에는 안 보낸다', !('keep_alive' in g), Object.keys(g).join());

  // 값을 바꾸고 싶은 사람의 문. 램이 아주 작으면 짧게 잡을 수도 있어야 한다.
  process.env.DEEL_KEEP_ALIVE = '5m';
  const b2 = buildBody('ollama', { model: 'm', messages: [], maxTokens: 100 });
  check('DEEL_KEEP_ALIVE 로 바꿀 수 있다', b2.keep_alive === '5m', String(b2.keep_alive));
  delete process.env.DEEL_KEEP_ALIVE;
}

rmSync(root, { recursive: true, force: true });

// ── 마무리 ──────────────────────────────────────────────────────────────
const C = (n, s) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[${n}m${s}\x1b[0m` : s);
console.log('');
for (const f of fail) console.log(`  ${C(31, '✗')} ${f.name}${f.note ? C(90, `  ${f.note}`) : ''}`);
for (const 글 of 적어둘것) console.log(`  ${C(90, `· ${글}`)}`);
console.log('');
console.log(`  ${pass.length}개 통과 · ${fail.length}개 실패`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

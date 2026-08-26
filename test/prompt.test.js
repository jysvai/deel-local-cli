// 모델이 읽는 글 — 화면 말이 영어면 이쪽도 영어로 간다.
//
// ── 왜 화면과 따로 재나 ─────────────────────────────────────────────────
//
// 화면 말만 영어로 갈아 끼우면 모델은 계속 한국어로 답한다. 규칙에 "사용자에게
// 답할 때는 한국어로" 가 박혀 있어서다. 영어권 사람에게는 아무것도 안 고친 것과
// 같다. 그래서 이 단계에서는 모델이 읽는 글까지 바꾸는데, 바로 그래서 **규칙이
// 새는지**를 재야 한다.
//
// 옮기다 한 줄이 빠지면 영어로 켠 사람만 조용히 다른 프로그램을 쓴다. Read 없이
// 고치고, 확인 안 한 것을 됐다고 하고, 안 끝나는 명령을 그냥 불러 죽는다.
// 그 차이는 몇 걸음 뒤에야 드러나고, 그때는 원인을 못 찾는다.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session, estimateTokens } from '../src/agent/session.js';
import { MODES, 말 as 모드말, 보일이름, 보일한줄 } from '../src/agent/modes.js';
import { toolSchemas } from '../src/tools/index.js';
import { 도구설명EN } from '../src/tools/desc.en.js';
import { 언어, 언어정하기 } from '../src/i18n/index.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 적어둘것 = [];

const 원래 = 언어();
const root = mkdtempSync(join(tmpdir(), 'deel-prompt-'));
const conn = (ctx = 32768) => ({ kind: 'openai', base: 'http://127.0.0.1:1/v1', model: '검사용', ctx });
const 프롬 = (l, opt = {}) => { 언어정하기(l); return new Session(conn(opt.ctx), { root, work: opt.work ?? 'code' }).systemPrompt(); };

trace('1-말을따라가나');

// ── 화면 말을 따라가는가 ────────────────────────────────────────────────
{
  const 한 = 프롬('ko');
  const 영 = 프롬('en');
  check('두 글이 다르다', 한 !== 영);
  check('영어판에 한글이 거의 없다', (영.match(/[가-힣]/g) ?? []).length === 0,
    `한글 ${(영.match(/[가-힣]/g) ?? []).length}자: ${(영.match(/[가-힣]+/g) ?? []).slice(0, 5).join(' ')}`);
  check('한국어판은 한국어 그대로', /너는 deel 다/.test(한), 한.slice(0, 40));
  check('영어판은 영어로 시작', /^You are deel/.test(영), 영.slice(0, 40));
}

trace('2-규칙이새지않나');

// ── 여기가 본체: 규칙이 한 줄도 안 빠졌는가 ─────────────────────────────
//
// 아래 것들은 각각 사고 하나를 막는 자리다. 빠지면 영어로 켠 사람만 그 사고를 겪는다.
{
  // [뜻, 한국어에서 찾을 것, 영어에서 찾을 것]
  const 반드시 = [
    ['고치기 전에 읽어라', /Read/, /Read/],
    ['확인 못 했으면 그렇다고 말해라', /확인 못 했/, /could not verify/i],
    ['같은 도구를 같은 인자로 또 부르지 마라', /같은 도구를 같은 인자로/, /same tool with the same arguments/i],
    ['앞부분을 다시 보내지 마라', /앞부분을 다시 보내지/, /Do not resend the earlier part/i],
    ['이 폴더 밖은 못 건드린다', /이 폴더 밖의 파일은/, /outside this folder/i],
    ['계획만 세우고 멈추지 마라', /계획만 (세우고|내고) 멈추지/, /Do not stop at a plan/i],
    ['규칙은 Remember 로 남겨라', /Remember/, /Remember/],
    ['앞선 대화는 Recall 로 찾아라', /Recall/, /Recall/],
  ];
  const 한 = 프롬('ko');
  const 영 = 프롬('en');
  for (const [뜻, ㅎ, ㅇ] of 반드시) {
    check(`한국어: ${뜻}`, ㅎ.test(한), '');
    check(`영어: ${뜻}`, ㅇ.test(영), '');
  }

  // 답하는 말이 화면 말과 같아야 한다. 이게 이 단계를 하는 첫째 이유다.
  check('한국어판은 한국어로 답하라고 한다', /한국어로/.test(한), '');
  check('영어판은 영어로 답하라고 한다', /Answer the user in English|Answer in English/.test(영), '');
  check('영어판에 "한국어로 답하라" 가 안 남아 있다', !/한국어로/.test(영), '');
}

trace('3-작은창');

// ── 작은 창 짧은 판도 같이 옮겨졌는가 ───────────────────────────────────
//
// 8k 모델은 짧은 판을 받는다. 한쪽만 옮기면 작은 모델을 쓰는 영어권 사람만
// 한국어 규칙을 받는다 — 하필 그쪽이 제일 흔들리기 쉬운 조합이다.
{
  const 짧은한 = 프롬('ko', { ctx: 8192 });
  const 짧은영 = 프롬('en', { ctx: 8192 });
  check('작은 창에서도 영어로 간다', (짧은영.match(/[가-힣]/g) ?? []).length === 0,
    (짧은영.match(/[가-힣]+/g) ?? []).slice(0, 5).join(' '));
  check('짧은 판이 긴 판보다 짧다', 짧은영.length < 프롬('en').length,
    `${짧은영.length} < ${프롬('en').length}`);
  check('짧은 판에도 확인 규칙이 남아 있다', /verify/i.test(짧은영), '');
  check('짧은 판에도 Read 규칙이 남아 있다', /Read a file before/i.test(짧은영), '');
  check('한국어 짧은 판도 그대로', /확인 못 했/.test(짧은한), '');
}

trace('4-모드글');

// ── 모드 글 ─────────────────────────────────────────────────────────────
{
  for (const id of Object.keys(MODES)) {
    언어정하기('en');
    const 영 = 모드말(id, 32768);
    언어정하기('ko');
    const 한 = 모드말(id, 32768);
    check(`${id}: 영어 글이 있다`, 영 !== 한, id);
    check(`${id}: 빈 글이 아니다`, String(영).trim().length > 40, `${String(영).length}자`);
    // 영어 글이 없는 모드는 한국어로 되돌아가야 한다 — 빈 글을 보내면 그 모드는
    // 아무 지시도 없는 채로 돈다. 화면 빈칸보다 훨씬 나쁘다.
    check(`${id}: 되돌아갈 자리가 있다`, typeof MODES[id].say === 'string' && MODES[id].say.length > 0, id);
  }

  // 파일을 못 바꾸는 모드는 영어 글에서도 그렇게 말해야 한다.
  언어정하기('en');
  for (const id of ['plan', 'architect']) {
    check(`${id}: 영어 글도 파일을 안 바꾼다고 한다`,
      /not been given the tools that change files/i.test(모드말(id, 32768)), id);
  }
  check('묻기 모드는 아무것도 안 바꾼다고 한다', /You change nothing/i.test(모드말('ask', 32768)));

  check('모드 이름도 영어', 보일이름('code') === 'Code', 보일이름('code'));
  check('한 줄 설명도 영어', /^[\x00-\x7f]+$/.test(보일한줄('code')), 보일한줄('code'));
  언어정하기('ko');
  check('한국어로 되돌리면 한국어 이름', 보일이름('code') === '코드', 보일이름('code'));
}

trace('5-도구설명');

// ── 도구 설명 ───────────────────────────────────────────────────────────
{
  언어정하기('en');
  const 영목록 = toolSchemas(null, { work: 'orchestrator', ctx: 1000000, hasSkills: true });
  언어정하기('ko');
  const 한목록 = toolSchemas(null, { work: 'orchestrator', ctx: 1000000, hasSkills: true });

  check('도구 개수가 같다', 영목록.length === 한목록.length, `${영목록.length} / ${한목록.length}`);
  check('도구 이름이 같다 — 이름은 식별자다',
    영목록.map((t) => t.function.name).join() === 한목록.map((t) => t.function.name).join());

  // 인자 이름도 그대로여야 한다. Task 의 목적·할일 같은 한글 인자 이름을
  // 바꾸면 그 도구가 아예 안 불린다.
  const 인자들 = (목록) => 목록.map((t) => `${t.function.name}(${Object.keys(t.function.parameters?.properties ?? {}).join('|')})`).join();
  check('인자 이름이 같다', 인자들(영목록) === 인자들(한목록), 인자들(영목록).slice(0, 120));

  const 빠짐 = 영목록.filter((t) => !String(t.function.description ?? '').trim());
  check('설명이 빈 도구가 없다', 빠짐.length === 0, 빠짐.map((t) => t.function.name).join());

  /*
   * 설명에 남은 한글은 **인자 이름뿐**이어야 한다.
   *
   * Task 의 목적·할일 같은 인자 이름은 식별자라 안 옮긴다 — 옮기면 그 도구가
   * 아예 안 불린다. 그래서 설명 안에서 그 이름을 가리키는 자리에는 한글이
   * 남는 것이 맞다. 그 밖의 한글은 안 옮긴 것이다.
   */
  const 인자이름들 = new Set(한목록.flatMap((t) => Object.keys(t.function.parameters?.properties ?? {})));
  const 아직한글 = 영목록.filter((t) => {
    const 한글토막 = String(t.function.description ?? '').match(/[가-힣]+/g) ?? [];
    return 한글토막.some((x) => !인자이름들.has(x));
  });
  check('영어 목록에 한글 설명이 안 남았다', 아직한글.length === 0,
    아직한글.map((t) => t.function.name).join());

  // 표에 없는 도구는 한국어로 되돌아간다. 그게 규칙이고, 빈칸이 아니다.
  const 표에없는 = 한목록.map((t) => t.function.name).filter((n) => !도구설명EN[n]);
  적어둘것.push(표에없는.length
    ? `아직 한국어로 나가는 도구 ${표에없는.length}개: ${표에없는.join(', ')}`
    : '도구 설명은 전부 옮겼습니다.');

  // 못 박은 규칙들이 영어 설명에도 살아 있어야 한다.
  언어정하기('en');
  const 하나 = (이름) => toolSchemas([이름], { ctx: 1000000 })[0].function;
  check('Edit: 먼저 Read 하라는 말이 남아 있다', /must Read it first/i.test(하나('Edit').description),
    하나('Edit').description.slice(0, 70));
  check('Bash: 안 끝나는 명령은 background', /background: true/.test(하나('Bash').description));
  check('Verify: 확인 못 한 것은 못 했다고 말한다', /could not check/i.test(하나('Verify').description));
  check('Append: 앞부분을 다시 보내지 마라', /No Read needed first/i.test(하나('Append').description));
  check('Task: 하위는 이 대화를 못 본다', /cannot see your conversation/i.test(하나('Task').description));
  check('Task: 모델 인자 이름이 한글 그대로', '모델' in 하나('Task').parameters.properties);
}

trace('6-창이좁아도');

// ── 좁은 창에서 줄여도 안 깨지는가 ──────────────────────────────────────
//
// 설명 줄이기는 문장 끝에서 자른다. 영어 문장을 한국어 규칙(`다.`)으로만
// 자르려 들면 통째로 안 잘리거나 한가운데서 잘린다.
{
  언어정하기('en');
  for (const ctx of [4096, 8192, 32768, 128000]) {
    const 목록 = toolSchemas(null, { work: 'code', ctx });
    const 빈것 = 목록.filter((t) => !String(t.function.description ?? '').trim());
    check(`${ctx}: 설명이 빈 도구가 없다`, 빈것.length === 0, 빈것.map((t) => t.function.name).join());
    const 잘린말 = 목록.filter((t) => /\s(a|the|to|of|and|or|in|is)$/i.test(String(t.function.description).trim()));
    check(`${ctx}: 한가운데서 잘린 설명이 없다`, 잘린말.length === 0,
      잘린말.map((t) => `${t.function.name}: …${String(t.function.description).trim().slice(-30)}`).join(' · '));
  }
}

trace('7-토큰이싼가');

// ── 얼마나 아끼는가 ─────────────────────────────────────────────────────
//
// 이 검사는 숫자를 못 박지 않는다. 옮기는 글이 늘거나 줄면 숫자가 움직이는데,
// 그때마다 검사가 빨개지면 사람은 숫자를 고치지 검사를 안 본다.
// 여기서 잴 것은 '영어가 더 싸다' 는 방향뿐이고, 실제 값은 적어만 둔다.
{
  const 잰것 = {};
  for (const l of ['ko', 'en']) {
    언어정하기(l);
    const sp = new Session(conn(), { root, work: 'code' }).systemPrompt();
    const ts = JSON.stringify(toolSchemas(null, { work: 'code', ctx: 32768 }));
    잰것[l] = { 프롬: estimateTokens(sp), 도구: estimateTokens(ts) };
  }
  const 합 = (x) => x.프롬 + x.도구;
  check('영어 쪽이 토큰을 덜 먹는다', 합(잰것.en) < 합(잰것.ko),
    `ko ${합(잰것.ko)} · en ${합(잰것.en)}`);
  적어둘것.push(`32k 창 고정 몫 — 한국어 ${합(잰것.ko)}토큰(${(합(잰것.ko) / 32768 * 100).toFixed(1)}%)`
    + ` · 영어 ${합(잰것.en)}토큰(${(합(잰것.en) / 32768 * 100).toFixed(1)}%)`
    + ` · ${합(잰것.ko) - 합(잰것.en)}토큰 덜 먹습니다`);
}

trace('8-규칙파일은안건드린다');

// ── 사람이 쓴 규칙 파일은 안 건드린다 ───────────────────────────────────
//
// DEEL.md 는 사람이 제 말로 쓴 글이다. 그 사람의 말로 모델에게 가야 한다.
// 여기서 바뀌는 것은 그것을 소개하는 머리말뿐이다.
{
  const 방 = join(root, '규칙방');
  writeFileSync(join(mkdtempSync(join(tmpdir(), 'deel-rules-')), 'x'), '', 'utf8');
  const fs = await import('node:fs');
  fs.mkdirSync(방, { recursive: true });
  fs.writeFileSync(join(방, 'DEEL.md'), '우리 문서는 CP949 로 읽는다. 절대 UTF-8 로 덮어쓰지 마라.', 'utf8');

  언어정하기('en');
  const p = new Session(conn(), { root: 방, work: 'code' }).systemPrompt();
  check('규칙 파일 내용은 그대로 실린다', p.includes('우리 문서는 CP949 로 읽는다'), '');
  check('소개 머리말만 영어다', /user rules — these win over/.test(p), '');
  check('한국어에서는 한국어 머리말', (() => {
    언어정하기('ko');
    return /사용자 규칙, 위 원칙보다 우선/.test(new Session(conn(), { root: 방, work: 'code' }).systemPrompt());
  })(), '');
}

언어정하기(원래);
rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n모델이 읽는 글 검사  ${D}(옮기면서 규칙이 새지 않았는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log('');
for (const l of 적어둘것) console.log(`  ${D}· ${l}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

// 영어로 시키고 한국어로 받기 (/lang ko en).
//
// ── 왜 갈랐나 ───────────────────────────────────────────────────────────
//
// 여태 말이 하나였다. `/lang en` 을 켜면 화면도, 모델에게 주는 글도, 모델이
// 답하는 말도 한꺼번에 영어가 됐다. 그래서 「영어로 시키고 한국어로 받기」 가
// 아예 안 됐는데, 그게 실제로 쓸모가 있다:
//
//   · 값이 눅다. 한글은 글자당 약 1토큰, 영문은 약 3.6자당 1토큰이다.
//     8k 창에서 고정 몫이 눈에 띄게 준다.
//   · 작은 모델이 영어 지시를 더 잘 따른다. 학습에 그쪽이 훨씬 많았다.
//
// 그런데 **읽는 사람은 한국 사람**이다.
//
// ── 여기서 무엇을 지키나 ────────────────────────────────────────────────
//
//   1. 시키는 글이 정말 영어로 가는가. 안 가면 아낀 토큰이 없다.
//   2. **답은 한국어로 오라고 못 박았는가.** 이게 제일 중요하다 — 안 박으면
//      영어 규칙 안의 "Answer the user in English" 가 그대로 먹어서, 한국
//      사람이 영어 답을 받는다. 값을 아끼려다 못 읽는 답을 받는 셈이다.
//   3. 화면 말은 **안 바뀌는가.** 갈랐다면서 화면까지 영어가 되면 안 가른 것이다.
//   4. 안 고른 사람에게는 아무것도 안 바뀌는가.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session, estimateTokens } from '../src/agent/session.js';
import { 말, 언어, 언어정하기, 지시말, 지시말정하기, 지시말따로정했나 } from '../src/i18n/index.js';
import { 말 as 모드말, 보일이름 } from '../src/agent/modes.js';
import { toolSchemas } from '../src/tools/index.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-promptlang-'));
const 새것 = (ctx = 32768) =>
  new Session({ kind: 'openai', base: 'http://127.0.0.1:1/v1', model: '스텁', ctx }, { root });

const 원래말 = 언어();

trace('1-안-고르면-그대로');

/*
 * 여태 쓰던 사람에게 아무것도 안 바뀌어야 한다. 새 축을 넣으면서 기본값이
 * 슬쩍 바뀌면, 안 건드린 사람의 화면이 어느 날 달라진다.
 */
{
  언어정하기('ko');
  지시말정하기('auto');
  check('따로 안 정하면 화면 말을 따른다', 지시말() === 'ko');
  check('따로 정했나가 false 다', 지시말따로정했나() === false);

  언어정하기('en');
  check('화면을 영어로 바꾸면 시키는 말도 영어', 지시말() === 'en');
  언어정하기('ko');
}

trace('2-갈랐을때');

{
  언어정하기('ko');
  지시말정하기('en');

  check('시키는 말만 영어가 된다', 지시말() === 'en' && 언어() === 'ko');
  check('따로 정한 것으로 잡힌다', 지시말따로정했나() === true);

  const 규칙 = 새것().systemPrompt();
  check('규칙 글이 영어로 간다', /You are deel/.test(규칙), 규칙.split('\n')[0]);

  /*
   * 여기가 핵심이다. 영어 규칙에는 "Answer the user in English" 가 박혀
   * 있으므로, 다시 못 박지 않으면 한국 사람이 영어 답을 받는다.
   */
  check('답은 한국어로 하라고 못 박는다', /답은 한국어로 해라/.test(규칙),
    규칙.split('\n').filter((l) => /한국어/.test(l)).join(' | ').slice(0, 90) || '(그 줄이 없다)');

  /*
   * 모드 설명도 모델이 읽는 글이다. 여기가 한국어로 남으면 절반만 영어다.
   * 한글이 한 글자도 없어야 한다 — 낱말로 찾으면 모드마다 첫 문장이 달라서
   * 검사가 모드 이름에 매이고, 글을 다듬을 때마다 여기가 깨진다.
   */
  for (const 모드 of ['auto', 'code', 'plan', 'debug']) {
    check(`${모드} 모드 설명이 영어로 간다`, !/[가-힣]/.test(모드말(모드, 32768)),
      모드말(모드, 32768).split('\n')[0].slice(0, 60));
  }

  // 도구 설명도 마찬가지다 — 매 요청마다 나가는 값이라 여기가 제일 크다.
  const 도구 = toolSchemas(['Read'], { ctx: 131072 })[0];
  check('도구 설명도 영어로 간다', /Read a file|line numbers/i.test(도구.function.description),
    도구.function.description.slice(0, 60));

  // 화면 말은 그대로여야 한다. 갈랐다면서 화면까지 바뀌면 안 가른 것이다.
  check('화면 말은 한국어 그대로다', 보일이름('code') === '코드', 보일이름('code'));
  check('화면 글도 한국어 그대로다', /한국어/.test(말('lang.ko')) || 말('lang.ko') === '한국어',
    말('lang.ko'));
}

trace('3-정말-싸지나');

/*
 * 「값이 눅다」 가 이 기능을 넣은 이유의 절반이다. 정말 그런지 잰다 —
 * 안 그러면 이 기능은 복잡함만 늘린 셈이다.
 */
{
  언어정하기('ko');

  지시말정하기('auto');
  const 한국어로 = 새것(8192).breakdown().used;

  지시말정하기('en');
  const 영어로 = 새것(8192).breakdown().used;

  check('영어로 시키면 고정 몫이 준다', 영어로 < 한국어로,
    `한국어 ${한국어로} → 영어 ${영어로} (${한국어로 - 영어로}토큰 아낌)`);

  // 아끼는 양이 눈에 띄어야 값을 한다. 8k 창에서 5% 는 되어야 얘기가 된다.
  const 아낀비율 = (한국어로 - 영어로) / 한국어로;
  check('아끼는 양이 5% 는 넘는다', 아낀비율 > 0.05, `${Math.round(아낀비율 * 100)}% 아낌`);

  // 같은 글자를 세는 잣대가 실제로 그렇게 갈리는지도 한 번 본다.
  check('한글이 영문보다 글자당 비싸다',
    estimateTokens('가나다라마바사') > estimateTokens('abcdefg'),
    `${estimateTokens('가나다라마바사')} vs ${estimateTokens('abcdefg')}`);
}

trace('4-반대쪽도-되나');

/*
 * 영어 화면 + 한국어 지시. 쓸 사람은 드물지만, 한쪽만 되면 그건 축이 아니라
 * 특례다. 특례는 다음에 고칠 때 반드시 잊힌다.
 */
{
  언어정하기('en');
  지시말정하기('ko');
  const 규칙 = 새것().systemPrompt();
  check('시키는 글이 한국어로 간다', /너는 deel 다/.test(규칙), 규칙.split('\n')[0]);
  check('답은 영어로 하라고 못 박는다', /Answer in English/.test(규칙),
    규칙.split('\n').filter((l) => /English/.test(l)).slice(-1)[0]?.slice(0, 80) ?? '(없다)');
}

trace('5-모르는-값');

{
  언어정하기('ko');
  지시말정하기('en');
  check('모르는 값은 안 받는다', 지시말정하기('클링온') === false);
  check('거절했으면 앞의 것이 그대로다', 지시말() === 'en');
  check('auto 로 되돌릴 수 있다', 지시말정하기('auto') === true && 지시말따로정했나() === false);
}

trace('6-끝');

언어정하기(원래말);
지시말정하기('auto');
rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n시키는 말 · 보는 말  ${D}(영어로 시키고 한국어로 받기)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

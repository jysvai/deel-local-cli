// 사람에게 되묻기 (Ask 도구).
//
// ── 왜 이게 있어야 하나 ─────────────────────────────────────────────────
//
// 없을 때 실제로 이런 일이 났다. 큰 폴더를 "역할에 맞게 구조 바꿔 줘" 라고
// 시켰더니, 모델이 파일을 스무 개쯤 읽고 나서 대화창에 이렇게 적고 멈췄다:
//
//   "수행할 구체적인 작업 요청이 없습니다. 원하는 변경 사항을 알려주세요."
//
// 요청은 있었다(컨텍스트에도 그대로 있었다 — 접기·줄이기 둘 다 맨 처음 요청을
// 남긴다). 모델이 **어떻게 물어야 할지 몰랐던** 것이다. 물어볼 길이 없으니
// 글로 적고 턴을 끝냈고, 사람은 아무것도 안 된 화면을 봤다.
//
// ── 여기서 무엇을 지키나 ────────────────────────────────────────────────
//
//   1. 물음이 **화면에 뜨고**, 사람 답이 **도구 결과로 돌아가** 하던 자리에서
//      이어지는가. 이게 깨지면 글로 묻는 것과 다를 바가 없다.
//   2. 숫자로 고르면 **그 줄의 글**이 가는가. 모델에게 "2" 만 가면 무엇을
//      고른 것인지 모른다.
//   3. 물어볼 자리가 없는 데서(한 방 실행·하위 작업) **안 막히는가.**
//      거기서 답을 기다리며 서면 그 실행은 영영 안 끝난다.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { TOOLS } from '../src/tools/index.js';
import { allow, MODES } from '../src/agent/modes.js';
import { Session } from '../src/agent/session.js';
import { 언어, 언어정하기 } from '../src/i18n/index.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 벗기기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const 뿌리 = dirname(dirname(fileURLToPath(import.meta.url)));

trace('1-도구가-있나');

// ── 어느 모드에서나 물을 수 있어야 한다 ────────────────────────────────
//
// 갈림길은 모드를 안 가리고 생긴다. 계획 모드에서 "A 로 갈까요 B 로 갈까요"
// 를 못 물으면, 계획을 세우다 말고 글로 묻고 턴이 끝난다.
{
  check('Ask 도구가 있다', !!TOOLS.Ask);
  check('question 이 필수다', TOOLS.Ask?.schema?.parameters?.required?.includes('question'));
  check('options 를 받는다', !!TOOLS.Ask?.schema?.parameters?.properties?.options);

  const 있는것 = Object.keys(TOOLS);
  const 없는모드 = Object.keys(MODES).filter((id) => !allow(id, 있는것).includes('Ask'));
  check('모든 모드에서 물을 수 있다', 없는모드.length === 0, 없는모드.join(', '));
}

trace('1.5-규칙이-Ask-를-일러주나');

/*
 * ── 도구만 있으면 안 쓴다 ───────────────────────────────────────────────
 *
 * 기본 규칙에는 "되묻는 것은 도구로도 못 알아낼 때뿐" 이라고 못 박혀 있다.
 * 맞는 말이지만 **나머지 반쪽이 없었다** — 정말 물어야 할 때 어떻게 물으라는
 * 말이 없으니, 모델은 글로 적고 턴을 끝내는 쪽으로 갔다. 그게 이 도구를
 * 만들게 한 그 증상이다.
 *
 * 네 판 모두에 있어야 한다. 한 판이라도 빠지면 그 창 크기·그 언어로 쓰는
 * 사람만 예전 그대로다 — 도구는 실려 있는데 아무도 안 부르는 상태.
 */
{
  const 원래 = 언어();
  const 규칙 = (ctx, lang) => {
    언어정하기(lang);
    return new Session({ kind: 'openai', base: 'http://127.0.0.1:1/v1', model: 'x', ctx }, { root: 뿌리 })
      .systemPrompt();
  };
  try {
    check('긴 한국어 규칙이 Ask 로 물으라 한다', /Ask 도구로 묻는다/.test(규칙(128000, 'ko')));
    check('짧은 한국어 규칙에도 있다', /Ask 도구로 묻는다/.test(규칙(8000, 'ko')));
    check('긴 영어 규칙이 Ask 로 물으라 한다', /the Ask tool/.test(규칙(128000, 'en')));
    check('짧은 영어 규칙에도 있다', /the Ask tool/.test(규칙(8000, 'en')));
  } finally {
    언어정하기(원래);
  }
}

trace('2-물을-자리가-없을때');

/*
 * ── 여기서 막히면 안 된다 ───────────────────────────────────────────────
 *
 * `deel -p` 한 방 실행, 파이프, 하위 작업에는 사람이 없다. 그런데도 답을
 * 기다리면 그 실행은 **영영 안 끝난다.** 안 끝나는 것은 틀린 답보다 나쁘다 —
 * 틀린 답은 보고 고치기라도 한다.
 */
{
  const r = await TOOLS.Ask.run({ question: '어느 쪽으로 갈까요?' }, { scope: { root: 뿌리 } });
  // 결과는 반드시 content 다 — loop.js 가 대화에 싣는 것이 그것 하나뿐이라,
  // 다른 이름으로 돌려주면 화면에는 뜨는데 모델에게는 빈 글이 간다.
  check('물을 데가 없어도 content 로 돌려준다', typeof r?.content === 'string' && !!r.content,
    JSON.stringify(r).slice(0, 80));
  check('스스로 판단하라고 알려 준다', /진행/.test(r?.content ?? ''));
  check('안 막히고 바로 돌아온다', !r?.error);

  const 빈것 = await TOOLS.Ask.run({ question: '   ' }, { scope: { root: 뿌리 } });
  check('빈 물음은 거절한다', !!빈것.error, JSON.stringify(빈것));
}

trace('3-진짜로-왕복하나');

/*
 * ── 값이 아니라 **왕복**을 잰다 ─────────────────────────────────────────
 *
 * 도구가 있고 모드에 실렸다는 것만으로는 아무것도 증명이 안 된다. 이 파일이
 * 잡으려는 결함은 "물었는데 답이 안 돌아온다" 이고, 그건 진짜 deel 을 띄워
 * 사람처럼 답해 봐야만 잡힌다.
 */
{
  let 도구번호 = 1;
  let 받은답 = null;

  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let json = null;
      try { json = JSON.parse(body || '{}'); } catch { /* 스텁이라 넘어간다 */ }
      const 보냄 = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (String(req.url).endsWith('/models')) return 보냄({ data: [{ id: '스텁모델', object: 'model' }] });

      const 답 = (msg, why) => 보냄({
        id: 'x', object: 'chat.completion', model: '스텁모델',
        choices: [{ index: 0, finish_reason: why ?? (msg.tool_calls ? 'tool_calls' : 'stop'), message: msg }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const 메시지들 = json?.messages ?? [];
      const 마지막 = 메시지들[메시지들.length - 1];

      // 물어본 결과가 돌아왔다. 무엇이 담겨 왔는지 붙잡아 둔다.
      if (마지막?.role === 'tool') {
        받은답 = String(마지막.content ?? '');
        return 답({ role: 'assistant', content: `고른 것: ${받은답}` });
      }

      // 첫 턴 — 되묻는다.
      return 답({
        role: 'assistant', content: null,
        tool_calls: [{
          id: `c${도구번호++}`, type: 'function',
          function: {
            name: 'Ask',
            arguments: JSON.stringify({
              question: '구조를 어디까지 바꿀까요?',
              options: ['표준 패키지 구조로 전부 재배치', '파일 이동은 최소화하고 .env.example 만 추가'],
            }),
          },
        }],
      });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const 주소 = `http://127.0.0.1:${srv.address().port}/v1`;

  const root = mkdtempSync(join(tmpdir(), 'deel-ask-'));
  const home = mkdtempSync(join(tmpdir(), 'deel-ask-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [{
      id: 'stub', name: '스텁', kind: 'openai', baseUrl: 주소,
      auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: false, tools: true,
    }],
  }), 'utf8');

  const kid = spawn(process.execPath,
    [join(뿌리, 'bin', 'deel.js'), '--root', root, '--offline', '--ctx', '32768', '--no-tui'],
    { cwd: 뿌리, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DEEL_HOME: home } });

  let out = '';
  kid.stdout.on('data', (b) => { out += b; });
  kid.stderr.on('data', (b) => { out += b; });
  let 끝남 = false;
  const 닫힘 = new Promise((r) => kid.on('close', () => { 끝남 = true; r(); }));
  const 자기 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 치기 = async (l, ms = 1000) => {
    await 자기(ms);
    if (!끝남) { try { kid.stdin.write(`${l}\n`); } catch { /* 이미 닫혔다 */ } }
  };

  await 치기('구조 좀 바꿔줘', 900);
  await 치기('2', 1600);          // 둘째 것을 숫자로 고른다
  await 치기('/exit', 1400);
  await Promise.race([닫힘, 자기(7000).then(() => kid.kill())]);
  srv.close();

  const 화면 = 벗기기(out);
  check('물음이 화면에 뜬다', /구조를 어디까지 바꿀까요/.test(화면),
    화면.split('\n').find((l) => /어디까지/.test(l))?.trim().slice(0, 60) ?? '못 찾음');
  check('고를 것이 번호로 뜬다', /1 표준 패키지 구조로 전부 재배치/.test(화면));
  check('둘째 것도 뜬다', /2 파일 이동은 최소화/.test(화면));

  /*
   * 여기가 핵심이다. "2" 라고 쳤는데 모델에게 "2" 가 가면 안 된다 —
   * 무엇을 고른 것인지 모른다. 그 줄의 **글**이 가야 한다.
   */
  check('숫자로 골라도 그 줄의 글이 모델에게 간다',
    !!받은답 && 받은답.includes('파일 이동은 최소화'), (받은답 ?? '(안 옴)').slice(0, 90));
  check('고른 것을 화면에도 남긴다', /▶.*파일 이동은 최소화/.test(화면));
  check('답을 받고 대화가 이어진다', /고른 것:/.test(화면),
    화면.split('\n').find((l) => /고른 것:/.test(l))?.trim().slice(0, 60) ?? '안 이어졌다');

  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

trace('4-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n되묻기 검사  ${D}(물었는데 답이 돌아와 이어지는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

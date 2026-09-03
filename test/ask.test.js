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
import { 언어, 언어정하기, 말 } from '../src/i18n/index.js';
import { 고른것풀기, 계획답풀기 } from '../src/ui/pick.js';
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
              // 이해를 빼면 관문(agent/askcheck.js)이 막는다 — 그게 규칙이다.
              이해: '이 저장소를 배포할 수 있게 정리하라는 것으로 이해했습니다',
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

trace('3.6-번호와-의견을-같이');

/*
 * ── 「번호만 말고, 의견도 같이」 ────────────────────────────────────────
 *
 * 사람 말: 「사용자에게 계획 물어볼 때 번호만 입력하는 게 아니라, 번호를
 * 고르고 의견이 있으면 의견도 입력할 수 있게」.
 *
 * 여태는 둘 중 하나였다. 숫자만 치면 고른 것이고, 그 밖의 글은 **고른 것
 * 없이** 통째로 자유 답이었다. 그래서 「2 파일은 나눠서」 라고 치면 2번을
 * 골랐다는 사실이 사라진다. 사람은 골랐다고 생각하는데 모델에게는 고른
 * 것이 없는 문장 하나만 간다.
 *
 * 가르는 자리는 ui/pick.js 하나다. 여기서 그 자리를 낱낱이 잰다 — 상자를
 * 띄우는 검사(아래)는 오래 걸려서 모든 모양을 다 밟을 수가 없다.
 */
{
  const 목록 = ['표준 구조로 전부 재배치', '최소한만 옮기기', '손 안 대기'];
  const 재기 = (답) => 고른것풀기(답, 목록);

  check('숫자만 치면 여태와 같다', 재기('2').글 === '최소한만 옮기기', 재기('2').글);
  check('★ 번호 뒤에 말을 붙이면 둘 다 간다',
    재기('2 파일은 나눠서').글 === '최소한만 옮기기 — 파일은 나눠서', 재기('2 파일은 나눠서').글);
  for (const [모양, 답] of [[':', '2: 나눠서'], [',', '2, 나눠서'], ['-', '2 - 나눠서'], ['.', '2. 나눠서']]) {
    check(`${모양} 로 갈라 써도 읽는다`, 재기(답).글 === '최소한만 옮기기 — 나눠서', `${답} → ${재기(답).글}`);
  }
  check('★ 여럿 고르면 여럿 간다 (1,3)',
    재기('1,3').글 === '표준 구조로 전부 재배치 · 손 안 대기', 재기('1,3').글);
  check('빈칸으로 갈라도 여럿이다 (1 3)',
    재기('1 3').글 === '표준 구조로 전부 재배치 · 손 안 대기', 재기('1 3').글);
  check('여럿 고르고 말도 붙인다',
    재기('1 3 순서는 반대로').글 === '표준 구조로 전부 재배치 · 손 안 대기 — 순서는 반대로',
    재기('1 3 순서는 반대로').글);
  check('같은 번호를 두 번 쳐도 한 번만 센다', 재기('2 2').번호들.length === 1, 재기('2 2').번호들.join('+'));

  /*
   * ★ 여기가 제일 조심할 자리다.
   *
   * 「3개만 해줘」 는 3번을 고른 것이 아니다. 수 뒤에 글자가 바로 붙어 있으면
   * 수로 안 읽는다. 이 선이 없으면 사람이 고른 적 없는 것을 골랐다고 하게
   * 되는데, 그건 안 받느니만 못하다.
   */
  check('★ 「3개만 해줘」 는 고른 것이 아니다', 재기('3개만 해줘').글 === '3개만 해줘',
    `번호 ${재기('3개만 해줘').번호들.join('+') || '없음'}`);
  check('★ 목록에 없는 수는 고른 것이 아니다', 재기('5 기다려').글 === '5 기다려',
    `번호 ${재기('5 기다려').번호들.join('+') || '없음'}`);
  check('그냥 글은 그냥 글이다', 재기('전혀 다른 답').글 === '전혀 다른 답');
  check('빈 답은 빈 답이다', 재기('').글 === '');
  check('선택지가 없으면 숫자도 그냥 글이다', 고른것풀기('2', []).글 === '2', 고른것풀기('2', []).글);
}

trace('3.7-계획-상자의-답');

/*
 * ── 계획 상자도 같은 말을 받는다 ────────────────────────────────────────
 *
 * 여태 계획 상자는 셋 중 하나였다. ⏎ 면 진행, n 이면 그만, 그 밖의 글은
 * 통째로 「이걸 고쳐서 다시 내라」. 그래서 「그대로 하되 검사도 넣어줘」 라고
 * 치면 계획을 다시 짜러 갔다 — 사람은 진행하라고 한 것인데.
 */
{
  const 재기 = (답) => 계획답풀기(답, 4);

  check('⏎ 하나면 그대로 진행이다', 재기('').갈래 === '진행', JSON.stringify(재기('')));
  check('y 도 진행이다', 재기('y').갈래 === '진행');
  check('n 은 그만이다', 재기('n').갈래 === '그만');
  check('★ y 뒤에 말을 붙이면 그 말을 얹고 진행이다',
    재기('y 검사도 같이 넣어줘').갈래 === '진행' && 재기('y 검사도 같이 넣어줘').덧말 === '검사도 같이 넣어줘',
    JSON.stringify(재기('y 검사도 같이 넣어줘')));
  check('★ 단계 번호를 대면 그 단계에 대고 하는 말이다',
    재기('3 이건 빼자').갈래 === '다시' && 재기('3 이건 빼자').단계 === 3
      && 재기('3 이건 빼자').덧말 === '이건 빼자', JSON.stringify(재기('3 이건 빼자')));
  check('그 밖의 글은 여태 그대로 「다시 짜라」 다',
    재기('테스트부터 짜자').갈래 === '다시' && 재기('테스트부터 짜자').단계 === null,
    JSON.stringify(재기('테스트부터 짜자')));
  // 없는 단계 번호는 단계가 아니라 그냥 하는 말이다.
  check('없는 단계 번호는 단계로 안 읽는다', 재기('9 이것도').단계 === null, JSON.stringify(재기('9 이것도')));
  // 번호만 치고 아무 말도 안 하면 무엇을 하라는 건지 알 수 없다. 여태 뜻대로 둔다.
  check('번호만 치면 단계 지목이 아니다', 재기('3').단계 === null, JSON.stringify(재기('3')));
}

trace('3.8-안내가-말표를-거치나');

/*
 * 이 두 줄은 **무엇을 치면 되나** 를 말하는 줄이다. 못 읽으면 그 자리에서
 * 막힌다. 계획 상자 쪽은 여태 한국어가 글자 그대로 박혀 있었다.
 */
{
  const 본말 = 언어();
  const 모으기 = () => ({
    고르기: 말('ask.pickHint'),
    계획: 말('plan.hint'),
    물음: 말('plan.ask'),
  });
  언어정하기('ko');
  const 한 = 모으기();
  언어정하기('en');
  const 영 = 모으기();
  언어정하기('ja');
  const 일 = 모으기();
  언어정하기('zh');
  const 중 = 모으기();
  언어정하기(본말);

  check('★ 고르기 안내가 「번호 + 한마디」 를 알려 준다', /2 /.test(한.고르기), 한.고르기);
  check('★ 고르기 안내가 영어로도 나온다', 영.고르기 !== 한.고르기 && !/[가-힣]/.test(영.고르기), 영.고르기);
  check('일본어·중국어도 제 말이다', !/[가-힣]/.test(일.고르기) && !/[가-힣]/.test(중.고르기),
    `${일.고르기} | ${중.고르기}`);

  check('★ 계획 상자 안내에 네 갈래가 다 보인다',
    /⏎/.test(한.계획) && /y/.test(한.계획) && /3/.test(한.계획) && /n/.test(한.계획), 한.계획);
  check('★ 계획 상자 안내가 영어로도 나온다', !/[가-힣]/.test(영.계획) && 영.계획 !== 한.계획, 영.계획);
  check('★ 계획 상자 물음도 영어로 나온다', !/[가-힣]/.test(영.물음), 영.물음);
  check('일본어·중국어 계획 안내도 제 말이다', !/[가-힣]/.test(일.계획) && !/[가-힣]/.test(중.계획),
    `${일.계획} | ${중.계획}`);
}

trace('3.5-물어보는-도중에-ESC');

/*
 * ── 물음이 떠 있을 때 ESC 를 누르면 ─────────────────────────────────────
 *
 * 「ESC 를 눌러도 아직 작업이 안 멈춘다」 의 한 갈래가 여기였다. 도구가
 * 「실행할까요?」 나 Ask 상자를 띄우고 사람 답을 기다리는 동안, repl 은
 * `nextLine()` 에 통째로 걸려 있었다. ESC 는 turn 을 끊지만 이 자리는 그
 * 신호를 아예 안 보고 있어서, 화면은 물음을 그대로 들고 서 있는다.
 * 사람 눈에는 ESC 가 고장 난 것이고, 그래서 Ctrl+C 로 손이 간다 —
 * 두 번 누르면 대화가 통째로 닫힌다.
 *
 * 파이프로는 ESC 를 못 보낸다(키 가로채기가 터미널일 때만 걸린다).
 * 그래서 tty-preload.mjs 로 터미널인 척하고 진짜 바이트 `\x1b` 를 흘린다 —
 * pastechip.test.js 와 같은 방법이다.
 */
{
  let 물었나 = false;
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
      if (메시지들[메시지들.length - 1]?.role === 'tool') {
        return 답({ role: 'assistant', content: '알겠습니다.' });
      }
      물었나 = true;
      return 답({
        role: 'assistant', content: null,
        tool_calls: [{
          id: 'c1', type: 'function',
          function: {
            name: 'Ask',
            arguments: JSON.stringify({
              이해: '배포 전에 구조를 정리하라는 것으로 이해했습니다',
              question: '구조를 어디까지 바꿀까요?',
              options: ['전부 재배치', '최소한만'],
            }),
          },
        }],
      });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const 주소 = `http://127.0.0.1:${srv.address().port}/v1`;

  const root = mkdtempSync(join(tmpdir(), 'deel-askesc-'));
  const home = mkdtempSync(join(tmpdir(), 'deel-askesc-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [{
      id: 'stub', name: '스텁', kind: 'openai', baseUrl: 주소,
      auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: false, tools: true,
    }],
  }), 'utf8');

  // CI 가 켜져 있으면 상자를 안 쓴다(screen.js 의 상자쓸까). 키 가로채기도 같이 꺼진다.
  const { CI, ...환경 } = process.env;
  const 앞선것 = join(뿌리, 'test', 'tty-preload.mjs').replace(/\\/g, '/');
  const kid = spawn(process.execPath,
    ['--import', `file:///${앞선것}`, join(뿌리, 'bin', 'deel.js'),
      '--root', root, '--offline', '--ctx', '32768'],
    { cwd: 뿌리, stdio: ['pipe', 'pipe', 'pipe'], env: { ...환경, DEEL_HOME: home } });

  let out = '';
  kid.stdout.setEncoding('utf8');
  kid.stderr.setEncoding('utf8');
  kid.stdout.on('data', (b) => { out += b; });
  kid.stderr.on('data', (b) => { out += b; });
  let 끝남 = false;
  const 닫힘 = new Promise((r) => kid.on('close', () => { 끝남 = true; r(); }));
  const 자기 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 민화면 = () => out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  const 기다리기 = async (될때까지, 최대 = 20000) => {
    const 끝 = Date.now() + 최대;
    while (Date.now() < 끝 && !끝남) {
      if (될때까지()) return true;
      await 자기(40);
    }
    return false;
  };

  await 기다리기(() => 민화면().includes('❯'));
  kid.stdin.write('구조 좀 바꿔줘\n');
  // 물음 상자가 실제로 화면에 뜰 때까지 기다린다 — 뜨기 전에 ESC 를 누르면
  // 무엇을 잰 것인지 알 수 없다.
  const 물음떴나 = await 기다리기(() => /구조를 어디까지 바꿀까요/.test(민화면()));

  const 누른때 = Date.now();
  kid.stdin.write('\x1b');
  const 풀렸나 = await 기다리기(() => /멈췄습니다|중단됨/.test(민화면().slice(민화면().indexOf('구조를 어디까지 바꿀까요'))), 5000);
  const 걸린시간 = Date.now() - 누른때;

  // 멈춘 **뒤에도** 다음 말을 받는가. 못 받으면 대화가 죽은 것이다.
  const 멈춘뒤자리 = 민화면().length;
  kid.stdin.write('/help\n');
  const 이어지나 = await 기다리기(() => /명령|commands/i.test(민화면().slice(멈춘뒤자리)), 8000);

  if (!끝남) { try { kid.stdin.write('/exit\n'); } catch { /* 이미 닫혔다 */ } }
  await Promise.race([닫힘, 자기(6000).then(() => kid.kill())]);
  srv.close();

  const 화면 = 민화면();
  check('물음 상자가 떴다 (여기서부터 재는 것이다)', 물음떴나 && 물었나,
    물음떴나 ? '' : 화면.slice(-200));
  /*
   * ★ 이 파일의 핵심. 예전에는 여기서 영영 안 풀렸다 — 5초를 기다려도
   * 화면이 물음 그대로였다. 지금은 ESC 한 번에 그 자리에서 풀린다.
   */
  check('★ 물음이 떠 있어도 ESC 한 번에 풀린다', 풀렸나,
    풀렸나 ? `${걸린시간}ms` : `5000ms 를 기다려도 안 풀렸다: ${화면.slice(-200)}`);
  check('★ 멈췄다고 화면에 적는다', /멈췄습니다/.test(화면),
    화면.split('\n').find((l) => /멈췄습니다/.test(l))?.trim().slice(0, 60) ?? '못 찾음');
  check('★ 멈춘 뒤에도 다음 말을 받는다', 이어지나,
    이어지나 ? '' : '멈추고 나서 입력이 안 돌아왔다');

  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

trace('3.9-번호와-의견을-진짜-상자에서');

/*
 * ── 가르는 함수만 잰 것으로는 모자란다 ─────────────────────────────────
 *
 * 위(3.6)에서 잰 것은 「글자를 어떻게 가르나」 다. 여기서 재는 것은
 * **그 가른 것이 모델까지 가나** 이다. 상자에서 받아 놓고 중간에서 흘리면
 * 사람은 의견을 말했는데 모델은 못 들은 것이 된다 — 그게 여태 났던 일이다.
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
      if (!String(req.url).includes('/chat/completions')) return 보냄({ data: [{ id: '스텁모델', object: 'model' }] });

      const 답 = (msg, why) => 보냄({
        id: 'x', object: 'chat.completion', model: '스텁모델',
        choices: [{ index: 0, finish_reason: why ?? (msg.tool_calls ? 'tool_calls' : 'stop'), message: msg }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const 메시지들 = json?.messages ?? [];
      const 마지막 = 메시지들[메시지들.length - 1];
      if (마지막?.role === 'tool') {
        받은답 = String(마지막.content ?? '');
        return 답({ role: 'assistant', content: '알겠습니다.' });
      }
      return 답({
        role: 'assistant', content: null,
        tool_calls: [{
          id: `c${도구번호++}`, type: 'function',
          function: {
            name: 'Ask',
            arguments: JSON.stringify({
              이해: '이 저장소를 배포할 수 있게 정리하라는 것으로 이해했습니다',
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

  const root = mkdtempSync(join(tmpdir(), 'deel-asknote-'));
  const home = mkdtempSync(join(tmpdir(), 'deel-asknote-home-'));
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
  // 골라 놓고 조건을 하나 붙인다 — 여태는 이렇게 치면 고른 것이 사라졌다.
  await 치기('2 다만 .env 는 건드리지 마', 1600);
  await 치기('/exit', 1400);
  await Promise.race([닫힘, 자기(7000).then(() => kid.kill())]);
  srv.close();

  const 화면 = 벗기기(out);
  check('★ 고른 줄의 글이 모델에게 간다',
    !!받은답 && 받은답.includes('파일 이동은 최소화'), (받은답 ?? '(안 옴)').slice(0, 110));
  check('★ 덧붙인 말도 같이 간다',
    !!받은답 && 받은답.includes('.env 는 건드리지 마'), (받은답 ?? '(안 옴)').slice(0, 110));
  check('★ 숫자는 답에 안 남는다 (「2」 만 가면 무엇을 고른지 모른다)',
    !!받은답 && !/사람의 답: 2\b/.test(받은답), (받은답 ?? '(안 옴)').slice(0, 110));
  check('★ 되비추는 줄에도 둘 다 보인다',
    /▶.*파일 이동은 최소화.*건드리지 마/.test(화면),
    화면.split('\n').find((l) => /▶/.test(l))?.trim().slice(0, 100) ?? '못 찾음');

  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

trace('3.95-계획-상자에-한마디-얹기');

/*
 * ── 「그대로 하되 이것도」 가 갈 데가 없었다 ────────────────────────────
 *
 * 계획 상자에서 「y 검사도 넣어줘」 라고 치면 여태는 **계획을 다시 짜러**
 * 갔다. 사람은 진행하라고 한 것인데 한 바퀴를 더 돈다. 몇 분짜리 계획이면
 * 그 몇 분을 다시 기다린다.
 *
 * 진짜 deel 을 띄워서, 상자를 띄우고, 한마디를 얹어 승인해 본다.
 */
{
  let 도구번호 = 1;
  const 나간것 = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let json = null;
      try { json = JSON.parse(body || '{}'); } catch { /* 스텁이라 넘어간다 */ }
      const 보냄 = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (!String(req.url).includes('/chat/completions')) return 보냄({ data: [{ id: '스텁모델', object: 'model' }] });

      const 답 = (msg, why) => 보냄({
        id: 'x', object: 'chat.completion', model: '스텁모델',
        choices: [{ index: 0, finish_reason: why ?? (msg.tool_calls ? 'tool_calls' : 'stop'), message: msg }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const 메시지들 = json?.messages ?? [];
      const 마지막 = 메시지들[메시지들.length - 1];
      const 사람말 = [...메시지들].reverse().find((m) => m.role === 'user');
      if (사람말) 나간것.push(String(사람말.content ?? ''));

      // 계획을 todo 로 낸 뒤 말로 맺는다 — 그래야 계획 상자가 뜬다.
      if (마지막?.role === 'tool') return 답({ role: 'assistant', content: '계획은 위와 같습니다.' });
      if (도구번호 === 1) {
        return 답({
          role: 'assistant', content: null,
          tool_calls: [{
            id: `c${도구번호++}`, type: 'function',
            function: {
              name: 'TodoWrite',
              arguments: JSON.stringify({
                todos: [
                  { text: '설정 파일 자리 잡기', state: 'pending' },
                  { text: '읽는 코드 옮기기', state: 'pending' },
                  { text: '문서 손보기', state: 'pending' },
                ],
              }),
            },
          }],
        });
      }
      return 답({ role: 'assistant', content: '다 했습니다.' });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const 주소 = `http://127.0.0.1:${srv.address().port}/v1`;

  const root = mkdtempSync(join(tmpdir(), 'deel-plan-'));
  const home = mkdtempSync(join(tmpdir(), 'deel-plan-home-'));
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
  const 민것 = () => 벗기기(out);
  const 기다리기 = async (될때까지, 최대 = 25000) => {
    const 끝 = Date.now() + 최대;
    while (Date.now() < 끝 && !끝남) {
      if (될때까지()) return true;
      await 자기(50);
    }
    return false;
  };

  await 기다리기(() => 민것().includes('❯'), 15000);
  kid.stdin.write('계획 세우고 만들어줘\n');
  const 상자떴나 = await 기다리기(() => /이대로 진행할까요|Go ahead with this/.test(민것()));
  // 승인하되 한마디를 얹는다.
  if (!끝남) kid.stdin.write('y 검사도 같이 넣어줘\n');
  const 이어졌나 = await 기다리기(() => 나간것.some((t) => /사람이 승인하며 덧붙인 말/.test(t)), 20000);
  if (!끝남) { try { kid.stdin.write('/exit\n'); } catch { /* 이미 닫혔다 */ } }
  await Promise.race([닫힘, 자기(8000).then(() => kid.kill())]);
  srv.close();

  const 화면 = 민것();
  check('먼저: 계획 상자가 떴다 (여기서부터 재는 것이다)', 상자떴나,
    화면.split('\n').filter((l) => /계획|진행할까요/.test(l)).slice(-2).join(' | ').slice(0, 120));
  check('★ 상자가 네 갈래를 다 알려 준다',
    /⏎ 진행/.test(화면) && /y 한마디/.test(화면) && /n 취소/.test(화면),
    화면.split('\n').find((l) => /진행할까요/.test(l))?.trim().slice(0, 110) ?? '못 찾음');
  check('★ 한마디를 얹어도 계획을 다시 안 짜고 진행한다',
    나간것.some((t) => /방금 낸 계획을 사람이 승인했다/.test(t)),
    나간것.map((t) => t.slice(0, 30)).join(' | ').slice(0, 140));
  check('★ 얹은 한마디가 모델에게 간다',
    이어졌나 && 나간것.some((t) => /검사도 같이 넣어줘/.test(t)),
    나간것.find((t) => /덧붙인 말/.test(t))?.slice(-60) ?? '(안 감)');
  check('★ 계획을 다시 내라고는 안 한다',
    !나간것.some((t) => /계획에서 이걸 고쳐서/.test(t)),
    나간것.find((t) => /고쳐서/.test(t))?.slice(0, 60) ?? '');
  check('★ 화면에도 한마디를 얹었다고 적는다', /한마디를 얹어 진행합니다/.test(화면),
    화면.split('\n').find((l) => /진행합니다/.test(l))?.trim().slice(0, 90) ?? '못 찾음');

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

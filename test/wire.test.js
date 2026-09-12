/**
 * 전선 카드 — 이 모델이 이 주소에서 **실제로 받는 것**.
 *
 * ── 왜 이 검사가 있나 ───────────────────────────────────────────────────
 *
 * 여기서 지키는 것은 전부 **눈에 안 보이는 자리**다. 틀려도 화면에는 아무
 * 표시가 없고, 대신 돈과 시간으로만 나타난다. 실제로 겪은 네 가지다.
 *
 *   1) `/think max` 를 쳤는데 전선에는 `high` 가 나갔다. 화면은 max 라고
 *      적혀 있으니 사람은 세게 생각시켰다고 믿는다. 아무 일도 안 일어난다.
 *
 *   2) Opus 5 에 `budget_tokens` 를 실었다. 그 모델은 그 칸을 400 으로
 *      거절한다. 열쇠가 멀쩡한데 400 이라, 화면에서는 인증 실패와 구별이
 *      안 된다.
 *
 *   3) 캐시 표식을 아무 데도 안 붙였다. 자동으로 잡아 주는 서버는 정적
 *      앞머리만 잡고, 안 잡아 주는 곳(Anthropic 직통)은 **하나도** 안 잡는다.
 *      대화가 길어질수록 매 턴 전부가 다시 나간다.
 *
 *   4) 세션 이름을 안 보냈다. 게이트웨이는 같은 대화를 이어 가는지 알 길이
 *      없어서 매번 새로 엮는다.
 *
 * 넷 다 조용하다. 조용한 고장은 검사가 없으면 다음 기능이 들어올 때 그냥
 * 다시 무너진다 — 무너져도 아무도 모르니까.
 *
 * ── 안 하는 것 ──────────────────────────────────────────────────────────
 *
 * 여기서는 **아무 데도 안 나간다.** 카드를 만들고, 몸을 만들고, 그 몸을
 * 들여다볼 뿐이다. 나가는 검사는 네트워크가 있어야 하고, 그건 이 검사가
 * 지키려는 것과 다른 것이다.
 */
import {
  눈금차례, 세대, 클로드인가, 추론형오픈AI, 기본카드, 눈금맞추기,
  배울전선, 카드고치기, 카드저장꼴, 카드합치기, 전선붙이기, 세션이름짓기, 전선말,
  카드칸들,
} from '../src/backend/wire.js';
import { 조각표, 메시지표식, 시스템블록, 잡힐만한가, 블록에붙이기, 닻문턱 } from '../src/backend/cachemark.js';
import { buildBody, 보낸토큰, 더할머리, chat } from '../src/backend/adapter.js';
import { createServer } from 'node:http';
import { allowEndpoint } from '../src/safety/network.js';
import { 자동강도, 인사인가, effortFor, 가벼운강도, 천장고르기, 무거운가 } from '../src/agent/effort.js';
import { 언어정하기, 말모두 } from '../src/i18n/index.js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 적어둘것 = [];

언어정하기('ko');

const 연결 = (base, kind, model) => ({ base, kind, model });

// ── 1. 모델 이름에서 세대를 읽는다 ──────────────────────────────────────
//
// 이 값 하나로 생각을 adaptive 로 켤지 budget_tokens 로 켤지가 갈린다.
// 틀리면 그 턴이 400 이다.
{
  const 봐야할것 = [
    ['claude-opus-5', 5],
    ['claude-fable-5-1', 5.1],
    ['claude-opus-4-8', 4.8],
    ['claude-opus-4-6', 4.6],
    ['claude-3-5-sonnet-20241022', 3.5],
    ['anthropic.claude-opus-5-v1:0', 5],
    ['us.anthropic.claude-opus-4-7-v1:0', 4.7],
  ];
  for (const [이름, 기대] of 봐야할것) {
    const v = 세대(이름);
    check(`세대: ${이름} → ${기대}`, v === 기대, String(v));
  }
  check('모르는 이름은 null 이다', 세대('mystery-model') === null, String(세대('mystery-model')));
  check('빈 이름도 안 죽는다', 세대('') === null && 세대(null) === null);

  check('클로드인가: claude 가 들어가면 참', 클로드인가('anthropic.claude-opus-5-v1:0') === true);
  check('클로드인가: 아니면 거짓', 클로드인가('gpt-5') === false);

  // gpt-4o 는 추론형이 아니다. 여기에 reasoning_effort 를 실으면 400 이다.
  check('추론형오픈AI: gpt-5 는 참', 추론형오픈AI('gpt-5') === true);
  check('추론형오픈AI: o3 는 참', 추론형오픈AI('o3-mini') === true);
  check('★ 추론형오픈AI: gpt-4o 는 거짓', 추론형오픈AI('gpt-4o') === false, '4o 에 실으면 400 이다');
  check('추론형오픈AI: gpt-4-turbo 는 거짓', 추론형오픈AI('gpt-4-turbo') === false);
  /*
   * ── 크기 표기를 세대로 읽으면 안 된다 ─────────────────────────────────
   *
   * `custom-gpt-50b-chat` 의 `50b` 는 판 번호가 아니라 **매개수**다. 뒤 경계가
   * 없으면 거기서 `gpt-5` 가 보인다며 추론형으로 읽고, 그 모델에
   * reasoning_effort 를 실어 보내 그 턴이 400 이 된다.
   *
   * 이 파일의 출력칸 갈래는 이미 뒤 경계를 갖고 있었다 — 한 파일 안 두 갈래가
   * 같은 이름을 두고 서로 다르게 판정하고 있었다(30차 리뷰). 그래서 **둘이
   * 같은 답을 내는지**까지 잰다.
   */
  for (const [이름, 바람] of [
    ['custom-gpt-50b-chat', false], ['gpt-50b', false], ['my-gpt-512-tune', false],
    ['gpt-5', true], ['gpt5', true], ['openai/gpt-5-mini', true], ['azure-gpt-6-preview', true],
    ['o3', true], ['llama-o1', true], ['my-o2b', false],
  ]) {
    check(`★★ 추론형오픈AI: ${이름} → ${바람}`, 추론형오픈AI(이름) === 바람, String(추론형오픈AI(이름)));
  }
  /*
   * ── 두 갈래가 같은 답을 내는가 ────────────────────────────────────────
   *
   * 「추론 시대 OpenAI 모델인가」 를 두 자리에서 따로 물으면 반드시 어긋난다.
   * 처음엔 세 이름만 재서 초록이었는데, 넓혀 보니 **세 자리가 어긋나 있었다**
   * (31차 리뷰) — `gpt5`·`gpt6` 는 한쪽만, `gpt-7` 은 다른 쪽만 참이었다.
   * 좁게 재고 초록을 보는 것이 안 재는 것보다 나쁘다. 그래서 넓게 잰다.
   */
  for (const 이름 of [
    'o1', 'o3', 'o4-mini', 'gpt-5', 'gpt5', 'gpt-6', 'gpt6', 'gpt-7', 'gpt-9',
    'gpt-4o', 'gpt-4-turbo', 'custom-gpt-50b-chat', 'claude-opus-5',
  ]) {
    const 새이름칸 = 기본카드({ kind: 'openai', model: 이름, base: 'https://api.openai.com/v1' }).출력칸 === '새것';
    check(`★★★ 추론형 판정과 출력칸 판정이 같은 답을 낸다 — ${이름}`,
      추론형오픈AI(이름) === 새이름칸, `추론형=${추론형오픈AI(이름)} 새이름칸=${새이름칸}`);
  }
}

// ── 2. 회사마다 받는 눈금이 다르다 ──────────────────────────────────────
//
// 없는 말을 실어 보내면 400 이고, 그 400 은 화면에서 열쇠가 틀린 것과
// 구별이 안 된다. 그래서 **있는 말 중 가장 가까운 아래쪽**으로 내린다.
{
  const 클로드 = 기본카드(연결('https://api.anthropic.com/v1', 'anthropic', 'claude-opus-5'));
  const 오픈AI = 기본카드(연결('https://api.openai.com/v1', 'openai', 'gpt-5'));
  const 제미나이 = 기본카드(연결('https://generativelanguage.googleapis.com/v1beta/openai', 'openai', 'gemini-3-pro'));

  check('Claude 는 xhigh 를 그대로 받는다', 눈금맞추기(클로드, 'xhigh') === 'xhigh', String(눈금맞추기(클로드, 'xhigh')));
  check('Claude 는 max 도 그대로 받는다', 눈금맞추기(클로드, 'max') === 'max', String(눈금맞추기(클로드, 'max')));
  check('★ OpenAI 에서는 max 가 high 로 내려간다', 눈금맞추기(오픈AI, 'max') === 'high', String(눈금맞추기(오픈AI, 'max')));
  check('★ OpenAI 에서는 xhigh 도 high 로', 눈금맞추기(오픈AI, 'xhigh') === 'high', String(눈금맞추기(오픈AI, 'xhigh')));
  check('OpenAI 의 minimal 은 그대로 있다', 오픈AI.눈금.includes('minimal'), 오픈AI.눈금.join('·'));
  check('Gemini 에는 none 이 있다', 제미나이.눈금.includes('none'), 제미나이.눈금.join('·'));

  /*
   * ★ 올리지는 않는다.
   *
   * 사람이 low 를 골랐는데 우리가 medium 으로 올려 보내면, 그건 시킨 것과
   * 다른 일을 하는 것이고 요금도 사람이 안 정한 값으로 나간다. 내리는 것은
   * 안 그러면 그 턴이 죽어서 어쩔 수 없는 것이고, 올리는 것은 그런 사정이
   * 없다.
   */
  check('★ 낮은 값을 올리지는 않는다', 눈금맞추기(클로드, 'low') === 'low', String(눈금맞추기(클로드, 'low')));
  check('★ Gemini 에서도 low 는 low 다', 눈금맞추기(제미나이, 'low') === 'low', String(눈금맞추기(제미나이, 'low')));

  // 모르는 주소면 짐작하지 않는다. 짐작으로 실은 칸 하나가 그 턴을 죽인다.
  const 모르는곳 = 기본카드(연결('https://gw.example.com/v1', 'openai', 'some-model'));
  check('모르는 주소는 회사를 안 정한다', 모르는곳.회사 === null, String(모르는곳.회사));
  check('★ 모르는 주소의 눈금은 좁게 잡는다', 모르는곳.눈금.join('·') === 'low·medium·high', 모르는곳.눈금.join('·'));

  /*
   * ★★ 같은 회사라도 **몸의 규격**을 따른다.
   *
   * Bedrock 은 창구가 둘이다. Anthropic Messages 몸으로 나가는 mantle 창구는
   * `xhigh` 를 받는 것이 문서에 있고, OpenAI 호환 창구가 받는지는 **확인하지
   * 못했다.** 확인 못 한 말을 실어 보내면 그 턴이 400 이고, 그 400 은 화면에서
   * 열쇠가 틀린 것과 구별이 안 된다.
   *
   * 잘못 좁히면 손해가 「생각을 덜 한다」 로 끝나고, 잘못 넓히면 손해가
   * 「그 턴이 죽는다」 다. 그래서 확인이 안 되면 죽지 않는 쪽으로 간다.
   */
  const 맨틀 = 기본카드(연결('https://bedrock-mantle.us-east-1.api.aws/anthropic/v1', 'anthropic', 'anthropic.claude-opus-5-v1:0'));
  const 베드락오픈AI = 기본카드(연결('https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1', 'openai', 'anthropic.claude-opus-5-v1:0'));
  check('★★ Anthropic 몸으로 나갈 때만 xhigh 를 쓴다',
    눈금맞추기(맨틀, 'max') === 'max', String(눈금맞추기(맨틀, 'max')));
  check('★★ 같은 Bedrock 이라도 OpenAI 몸에는 안 쓴다',
    눈금맞추기(베드락오픈AI, 'max') === 'high', String(눈금맞추기(베드락오픈AI, 'max')));
  /*
   * ── 이 줄은 **틀린 약속**을 못 박고 있었다 ─────────────────────────────
   *
   * 위 머리말이 「잘못 넓히면 손해가 그 턴이 죽는다」 고 적어 놓고, 정작 여기서
   * `minimal` 을 하나 더 얹은 것을 초록으로 굳혀 뒀다. `minimal` 은 OpenAI
   * 전용 눈금이라 Claude 에는 그 말이 없다 — 실어 보내면 400 이다(30차 리뷰).
   *
   * 좁힌 쪽만 재면 반대로 너무 좁혔을 때를 못 잡으니 **양쪽을 다 잰다.**
   */
  check('★★ 그 창구 Claude 에는 OpenAI 전용 minimal 을 안 얹는다',
    베드락오픈AI.눈금.join('·') === 'low·medium·high', 베드락오픈AI.눈금.join('·'));
  check('★★ 눈금맞추기도 minimal 을 안 내놓는다',
    눈금맞추기(베드락오픈AI, 'minimal') === null, String(눈금맞추기(베드락오픈AI, 'minimal')));
  {
    // 반대쪽 — Claude 가 아니면 그 창구는 여전히 OpenAI 눈금 그대로다.
    const 베드락GPT = 기본카드(연결('https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1', 'openai', 'openai.gpt-oss-120b-1:0'));
    check('★★ 같은 창구라도 Claude 가 아니면 OpenAI 눈금 그대로다',
      베드락GPT.눈금.join('·') === 'minimal·low·medium·high', 베드락GPT.눈금.join('·'));
  }

  check('우리 눈금 차례가 뒤집히지 않았다', 눈금차례.join('·') === 'low·medium·high·xhigh·max', 눈금차례.join('·'));

  /*
   * ── 카드는 제 눈금을 가져야 한다 ──────────────────────────────────────
   *
   * 모듈 표를 그대로 물리면 카드 하나를 손댄 것이 **그 회사 표 전체**를 고친다.
   * 그러면 그 다음에 켜는 세션이 조용히 다른 눈금을 갖는다 — 고장이 난 자리와
   * 드러나는 자리가 달라서 제일 찾기 어려운 부류다(31차 리뷰).
   *
   * 회사를 알아본 길·anthropic 길·bedrock 의 OpenAI 길 세 자리가 다 표를
   * 내주므로 셋을 다 잰다.
   */
  for (const [이름, conn] of [
    ['openai', 연결('https://api.openai.com/v1', 'openai', 'gpt-5')],
    ['anthropic', 연결('https://api.anthropic.com/v1', 'anthropic', 'claude-opus-5')],
    ['bedrock+openai', 연결('https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1', 'openai', 'openai.gpt-oss-120b-1:0')],
  ]) {
    const 먼저 = 기본카드(conn).눈금.join('·');
    기본카드(conn).눈금.pop();
    check(`★★★ 카드 눈금을 손대도 다음 카드가 안 바뀐다 — ${이름}`,
      기본카드(conn).눈금.join('·') === 먼저, `${먼저} → ${기본카드(conn).눈금.join('·')}`);
  }
}

// ── 3. 생각을 어느 칸에 싣나 ────────────────────────────────────────────
//
// 4.6 판부터 adaptive 다. 그 전 판은 budget_tokens 다. 반대로 실으면 400 이다.
{
  const 새것 = 기본카드(연결('https://api.anthropic.com/v1', 'anthropic', 'claude-opus-5'));
  const 옛것 = 기본카드(연결('https://api.anthropic.com/v1', 'anthropic', 'claude-3-5-sonnet-20241022'));
  check('★ Opus 5 는 adaptive 다', 새것.생각형식 === 'adaptive', 새것.생각형식);
  check('★ 3.5 Sonnet 은 budget_tokens 다', 옛것.생각형식 === 'budget', 옛것.생각형식);

  // 못 읽는 이름이면 지금 쓰이는 쪽으로 간다. 틀려도 첫 400 에서 바로 배운다.
  const 모를것 = 기본카드(연결('https://api.anthropic.com/v1', 'anthropic', '사내-모델'));
  check('이름을 못 읽으면 adaptive 로 간다', 모를것.생각형식 === 'adaptive', 모를것.생각형식);

  const 올라마 = 기본카드(연결('http://127.0.0.1:11434/v1', 'ollama', 'qwen3'));
  check('ollama 는 참·거짓이다', 올라마.생각형식 === 'boolean', 올라마.생각형식);
}

// ── 4. 캐시를 누가 잡나 ─────────────────────────────────────────────────
//
// 이 세 값이 뜻하는 것이 완전히 다르다.
//
//   explicit  우리가 표식을 붙인다 (Anthropic 규격 — 붙일 수 있는 유일한 자리)
//   key       열쇠 한 줄로 같은 대화라고 알려 준다 (OpenAI 직통)
//   auto      서버가 알아서 앞머리만 잡아 준다 (Gemini · Azure · Claude 아닌 것)
//
// 갈림은 **창구가 아니라 모델**이다. Claude 의 캐시는 자라는 앞머리 캐시가
// 아니라 표식으로 끊는 방식이라, 몸이 OpenAI 꼴이어도 표식이 있어야 자란다.
{
  const 직통 = 기본카드(연결('https://api.anthropic.com/v1', 'anthropic', 'claude-opus-5'));
  const 맨틀 = 기본카드(연결('https://bedrock-mantle.us-east-1.api.aws/anthropic/v1', 'anthropic', 'anthropic.claude-opus-5-v1:0'));
  const 오픈AI = 기본카드(연결('https://api.openai.com/v1', 'openai', 'gpt-5'));
  const 베드락 = 기본카드(연결('https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1', 'openai', 'anthropic.claude-opus-5-v1:0'));

  check('★ Anthropic 직통은 우리가 붙인다', 직통.캐시 === 'explicit', 직통.캐시);
  check('★ OpenAI 직통은 열쇠로 묶는다', 오픈AI.캐시 === 'key', 오픈AI.캐시);
  /*
   * 여기는 여태 `auto` 였다 — 「이 창구는 서버가 알아서 앞머리를 캐시한다」.
   * Claude 앞에서 그게 틀린다. 표식이 없으면 서버가 기본으로 잡아 주는
   * 앞머리에서 멈추고, 대화가 6k→59k 로 자라는 동안 읽힌 것이 5.9k 에 못
   * 박힌 채 늘어난 53k 가 걸음마다 전액 다시 나갔다.
   */
  check('★★ Bedrock OpenAI 창구라도 Claude 면 우리가 붙인다', 베드락.캐시 === 'explicit', 베드락.캐시);
  const 베드락노바 = 기본카드(연결('https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1', 'openai', 'amazon.nova-pro'));
  check('★ 같은 창구라도 Claude 가 아니면 서버에 맡긴다', 베드락노바.캐시 === 'auto', 베드락노바.캐시);

  /*
   * ★ mantle 의 Anthropic 창구를 Bedrock 으로 알아본다.
   *
   * 이 주소는 amazonaws.com 이 아니라 api.aws 아래에 있다. 못 알아보면
   * 「모르는 주소」 가 되어 눈금도 캐시 최소 크기도 전부 좁게 잡힌다 —
   * 즉 mantle 로 붙인 사람만 조용히 손해를 본다.
   */
  check('★ mantle 을 Bedrock 으로 알아본다', 맨틀.회사 === 'bedrock', String(맨틀.회사));
  check('★ mantle 에서도 표식은 우리가 붙인다', 맨틀.캐시 === 'explicit', 맨틀.캐시);
  check('★ Bedrock 의 표식 최소 크기는 4096 이다', 맨틀.캐시최소 === 4096, String(맨틀.캐시최소));
  check('Anthropic 직통은 1024 다', 직통.캐시최소 === 1024, String(직통.캐시최소));
}

// ── 5. 세션 이름은 밖으로 나간다 ────────────────────────────────────────
//
// ★ 여기가 이 파일에서 제일 조심스러운 자리다. 게이트웨이 로그에 그대로
//   남고, 주소에 끼워 쓰는 곳도 있다. 그래서 담는 것은 대화 번호 하나뿐이다.
{
  check('대화 번호만 담는다', 세션이름짓기('a1b2c3') === 'deel-a1b2c3', String(세션이름짓기('a1b2c3')));

  const 위험한것 = 세션이름짓기('C:\\Users\\yunseok\\Desktop\\비밀폴더');
  check('★ 경로가 안 새어 나간다', !/Users|yunseok|Desktop/.test(String(위험한것)), String(위험한것));
  check('★ 한글도 안 나간다', !/[가-힣]/.test(String(위험한것)), String(위험한것));

  const 열쇠같은것 = 세션이름짓기('sk-ant-api03-Zx9!@#$%^&*()');
  check('★ 이상한 글자는 다 떨어진다', /^deel-[A-Za-z0-9_-]*$/.test(String(열쇠같은것)), String(열쇠같은것));

  const 아주긴것 = 세션이름짓기('x'.repeat(500));
  check('★ 길이를 좁게 자른다', String(아주긴것).length <= 53, String(아주긴것).length + '자');

  check('담을 것이 없으면 안 만든다', 세션이름짓기('') === null && 세션이름짓기(null) === null);

  /*
   * ★ 안전한 모양이 아니면 **거르지 않고 통째로 지문으로 바꾼다.**
   *
   * 거르기는 남는 것이 무엇인지 안 보는 방식이라, 위 경로 검사가 실제로
   * 그렇게 샜다 — 한글만 떨어지고 사람 이름과 폴더 이름은 그대로 남았다.
   */
  const 한글것 = 세션이름짓기('한글만있음');
  check('★ 한글 이름은 지문으로 바뀐다', /^deel-[0-9a-f]{16}$/.test(String(한글것)), String(한글것));
  check('★ 같은 대화는 늘 같은 이름이다', 세션이름짓기('한글만있음') === 한글것, String(한글것));
  check('★ 다른 대화는 다른 이름이다', 세션이름짓기('다른것') !== 한글것, String(세션이름짓기('다른것')));
}

// ── 5b. 이름은 **머리**로도 나간다 ──────────────────────────────────────
//
// ★ 몸통 자리(위 10번)는 규격이 받는 칸이 있을 때만 쓴다. 그러면 게이트웨이
//   뒤 — 사람들이 실제로 제일 많이 쓰는 자리 — 에는 아무것도 안 나간다.
//   머리는 모르면 무시되므로 400 이 날 자리가 아니다. 그래서 여기로 보낸다.
//
//   이게 없으면 요청마다 새 대화가 열린다. 대시보드가 흩어지는 것은 눈에
//   보이는 쪽이고, 안 보이는 쪽이 훨씬 비싸다 — 모델 하나 뒤에 창구가
//   여럿이면 요청마다 다른 창구로 갈리고, 프롬프트 캐시는 창구마다 따로라
//   갈리는 순간 앞머리가 통째로 다시 나간다.
{
  const 머리 = 더할머리('openai', 'deel-20260907-093608');
  check('★ 이름을 머리에 싣는다',
    머리['x-litellm-session-id'] === 'deel-20260907-093608', JSON.stringify(머리));
  check('★ 우리 이름표로도 같이 싣는다 — 일반 규칙으로 읽는 곳이 있다',
    머리['x-deel-session-id'] === 'deel-20260907-093608', JSON.stringify(머리));
  check('★ 두 이름표의 값이 같다', 머리['x-litellm-session-id'] === 머리['x-deel-session-id']);

  /*
   * ── 이름표는 넷이고, 값은 하나다 ──────────────────────────────────────
   *
   * 「이 요청들은 한 대화다」 를 적는 표준 이름이 없어서 아는 이름을 다 단다.
   * 그런데 값이 갈리면 그 순간 **한 대화가 게이트웨이 안에서 둘로 쪼개진다** —
   * 어떤 기록기는 session 을 보고 어떤 기록기는 trace 를 본다. 이름이 여럿인
   * 것은 도움이 되지만 값이 여럿인 것은 그냥 고장이다.
   *
   * 그리고 **개수를 못 박는다.** 하나 빠뜨려도 나머지가 걸리니 화면에는
   * 아무 일도 안 일어나고, 그 판을 쓰는 게이트웨이에서만 조용히 안 묶인다.
   */
  const 세션표 = Object.entries(더할머리('openai', 'deel-20260907-093608'))
    .filter(([k]) => /session|trace/i.test(k));
  const 이름들 = 세션표.map(([k]) => k).sort();
  const 값들 = new Set(세션표.map(([, v]) => v));

  check('★★ 아는 이름표를 다 단다', 이름들.join(' ')
    === 'x-deel-session-id x-litellm-session-id x-litellm-trace-id x-session-id',
    이름들.join(' '));
  check('★★ 이름표가 넷이라도 값은 하나다', 값들.size === 1,
    [...값들].join(' · '));
  // 규격이 다른 쪽에도 똑같이 실린다 — 한쪽만 되면 그건 되는 것이 아니다.
  const 앤표 = Object.entries(더할머리('anthropic', 'deel-abc'))
    .filter(([k]) => /session|trace/i.test(k));
  check('★ Anthropic 규격에도 같은 이름표가 실린다',
    앤표.length === 이름들.length, String(앤표.length));
  // 이름이 없으면 하나도 안 단다 — 빈 이름표는 「대화가 없다」 가 아니라
  // 「이름이 빈 대화」 로 기록돼서, 남의 대화와 한 칸에 뭉친다.
  check('★★ 이름이 없으면 하나도 안 단다',
    Object.keys(더할머리('openai', null)).every((k) => !/session|trace/i.test(k)), '');


  // 규격을 안 가린다. Anthropic 규격에서도 판 머리와 **같이** 나간다.
  const 앤 = 더할머리('anthropic', 'deel-abc');
  check('★ 규격을 안 가린다', 앤['x-litellm-session-id'] === 'deel-abc' && !!앤['anthropic-version'],
    JSON.stringify(앤));

  // 이름이 없으면 아무것도 안 붙는다 — 진단·한 번 재보기가 그 자리다.
  check('★ 이름이 없으면 안 붙인다',
    Object.keys(더할머리('openai')).length === 0 && Object.keys(더할머리('openai', '')).length === 0,
    JSON.stringify(더할머리('openai', '')));
}

// ── 5c. 그 머리가 **진짜로** 전선까지 간다 ──────────────────────────────
//
// 위는 함수가 뭘 돌려주는지만 봤다. 부르는 자리가 그것을 안 쓰면 아무 일도
// 안 일어난다 — 실제로 몸통 쪽이 그랬다(요약을 만드는 부름이 이름을 빠뜨렸다).
// 그래서 여기서는 진짜로 보내 보고 서버가 무엇을 받았는지 본다.
{
  let 받은머리 = null;
  let 받은몸 = null;
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      받은머리 = req.headers;
      try { 받은몸 = JSON.parse(body); } catch { 받은몸 = null; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '네' } }] }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  allowEndpoint(base);

  // 게이트웨이 뒤에 Claude 를 둔 모양 — 몸통에는 이름을 실을 칸이 없는 자리다.
  const conn = {
    kind: 'openai', base, auth: 'bearer', key: 'k-1',
    model: 'bedrock/converse/claude-opus-5',
    세션이름: 'deel-20260907-093608',
  };
  await chat(conn, { messages: [{ role: 'user', content: '안녕' }], maxTokens: 64 });
  await new Promise((r) => srv.close(r));

  check('★★ 이름이 실제로 전선까지 간다',
    받은머리?.['x-litellm-session-id'] === 'deel-20260907-093608',
    String(받은머리?.['x-litellm-session-id']));
  check('★★ 그러면서 몸통은 그대로 깨끗하다',
    받은몸 && !('user' in 받은몸) && !('prompt_cache_key' in 받은몸),
    Object.keys(받은몸 ?? {}).sort().join(', '));
  적어둘것.push('게이트웨이에 나가는 세션 이름표 4개: ' + Object.keys(더할머리('openai','x')).filter((k) => /session|trace/i.test(k)).join(' · '));
}

// ── 6. 400 문구에서 배운다 ──────────────────────────────────────────────
//
// 표를 박아 두면 그 표는 반드시 낡는다. 서버가 안 된다고 말해 주면 그 말에서
// 읽는다 — 이 프로그램이 컨텍스트 길이와 답 길이를 배우는 방식과 같다.
{
  /*
   * 규격을 **같이 준다.** 여태 안 주고 불렀는데, 진짜 부르는 자리
   * (agent/loop.js)는 늘 `conn.kind` 를 준다 — 검사가 아무도 안 쓰는 방식으로
   * 부르고 있었다. 그러면 규격을 보고 갈라야 하는 규칙을 이 검사로는 못 잰다.
   */
  const 봐야할것 = [
    ['budget_tokens: Extended thinking with budget_tokens is not supported', 'anthropic', '생각형식'],
    ['Input tag `thinking.budget_tokens` is deprecated', 'anthropic', '생각형식'],
    ["Invalid value for 'reasoning_effort': must be one of: minimal, low, medium, high", 'openai', '눈금'],
    ['Unrecognized request argument supplied: prompt_cache_key', 'openai', '캐시'],
    ['metadata.user_id: unsupported field', 'anthropic', '세션자리'],
  ];
  for (const [문구, 규격, 무엇] of 봐야할것) {
    const 배운것 = 배울전선(문구, 규격);
    check(`배운다: ${무엇} (${문구.slice(0, 34)}…)`, 배운것?.무엇 === 무엇, JSON.stringify(배운것));
  }

  /*
   * ── 같은 문장이라도 규격이 다르면 배울 것이 다르다 ────────────────────
   *
   * `budget_tokens` 는 Anthropic 칸이다. OpenAI 규격으로 붙인 프록시가 우리
   * `reasoning_effort` 를 제 나름대로 그 칸으로 옮겨 올리고 상단이 거절하면
   * 그 문장이 내려온다. 그걸 그대로 배우면 `생각형식` 이 `adaptive` 가 되고 —
   * OpenAI 몸에는 그 형식이 없어서 **그 뒤로 세기가 아예 안 나간다.** 그 턴은
   * 200 이라 아무도 안 알아챈다(31차 하네스).
   */
  check('★★★ budget_tokens 를 OpenAI 규격에 adaptive 로 안 배운다',
    배울전선('thinking.budget_tokens: Extra inputs are not permitted', 'openai')?.값 !== 'adaptive',
    JSON.stringify(배울전선('thinking.budget_tokens: Extra inputs are not permitted', 'openai')));

  // ★ 모르는 400 은 배운 척하지 않는다. 지어낸 배움은 다음 요청부터 계속 틀린다.
  check('★ 모르는 400 에서는 아무것도 안 배운다',
    배울전선('You have exceeded your quota') === null,
    JSON.stringify(배울전선('You have exceeded your quota')));
  check('빈 문구도 안 죽는다', 배울전선('') === null && 배울전선(null) === null);

  // 배운 눈금이 실제로 카드에 앉는가.
  const 카드 = 기본카드(연결('https://gw.example.com/v1', 'openai', 'x'));
  const 고침 = 배울전선("Invalid value for 'reasoning_effort': must be one of: minimal, low, medium, high");
  const 고친것 = 카드고치기(카드, 고침);
  check('배운 눈금이 카드에 앉는다', 고친것.눈금.join('·') === 'minimal·low·medium·high', 고친것.눈금.join('·'));
  check('★ 배우면 그 눈금으로 맞춘다', 눈금맞추기(고친것, 'max') === 'high', String(눈금맞추기(고친것, 'max')));

  const 생각끈것 = 카드고치기(기본카드(연결('https://api.anthropic.com/v1', 'anthropic', 'claude-opus-5')),
    배울전선('thinking.budget_tokens is deprecated', 'anthropic'));
  check('생각 형식도 배운다', 생각끈것.생각형식 === 'adaptive', 생각끈것.생각형식);
}

// ── 7. 배운 것을 남기고 다시 읽는다 ─────────────────────────────────────
//
// 다음에 켤 때 같은 400 을 또 맞으면 배운 뜻이 없다.
{
  const 기본 = 기본카드(연결('https://api.openai.com/v1', 'openai', 'gpt-5'));

  /*
   * ★ 짐작은 안 남긴다. 배운 것만 남긴다.
   *
   * 카드는 대부분 짐작이다. 통째로 남기면 오늘의 짐작이 내일 「배운 것」 인
   * 척 살아 돌아온다 — 짐작하는 자리를 고쳐도 남긴 것이 위에 얹혀서 그
   * 고침이 영영 안 먹는다. 판을 올려도 낫지 못하는 고장이 이렇게 생긴다.
   */
  check('★ 배운 것이 없으면 아예 안 남긴다', 카드저장꼴(기본) === null,
    JSON.stringify(카드저장꼴(기본)));

  const 배운카드 = 카드고치기(기본, 배울전선('Unsupported parameter: stream_options'));
  const 남길것 = 카드저장꼴(배운카드);
  check('저장꼴은 JSON 으로 오간다', typeof JSON.parse(JSON.stringify(남길것)) === 'object');
  /*
   * 남는 것은 **배운 카드 칸**뿐이다. 거기에 「누가 껐는지」 표 하나가 따라간다
   * (`서버가말한칸`) — 그건 카드 칸이 아니라 장부다. 그 표가 안 남으면 다시 켤
   * 때마다 표가 사라져서, 서버가 안 받는다고 말해 준 칸이 되살아난다(30차 리뷰).
   * 그래서 카드 칸과 장부를 갈라서 잰다 — 장부에 짐작이 섞여도 잡히게.
   */
  const 카드칸남긴것 = Object.keys(남길것).filter((k) => k !== '서버가말한칸');
  check('★ 배운 칸만 남는다', 카드칸남긴것.join(',') === '스트림usage', Object.keys(남길것).join(','));
  check('★ 짐작한 칸은 안 따라간다', 남길것.눈금 === undefined && 남길것.캐시 === undefined,
    JSON.stringify(남길것));
  check('★ 누가 껐는지 표에도 배운 칸만 든다',
    (남길것.서버가말한칸 ?? []).join(',') === '스트림usage', JSON.stringify(남길것.서버가말한칸));

  // 되살리면 배운 칸은 배운 대로, 나머지는 그날의 짐작으로 선다.
  const 되살린것 = 카드합치기(기본카드(연결('https://api.openai.com/v1', 'openai', 'gpt-5')), 남길것);
  check('★ 되살리면 배운 것이 먹는다', 되살린것.스트림usage === false, String(되살린것.스트림usage));
  check('되살려도 짐작은 그날 것을 쓴다', 되살린것.눈금.join('·') === 기본.눈금.join('·'),
    되살린것.눈금.join('·'));

  // 배운 칸은 이어서 또 배우면 함께 남는다. 한 번 배우면 앞에 배운 것을 잊으면 안 된다.
  const 두번배운것 = 카드저장꼴(카드고치기(되살린것, 배울전선("Unknown parameter: 'user'")));

  /*
   * ★ `cache_control` 거절을 규격마다 다르게 배운다.
   *
   * OpenAI 규격에서는 같은 뜻의 다른 이름(`prompt_cache_breakpoint`)이 있으니
   * 한 번 바꿔 본다. Anthropic 규격에는 그 이름이 없다 — 거기서 바꾸면
   * `Extra inputs are not permitted` 로 두 번째 400 을 맞고, 배움은 이미
   * 한 번 썼으니 끄지도 못한다. 그 창구는 매 턴이 죽는다.
   */
  {
    const 말 = "Extra inputs are not permitted: 'cache_control'";
    const 오픈 = 배울전선(말, 'openai');
    check('★★ openai 규격은 cache_control 거절을 다른 이름으로 한 번 바꿔 본다',
      오픈?.무엇 === '표식칸' && 오픈?.값 === 'prompt_cache_breakpoint', JSON.stringify(오픈));
    const 앤 = 배울전선(말, 'anthropic');
    check('★★ anthropic 규격은 cache_control 거절이면 바로 끈다',
      앤?.무엇 === '캐시' && 앤?.값 === 'none', JSON.stringify(앤));
    const 모름 = 배울전선(말);
    check('규격을 모르면 여태 하던 대로 바꿔 본다',
      모름?.무엇 === '표식칸', JSON.stringify(모름));
  }
  check('★ 두 번 배우면 둘 다 남는다',
    두번배운것?.스트림usage === false && 두번배운것?.세션자리 === null,
    JSON.stringify(두번배운것));

  // ★ 남긴 것이 없으면 기본 카드가 그대로 산다. 빈 것으로 덮으면 안 된다.
  const 빈것으로 = 카드합치기(기본, null);
  check('★ 남긴 것이 없으면 기본이 그대로', 빈것으로.눈금.join('·') === 기본.눈금.join('·'), 빈것으로.눈금.join('·'));

  const conn = 연결('https://api.openai.com/v1', 'openai', 'gpt-5');
  전선붙이기(conn, { 아는전선: () => 남길것 });
  check('연결에 카드가 붙는다', !!conn.전선?.눈금?.length, JSON.stringify(conn.전선?.눈금));

  /*
   * ★ 전선붙이기 는 규격까지 물어봐야 한다.
   *
   * mantle 은 한 호스트에 창구가 둘이다 — `/openai/v1` 과 `/anthropic/v1` 이
   * 같은 모델 이름으로 서 있다. 규격을 안 물으면 한쪽에서 배운 것이 다른
   * 쪽 카드 위에 얹히고, 그러면 그 창구에서는 생각도 캐시 표식도 조용히 꺼진다.
   */
  const 물은것 = [];
  전선붙이기(연결('https://bedrock-mantle.us-east-1.api.aws/anthropic/v1', 'anthropic', 'claude-opus-5'),
    { 아는전선: (...a) => { 물은것.push(a); return null; } });
  check('★ 카드를 찾을 때 규격까지 준다', 물은것[0]?.[2] === 'anthropic',
    JSON.stringify(물은것[0]));

  /*
   * 카드칸들 은 저장꼴·합치기가 같이 쓰는 목록이다. 한쪽만 늘면 조용히 샌다.
   *
   * 여기가 `length === 8` 이었다. 그 숫자는 **칸이 늘었다**는 것만 알려 주고
   * **어느 칸이 빠졌는지**는 안 알려 준다. 칸을 하나 더하면서 이 숫자만 고치면
   * 목록에 안 넣어도 검사가 초록이 된다 — 그러면 그 칸은 배워도 디스크에 안
   * 남고, 사람은 「배웠습니다」 를 매 판 다시 본다.
   *
   * 그래서 숫자가 아니라 **기본카드가 실제로 만드는 칸**과 맞춰 본다.
   * 회사·규격은 카드가 아니라 그 카드가 누구 것인지를 적은 꼬리표고,
   * 캐시최소는 모델에서 늘 다시 셈하므로 배울 것이 아니다.
   */
  {
    const 꼬리표 = new Set(['회사', '규격', '캐시최소']);
    const 실제칸 = Object.keys(기본카드(연결('https://api.openai.com/v1', 'openai', 'gpt-4o')))
      .filter((k) => !꼬리표.has(k));
    const 빠진것 = 실제칸.filter((k) => !카드칸들.includes(k));
    const 남는것 = 카드칸들.filter((k) => !실제칸.includes(k));
    check('★★ 카드 칸 목록이 기본카드와 정확히 맞는다', 빠진것.length === 0 && 남는것.length === 0,
      `빠진것 [${빠진것}] · 남는것 [${남는것}]`);
  }
}

// ── 8. 캐시 표식이 붙는 자리 ────────────────────────────────────────────
//
// 표식은 **자르는 자리**다. 그 앞이 통째로 캐시가 된다. 그래서 자리가
// 흔들리면 캐시도 흔들린다 — 붙이는 것보다 어디에 붙이느냐가 중요하다.
{
  const 메시지 = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `말 ${i}` }));

  // 짧은 대화에는 하나만. 닻까지 두면 자리만 먹고 얻는 것이 없다.
  const 짧은것 = 메시지식(메시지(6));
  check('짧은 대화에는 표식이 하나다', 짧은것 === 1, String(짧은것));

  // 긴 대화에는 둘. 뒤엣것은 이번 것을, 앞엣것은 다음 번을 위해 남긴다.
  const 긴것 = 메시지식(메시지(닻문턱 + 10));
  check('★ 긴 대화에는 표식이 둘이다', 긴것 === 2, String(긴것));

  function 메시지식(ms) {
    const 붙인것 = 메시지표식(ms.map((m) => ({ ...m })));
    return 붙인것.filter((m) => JSON.stringify(m).includes('cache_control')).length;
  }

  /*
   * ★ 생각 블록에는 안 붙인다.
   *
   * 그 블록은 서명이 붙어 오고, 서명이 붙은 것을 우리가 건드리면 그 턴이
   * 통째로 거절된다.
   */
  const 생각낀것 = {
    role: 'assistant',
    content: [{ type: 'thinking', thinking: '음…', signature: 'abc' }, { type: 'text', text: '답' }],
  };
  const 붙인생각 = 블록에붙이기(생각낀것);
  const 어디붙었나 = 붙인생각.content.findIndex((b) => b.cache_control);
  check('★ 생각 블록을 건너뛴다', 어디붙었나 === 1, `${어디붙었나}번째`);

  /*
   * ★ 원본을 안 건드린다.
   *
   * 이력은 다음 턴에도 그대로 다시 쓰인다. 여기서 원본에 표식을 박으면 그
   * 표식이 이력에 남아 다음 턴에도 같이 나가고, 그러면 표식이 턴마다 하나씩
   * 늘어난다. 규격이 받는 표식 수에는 한계가 있어서 언젠가 400 이 된다.
   */
  check('★ 원본에는 표식이 안 남는다', !생각낀것.content.some((b) => b.cache_control));

  // 빈 글에 붙이면 서버가 안 받는다.
  const 빈것낀것 = { role: 'user', content: [{ type: 'text', text: '' }, { type: 'text', text: '진짜 말' }] };
  const 붙인빈것 = 블록에붙이기(빈것낀것);
  check('빈 글은 건너뛴다', !!붙인빈것.content[1].cache_control && !붙인빈것.content[0].cache_control);

  /*
   * ★ 작으면 안 붙인다.
   *
   * 최소 크기 아래면 표식을 붙여도 서버가 안 잡는다. 탈이 나지는 않지만,
   * 안 잡히는 표식을 붙이는 것은 매 요청에 쓸모없는 칸을 하나 더 싣는 것이다.
   */
  check('작은 대화에는 안 붙인다', 잡힐만한가([{ role: 'user', content: '안녕' }], 4096) === false);
  check('큰 대화에는 붙인다', 잡힐만한가([{ role: 'user', content: 'ㄱ'.repeat(30000) }], 4096) === true);
}

// ── 9. 시스템 프롬프트가 갈라져도 글자는 그대로다 ───────────────────────
//
// ★ 여기가 무너지면 test/cache.test.js 가 지키는 것이 통째로 무너진다.
//   굳은 것과 변하는 것을 나눠 표식을 사이에 끼우는데, 나누면서 글자가
//   한 자라도 달라지면 앞머리가 통째로 새로 엮인다 — 고치려던 바로 그 고장이다.
{
  const 조각 = ['굳은 부분입니다.\n', '변하는 부분입니다.\n'];
  const 안붙일때 = 시스템블록(조각, false);
  const 붙일때 = 시스템블록(조각, true);

  const 글자만 = (x) => (typeof x === 'string' ? x : x.map((b) => b.text).join(''));
  check('★ 표식을 붙여도 글자가 같다', 글자만(안붙일때) === 글자만(붙일때), 글자만(붙일때).slice(0, 20));
  check('★ 원래 글과도 같다', 글자만(붙일때) === 조각.join(''), 글자만(붙일때));
  check('붙일 때는 블록으로 나간다', Array.isArray(붙일때) && 붙일때.length === 2, String(붙일때?.length));
  check('★ 표식은 굳은 쪽 끝에 붙는다', !!붙일때[0].cache_control && !붙일때[1]?.cache_control);
}

// ── 10. 몸에 실제로 실리는가 ────────────────────────────────────────────
//
// 카드가 맞아도 몸을 만들 때 안 쓰면 아무 일도 안 일어난다. 여기가 마지막
// 자리다 — 이 아래는 바로 전선이다.
{
  const 클로드카드 = 기본카드(연결('https://api.anthropic.com/v1', 'anthropic', 'claude-opus-5'));
  const 머리 = { role: 'system', content: '굳은 것\n변하는 것\n' };
  머리[조각표] = ['굳은 것\n', '변하는 것\n'];

  const 몸 = buildBody('anthropic', {
    model: 'claude-opus-5',
    messages: [머리, { role: 'user', content: 'ㄱ'.repeat(8000) }],
    maxTokens: 4096,
    think: 'xhigh',
    카드: 클로드카드,
    세션이름: 'deel-abc123',
  });

  check('★ adaptive 로 켠다', 몸.thinking?.type === 'adaptive', JSON.stringify(몸.thinking));
  check('★ budget_tokens 를 안 싣는다', !('budget_tokens' in (몸.thinking ?? {})), JSON.stringify(몸.thinking));
  check('★ 효력은 output_config 에 싣는다', 몸.output_config?.effort === 'xhigh', JSON.stringify(몸.output_config));
  check('★ 세션 이름이 metadata 로 간다', 몸.metadata?.user_id === 'deel-abc123', JSON.stringify(몸.metadata));
  check('★ 시스템에 표식이 붙는다', JSON.stringify(몸.system).includes('cache_control'), JSON.stringify(몸.system).slice(0, 80));

  // 옛 모델에는 반대로 나가야 한다.
  const 옛카드 = 기본카드(연결('https://api.anthropic.com/v1', 'anthropic', 'claude-3-5-sonnet-20241022'));
  const 옛몸 = buildBody('anthropic', {
    model: 'claude-3-5-sonnet-20241022',
    messages: [{ role: 'system', content: 'x' }, { role: 'user', content: '안녕' }],
    maxTokens: 4096,
    think: 'high',
    카드: 옛카드,
  });
  /*
   * 숫자이기만 하면 0 도 통과한다. 그런데 budget_tokens 0 은 **거절당하는
   * 값**이고(최소치가 있다), 우리 쪽 생각예산()이 0 을 돌려주는 길도 있다 —
   * 출력 상한이 좁을 때. 그 두 자리가 만나면 400 이 난다. 실을 거면 실을 수
   * 있는 값이어야 한다.
   */
  check('★ 옛 모델에는 budget_tokens 로 — 실을 수 있는 값이다',
    Number.isInteger(옛몸.thinking?.budget_tokens) && 옛몸.thinking.budget_tokens >= 1024
    && 옛몸.thinking.budget_tokens < (옛몸.max_tokens ?? Infinity),
    JSON.stringify(옛몸.thinking) + ' / max ' + 옛몸.max_tokens);
  check('★ 옛 모델에는 output_config 를 안 싣는다', !('output_config' in 옛몸), Object.keys(옛몸).join());

  // OpenAI 쪽.
  const 오픈AI카드 = 기본카드(연결('https://api.openai.com/v1', 'openai', 'gpt-5'));
  const 오픈AI몸 = buildBody('openai', {
    model: 'gpt-5',
    messages: [{ role: 'system', content: 'x' }, { role: 'user', content: '안녕' }],
    maxTokens: 4096,
    think: 'max',
    카드: 오픈AI카드,
    세션이름: 'deel-abc123',
  });
  check('★ OpenAI 에는 max 가 high 로 나간다', 오픈AI몸.reasoning_effort === 'high', String(오픈AI몸.reasoning_effort));
  check('★ 캐시 열쇠가 실린다', 오픈AI몸.prompt_cache_key === 'deel-abc123', String(오픈AI몸.prompt_cache_key));
  check('★ 사용자 자리도 같은 값이다', 오픈AI몸.user === 'deel-abc123', String(오픈AI몸.user));

  /*
   * ★★ 모르는 주소에는 아무것도 더 안 싣는다.
   *
   * 이것이 이 파일에서 제일 중요한 한 줄이다. 사내 게이트웨이는 모르는 칸
   * 하나에 400 을 내는 곳이 흔하다. 「호환성을 넓힌다」 가 「모르는 곳에
   * 짐작으로 칸을 늘린다」 가 되면, 지금 잘 쓰고 있는 사람의 설치가
   * 이 판올림 하나로 죽는다.
   */
  const 모르는카드 = 기본카드(연결('https://gw.example.com/v1', 'openai', 'some-model'));
  const 모르는몸 = buildBody('openai', {
    model: 'some-model',
    messages: [{ role: 'system', content: 'x' }, { role: 'user', content: '안녕' }],
    maxTokens: 4096,
    카드: 모르는카드,
  });
  /*
   * ★★ 대화 이름도 **문서에 있는 자리에만** 싣는다.
   *
   * Bedrock 의 OpenAI 창구가 `user` 를 받는지 문서에서 확인하지 못했고,
   * 받는다 해도 얻는 것이 없다 — 그 창구는 서버가 알아서 앞머리를 캐시하지
   * 이름으로 대화를 묶어 주지 않는다. 문서에 없는 칸을 **얻는 것 없이**
   * 실어 보내는 셈이라, 모르는 칸에 엄격한 곳에서는 그 턴이 400 이다.
   */
  const 베드락몸 = buildBody('openai', {
    model: 'anthropic.claude-opus-5-v1:0',
    messages: [{ role: 'system', content: 'x' }, { role: 'user', content: '안녕' }],
    maxTokens: 4096,
    카드: 기본카드(연결('https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1', 'openai', 'anthropic.claude-opus-5-v1:0')),
    세션이름: 'deel-abc123',
  });
  check('★★ Bedrock 에는 대화 이름을 안 싣는다',
    !('user' in 베드락몸) && !('prompt_cache_key' in 베드락몸), Object.keys(베드락몸).sort().join(', '));
  적어둘것.push('Bedrock(openai) 에 나가는 칸: ' + Object.keys(베드락몸).sort().join(', '));

  check('★★ 모르는 곳에는 캐시 열쇠를 안 싣는다', !('prompt_cache_key' in 모르는몸), Object.keys(모르는몸).join());
  check('★★ 모르는 곳에는 user 도 안 싣는다', !('user' in 모르는몸), Object.keys(모르는몸).join());
  적어둘것.push('모르는 주소에 나가는 칸: ' + Object.keys(모르는몸).sort().join(', '));
}

/*
 * ── 10b. 이번에 **보낸** 프롬프트가 몇 토큰이었나 ───────────────────────
 *
 * 규격마다 `usage.in` 이 세는 범위가 다르다. 캐시가 한 번도 안 걸리던 동안은
 * 둘이 같은 값이라 이 차이가 안 보였다. 걸리기 시작하면 갈라진다.
 *
 *   OpenAI     prompt_tokens 가 합계다 (cached·cache_write 가 그 안에 있다)
 *   Anthropic  input_tokens 는 마지막 표식 뒤쪽만이다 (합계는 셋을 더한 값)
 *
 * 여기를 안 가르면 session.배운다() 가 줄어든 숫자를 「우리 추정」 과 견줘서
 * 토큰 배수를 아래로 끌어내리고, **그 배수를 디스크에 남긴다.** 그러면 남은
 * 자리를 실제보다 넉넉히 보고 답 상한을 크게 잡아 답이 잘리고, 접기를 늦게
 * 시작한다. 게다가 다음에 켤 때도 그 값이 그대로 살아난다.
 */
{
  const 앤 = { in: 500, cacheRead: 4000, cacheWrite: 1000 };
  check('★ Anthropic 은 캐시 몫까지 더해야 보낸 것이 된다', 보낸토큰('anthropic', 앤) === 5500,
    String(보낸토큰('anthropic', 앤)));

  // OpenAI 는 prompt_tokens 가 이미 합계다. 또 더하면 두 벌로 센다.
  const 오 = { in: 5500, cacheRead: 4000, cacheWrite: 1000 };
  check('★ OpenAI 는 이미 합계라 안 더한다', 보낸토큰('openai', 오) === 5500,
    String(보낸토큰('openai', 오)));

  // 모르는 규격도 OpenAI 쪽으로 둔다 — 안 더하는 편이 두 벌로 세는 것보다 낫다.
  check('모르는 규격도 안 더한다', 보낸토큰('ollama', 오) === 5500, String(보낸토큰('ollama', 오)));

  // 캐시를 안 알려 주는 창구에서는 예전과 똑같은 값이 나와야 한다.
  check('캐시를 안 알려 주면 그대로', 보낸토큰('anthropic', { in: 5500 }) === 5500,
    String(보낸토큰('anthropic', { in: 5500 })));
  check('아무것도 없으면 0', 보낸토큰('anthropic', null) === 0 && 보낸토큰('openai', undefined) === 0);

  // 이상한 값이 와도 안 터지고 안 부푼다.
  check('음수·글자는 0 으로 친다', 보낸토큰('anthropic', { in: -5, cacheRead: 'x', cacheWrite: null }) === 0,
    String(보낸토큰('anthropic', { in: -5, cacheRead: 'x', cacheWrite: null })));
}

/*
 * ── 10c. 「그 칸을 안 받는다」 와 「그 값이 틀렸다」 는 다른 말이다 ─────
 *
 * 이 자리는 **잘못 배우면 되돌릴 길이 없는** 자리다. 배운 카드는 디스크에
 * 남고, 다음 세션이 그 값으로 시작한다.
 *
 *   thinking.budget_tokens must be greater than or equal to 1024
 *
 * 이건 값을 고치면 되는 말이다. 그런데 「budget_tokens 를 안 받는구나」 로
 * 읽고 생각형식을 adaptive 로 바꿔 남기면, budget 만 받는 모델은 그때부터
 * 세션마다 400 이다. 사람은 배움 파일이 있는 줄도 모르니 고칠 길이 없다.
 *
 * **못 배우는 것보다 잘못 배우는 것이 나쁘다.** 못 배우면 같은 400 을 다시
 * 맞을 뿐이지만, 잘못 배우면 멀쩡하던 것이 망가진 채로 굳는다.
 */
{
  const 값탓들 = [
    'thinking.budget_tokens must be greater than or equal to 1024',
    'max_tokens must be greater than thinking.budget_tokens',
    'messages.0.content.0.thinking: Expected `thinking` block to have a signature. Invalid request.',
    'max_tokens: value must be at most 8192',
    'budget_tokens is too large for this model',
  ];
  for (const 말 of 값탓들) {
    check(`★★ 값 탓이면 아무것도 안 배운다 — ${말.slice(0, 34)}`,
      배울전선(말) === null, JSON.stringify(배울전선(말)));
  }

  // 그러면서 **진짜 「안 받는다」 는 그대로 배워야** 한다. 값 탓을 가리려다
  // 배울 것까지 못 배우면, 이번에는 같은 400 을 세션마다 다시 맞는다.
  const 배울것들 = [
    ['thinking.budget_tokens is deprecated', '생각형식', 'adaptive', 'anthropic'],
    ['Unrecognized request argument supplied: reasoning_effort', '생각형식', 'none'],
    ['Unsupported parameter: stream_options', '스트림usage', false],
    // cache_control 은 바로 끄지 않는다 — 같은 뜻의 다른 이름을 한 번 더 본다.
    ['ValidationException: cache_control is not supported', '표식칸', 'prompt_cache_breakpoint'],
    ['ValidationException: prompt_cache_breakpoint is not supported', '캐시', 'none'],
    ['The parameter `user` is not allowed', '세션자리', null],
  ];
  for (const [말, 무엇, 값, 규격] of 배울것들) {
    const 배운 = 배울전선(말, 규격);
    check(`★ 안 받는다는 말은 그대로 배운다 — ${무엇}`,
      배운?.무엇 === 무엇 && 배운?.값 === 값, JSON.stringify(배운));
  }

  /*
   * ── 30차 리뷰: 여기 남아 있던 네 가지 잘못 배움 ────────────────────────
   *
   * 넷 다 「잘못 배우는 것은 못 배우는 것보다 나쁘다」 의 판이다. 값이 디스크에
   * 남아서, 사람이 배움 파일을 지우기 전에는 안 낫는다.
   */
  {
    /*
     * ① 서버가 **쓸 이름을 말해 줬는데 반대를 배웠다.**
     *
     * 아래 첫 줄은 OpenAI 가 o1·gpt-5 계열에 실제로 내는 문구다. 두 이름이
     * 한 줄에 같이 있어서, `max_completion_tokens` 가 보인다는 이유로
     * 「옛것으로 갈아타라」 고 읽었다. 그 창구는 그때부터 매 턴 400 이다.
     */
    const 방향 = [
      ["Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", '새것'],
      ['max_tokens is not supported. max_completion_tokens must be used instead.', '새것'],
      ["Unsupported parameter: 'max_completion_tokens' is not supported. Use 'max_tokens' instead.", '옛것'],
      ['Unknown parameter: max_tokens', '새것'],
      ['Unknown parameter: max_completion_tokens', '옛것'],
    ];
    for (const [말, 값] of 방향) {
      const 배운 = 배울전선(말, 'openai');
      check(`★★★ 서버가 쓰라는 이름을 그대로 배운다 — ${값}`,
        배운?.무엇 === '출력칸' && 배운?.값 === 값, `${JSON.stringify(배운?.값)} ← ${말.slice(0, 56)}`);
    }

    /*
     * ② `adaptive` 는 낱말만으로 배우면 안 된다. 둘로 틀렸다 — 할당량 이야기를
     *    칸 이야기로 읽었고, Anthropic 전용 형식을 OpenAI 규격에 적어 뒀다.
     */
    for (const 말 of [
      'Adaptive rate limit exceeded: request not allowed',
      'Adaptive capacity temporarily unavailable, please retry',
    ]) {
      check(`★★★ 칸 이야기가 아니면 생각형식을 안 배운다 — ${말.slice(0, 30)}`,
        배울전선(말, 'anthropic') === null, JSON.stringify(배울전선(말, 'anthropic')));
    }
    check('★★★ budget 은 OpenAI 규격에 안 배운다',
      배울전선('Unknown parameter: adaptive', 'openai') === null,
      JSON.stringify(배울전선('Unknown parameter: adaptive', 'openai')));
    check('★★ 그래도 Anthropic 규격에서는 그대로 배운다',
      배울전선('Unknown parameter: adaptive', 'anthropic')?.값 === 'budget',
      JSON.stringify(배울전선('Unknown parameter: adaptive', 'anthropic')));

    /*
     * ── 여기까지 고친 다음 **제 고침 안에 남은 틈** 둘 (31차 리뷰) ─────────
     *
     * ㉮ 처음엔 `규격 !== 'openai'` 로 적었다. 「아닌 것 하나를 뺀다」 는 식은
     *    남은 것을 다 받아 준다 — gemini·ollama·규격 모름 에도 Anthropic 전용
     *    형식을 배웠다. **맞는 것 하나만** 이어야 한다.
     * ㉯ 칸 이야기인지 보는 무늬에 `not permitted`·`unrecognized` 를 같이 넣었다.
     *    그 둘은 거절 낱말이라 두 울타리가 같은 것을 보게 됐고, 그러면 새 울타리는
     *    없는 것과 같다 — 할당량 문구가 그대로 새어 나갔다.
     */
    for (const 규격 of ['gemini', 'ollama', undefined]) {
      check(`★★★ Anthropic 이 아닌 규격에는 budget 을 안 배운다 — ${String(규격)}`,
        배울전선('Invalid parameter: adaptive', 규격) === null,
        JSON.stringify(배울전선('Invalid parameter: adaptive', 규격)));
    }
    for (const 말 of [
      'Adaptive rate limit exceeded: request not permitted',
      'Adaptive quota unrecognized for this account',
    ]) {
      check(`★★★ 칸 이야기 무늬에 거절 낱말을 안 섞는다 — ${말.slice(-24)}`,
        배울전선(말, 'anthropic') === null, JSON.stringify(배울전선(말, 'anthropic')));
    }

    /*
     * ── 제일 헐거운 갈래가 위에 있으면 아래가 안 보인다 (31차 하네스) ──────
     *
     * `thinking` 한 낱말이 사다리 위쪽에 있었다. 그런데 그 낱말은 **모델 이름
     * 에도** 든다 — LiteLLM 계열은 오류 문장 끝에 모델 이름을 붙여 준다.
     * 그러면 두 가지가 같이 일어났다.
     *
     *   ① 진짜 원인(`stream_options` 등)을 안 껐으니 같은 400 이 매 턴 다시
     *      뜬다 — 화면에 「배웠습니다」 가 떠도 안 낫는다.
     *   ② 그러면서 생각이 꺼지고 그 값이 디스크에 남는다.
     *
     * 못 고친 오류 하나에 멀쩡한 기능 하나가 딸려 죽는 자리였다.
     */
    for (const [말, 무엇] of [
      ['Unrecognized request argument supplied: stream_options (Received Model Group=qwen3-235b-a22b-thinking-2507)', '스트림usage'],
      ['Unrecognized request argument supplied: user (model: glm-4.6-thinking)', '세션자리'],
      ['Unrecognized request argument supplied: cache_control · model=deepseek-r1-thinking', '표식칸'],
      ['Unrecognized request argument supplied: max_completion_tokens · model_name="glm-4.6-thinking"', '출력칸'],
    ]) {
      const 배운 = 배울전선(말, 'openai');
      check(`★★★ 모델 이름의 thinking 이 진짜 원인을 안 가린다 — ${무엇}`,
        배운?.무엇 === 무엇, `${JSON.stringify(배운)} ← ${말.slice(0, 50)}`);
    }
    /*
     * 반대쪽도 같이 잰다. **울타리를 조이다 멀쩡한 것을 막으면** 이번에는 같은
     * 400 을 매 턴 다시 맞는다. 실제로 여기 `칸이야기` 를 한 번 걸었다가 뺐다 —
     * 그걸 걸면 `Extended thinking is not supported` 처럼 칸을 가리키는 낱말이
     * 없는 **진짜 거절**까지 막혔다. 이름만 걸린 판과 진짜 거절이 갈리는지
     * 양쪽을 나란히 못 박아야 다음에 한쪽만 고치는 일이 안 생긴다.
     */
    for (const [말, 바람] of [
      ['Unrecognized request argument supplied: thinking', 'none'],
      ['Extended thinking is not supported on this model', 'none'],
      ['Thinking is not supported for this deployment', 'none'],
      // 아래 둘은 이름에만 들었다 — 칸 이야기가 아니라 배울 것이 없다.
      ['Invalid request for model=glm-4.6-thinking', null],
      ['Invalid request body (model_name="qwen3-235b-thinking")', null],
    ]) {
      const 배운 = 배울전선(말, 'openai');
      const 잰것 = 배운 ? (배운.무엇 === '생각형식' ? 배운.값 : 배운.무엇) : null;
      check(`★★★ 생각 거절과 이름만 걸린 것을 가른다 — ${String(바람)} ← ${말.slice(0, 34)}`,
        잰것 === 바람, `${String(잰것)} · ${JSON.stringify(배운)}`);
    }

    /*
     * ── 「제일 값진 문장」 이 제일 흔한 창구에서 한 번도 안 걸렸다 ─────────
     *
     * 받는 값을 세어 주는 문장은 짐작을 사실로 갈아탈 수 있는 유일한 문장이다.
     * 그런데 그 갈래가 문장 앞에 `reasoning_effort` 가 **적혀 있어야** 걸렸고,
     * OpenAI 규격은 칸 이름을 문장이 아니라 형제 칸에 담는다. 게다가 실제
     * 말투(`Supported values are:`)가 목록에 없었다. 그 문장은 아래로 굴러
     * 떨어져 「칸을 안 받는다」 가 됐다 — 생각이 통째로 꺼졌다.
     */
    for (const [말, 바람] of [
      ["Invalid value: 'minimal'. Supported values are: 'none', 'low', 'medium', and 'high'.", 'none,low,medium,high'],
      ['reasoning_effort: allowed values are low, medium, high', 'low,medium,high'],
      ['reasoning_effort must be one of: minimal, low, medium, high', 'minimal,low,medium,high'],
      ["Invalid value: 'medium'. Supported values are: 'low' and 'high'.", 'low,high'],
    ]) {
      const 배운 = 배울전선(말, 'openai');
      check(`★★★ 값을 세어 주면 눈금으로 배운다 — ${바람}`,
        배운?.무엇 === '눈금' && 배운.값.join(',') === 바람, JSON.stringify(배운));
    }
    /*
     * 칸 이름 조건을 뗀 대신 **아는 눈금 말인지**를 본다. 그 조건이 없으면
     * 아무 열거 문장이나(도구 이름·모델 이름 목록) 눈금으로 주워 담는다.
     */
    for (const 말 of [
      'tool_choice must be one of: auto, none, required',
      'Supported values are: gpt-4o, gpt-4o-mini, o3',
    ]) {
      check(`★★★ 눈금 말이 아닌 목록은 안 주워 담는다 — ${말.slice(0, 34)}`,
        배울전선(말, 'openai')?.무엇 !== '눈금', JSON.stringify(배울전선(말, 'openai')));
    }

    /*
     * 열거형 **값** 오류를 「칸을 안 받는다」 로 읽으면 안 된다. 서버가 거절한
     * 것은 값 하나인데 생각형식이 꺼지고 눈금까지 비워 디스크에 남았다 —
     * 그 모델에서 `/think` 는 그날부터 아무 일도 안 한다.
     */
    for (const 말 of [
      'Unsupported value: reasoning_effort does not support medium',
      'reasoning_effort must be "low" or "high"',
      "Invalid value 'medium' for reasoning_effort",
    ]) {
      check(`★★★ 값 탓을 칸 탓으로 안 읽는다 — ${말.slice(0, 38)}`,
        배울전선(말, 'openai')?.값 !== 'none', JSON.stringify(배울전선(말, 'openai')));
    }

    /*
     * ── 「값이 틀렸다」 에도 두 종류가 있다 ────────────────────────────────
     *
     *   Unsupported value: reasoning_effort does not support medium
     *     → 눈금 하나가 틀린 것. 칸을 끄면 그 모델에서 /think 가 죽는다.
     *   Invalid value: thinking.type 'adaptive' is not supported by this model
     *     → 우리가 **고른 형식**이 틀린 것. 이건 갈아타야 배운 것이 된다.
     *
     * 둘을 한 자리에서 막았다가 뒤엣것까지 막았고, **죽은규칙 검사가** 그걸
     * 잡았다 — 안 걸리는 규칙을 재는 판이 제 고침을 잡은 셈이다. 그리고 그
     * 문장은 칸 이름을 낱말이 아니라 **경로로**(`thinking.type`) 적어 준다.
     * 두 종류를 나란히 못 박아 다음에 한쪽만 조이는 일을 막는다.
     */
    for (const [말, 규격, 바람] of [
      ["Invalid value: thinking.type 'adaptive' is not supported by this model", 'anthropic', 'budget'],
      ['Unsupported value: reasoning_effort does not support medium', 'openai', null],
      ['thinking.budget_tokens must be greater than or equal to 1024', 'anthropic', null],
    ]) {
      const 배운 = 배울전선(말, 규격);
      const 잰것 = 배운 ? (배운.무엇 === '생각형식' ? 배운.값 : 배운.무엇) : null;
      check(`★★★ 형식이 틀린 것과 값이 틀린 것을 가른다 — ${String(바람)}`,
        잰것 === 바람, `${String(잰것)} ← ${말.slice(0, 56)}`);
    }

    /*
     * ③ 붙임표는 낱말 글자가 아니라 `\b` 가 걸린다. 게이트웨이가 헤더 이름을
     *    오류 문장에 얹어 주면, 멀쩡히 되던 세션 이름이 꺼진 채 디스크에 남았다.
     */
    for (const 말 of [
      'Unrecognized request argument supplied: user-agent',
      'Unrecognized request argument supplied: user_agent',
      "Invalid property 'browser-metadata-extra' in request",
    ]) {
      check(`★★★ 이름 안에 든 user·metadata 로는 세션자리를 안 끈다 — ${말.slice(-18)}`,
        배울전선(말) === null, JSON.stringify(배울전선(말)));
    }
    // 반대쪽 — 진짜 그 칸을 두고 한 말은 그대로 배워야 한다.
    check('★★★ 진짜 user 칸 거절은 그대로 배운다',
      배울전선("Unrecognized request argument supplied: 'user'")?.무엇 === '세션자리',
      JSON.stringify(배울전선("Unrecognized request argument supplied: 'user'")));
  }

  /*
   * 값 탓 중에 **하나만** 배울 것이 있다 — 받는 값을 세어 주는 문장이다.
   * 쉼표로 세는 창구도 있고 띄어쓰기로만 세는 창구도 있어서 둘 다 받는다.
   * 한쪽만 보면 다른 쪽에서는 이 문장이 「reasoning_effort 를 안 받는다」 로
   * 굴러떨어져서, 도와주려던 서버 말이 추론을 통째로 끄는 결과가 된다.
   */
  const 쉼표 = 배울전선('Invalid value for reasoning_effort: must be one of minimal, low, medium, high');
  check('★ 쉼표로 세어 주면 눈금을 배운다', 쉼표?.무엇 === '눈금' && 쉼표.값.join(',') === 'minimal,low,medium,high',
    JSON.stringify(쉼표));
  const 띄기 = 배울전선('reasoning_effort must be one of low medium high');
  check('★★ 띄어쓰기로 세어 줘도 눈금을 배운다', 띄기?.무엇 === '눈금' && 띄기.값.join(',') === 'low,medium,high',
    JSON.stringify(띄기));

  /*
   * ★ 서버가 안 받는다고 한 칸을 **도로 켜지 않는다.**
   *
   * output_config 를 못 쓴다고 배운 뒤에 생각형식을 하나 더 배우면, 딸린
   * 자리를 맞추는 줄이 output_config 를 되살렸다 — 그것도 「배운 것」 이라는
   * 표를 달고 디스크에 남았다. 서버가 안 된다고 말해 준 칸을 우리가 배웠다고
   * 적어 두는 셈이다.
   */
  const 효력끈것 = 카드고치기(
    기본카드(연결('https://gw.example.com/v1', 'anthropic', 'claude-opus-5')),
    배울전선('Unrecognized request argument supplied: output_config'));
  check('먼저 효력칸을 껐다', 효력끈것.효력칸 === null, String(효력끈것.효력칸));
  const 그뒤 = 카드고치기(효력끈것, 배울전선('thinking.budget_tokens is deprecated', 'anthropic'));
  check('★★ 껐던 칸을 도로 안 켠다', 그뒤.효력칸 === null, String(그뒤.효력칸));
  check('생각형식은 그대로 배운다', 그뒤.생각형식 === 'adaptive', String(그뒤.생각형식));

  /*
   * ── 그런데 위 규칙이 **우리가 딸려 끈 것에도** 걸리고 있었다 ────────────
   *
   * 딸린 자리를 맞추는 줄이 생각형식을 배울 때마다 효력칸도 「배운 것」 으로
   * 적는다. 그래서 처음 budget 을 배운 순간(효력칸 null) 그 표가 달리고, 그
   * 뒤에 adaptive 를 배워도 효력칸이 **영영 null 로 굳었다** — adaptive 인데
   * 눈금을 실을 칸이 없으니 생각 세기가 조용히 안 나간다(30차 리뷰).
   *
   * 서버가 껐을 때(위)와 우리가 딸려 껐을 때(아래)를 둘 다 재야 한다. 한쪽만
   * 재면 고치면서 다른 쪽을 잃는다.
   */
  {
    const 기본 = 기본카드(연결('https://gw.example.com/v1', 'anthropic', 'claude-sonnet-4-5'));
    const budget로 = 카드고치기(기본, { 무엇: '생각형식', 값: 'budget' });
    check('budget 을 배우면 효력칸은 비어야 한다', budget로.효력칸 === null, String(budget로.효력칸));
    const adaptive로 = 카드고치기(budget로, { 무엇: '생각형식', 값: 'adaptive' });
    check('★★★ 우리가 딸려 끈 것은 도로 켤 수 있다',
      adaptive로.효력칸 === 'output_config', String(adaptive로.효력칸));

    // 되살린 뒤에도 서버가 껐다는 표는 살아 있어야 한다 — 안 그러면 켤 때마다
    // 400 을 한 판씩 더 맞는다.
    const 남긴것 = 카드저장꼴(그뒤);
    const 되살린것 = 카드합치기(기본, 남긴것);
    const 되살린뒤 = 카드고치기(되살린것, { 무엇: '생각형식', 값: 'adaptive' });
    check('★★★ 서버가 껐다는 표는 저장을 건너가서도 산다',
      되살린뒤.효력칸 === null, `${String(되살린뒤.효력칸)} · 표=${JSON.stringify(남긴것?.서버가말한칸)}`);
  }
}

// ── 11. 강도가 시킨 말을 따라간다 ───────────────────────────────────────
//
// `/think max` 를 걸어 두면 「안녕」 한 마디에도 최대 추론이 돌았다. 느리고,
// 비싸고, 그 사이 프리픽스도 계속 흔들렸다. 정한 값을 **천장**으로 바꾼다.
{
  check('★ 인사 한 마디는 낮게', 자동강도('안녕', 'max') === 'low', 자동강도('안녕', 'max'));
  check('★ 고맙다는 말도 낮게', 자동강도('고마워', 'max') === 'low', 자동강도('고마워', 'max'));
  check('★ 진짜 일은 천장까지', 자동강도('src/backend/wire.js 의 눈금맞추기 고쳐줘', 'max') === 'max',
    자동강도('src/backend/wire.js 의 눈금맞추기 고쳐줘', 'max'));

  // ★ 대화가 쌓였으면 인사처럼 보여도 낮추지 않는다. 「응」 한 마디가 앞의
  //   긴 이야기를 이어받는 자리일 수 있다.
  check('★ 쌓인 대화에서는 안 낮춘다', 자동강도('응', 'max', { 대화크기: 20 }) === 'max',
    자동강도('응', 'max', { 대화크기: 20 }));

  check('★ 꺼 두면 정한 값 그대로', 자동강도('안녕', 'max', { 켜짐: false }) === 'max',
    자동강도('안녕', 'max', { 켜짐: false }));

  // ★ 천장을 넘지 않는다. low 로 정해 둔 사람에게 medium 이 나가면 안 된다.
  check('★ 천장을 넘지 않는다', 자동강도('아주 복잡한 일을 해줘 파일 여러 개 고쳐야 해', 'low') === 'low',
    자동강도('아주 복잡한 일을 해줘 파일 여러 개 고쳐야 해', 'low'));

  /*
   * ★ 화면이 「max 라고 정했는데 왜 medium 인가」 에 답할 수 있어야 한다.
   *
   * 여태는 `/think` 화면이 빈 글로 자동강도()를 불러서 늘 천장이 돌아왔고,
   * 그래서 「가벼운 말은 max 까지 낮춰 씁니다」 라는, 말이 안 되는 줄이 떴다.
   */
  check('★ 가벼운 말이 받게 될 자리를 말해 준다', 가벼운강도('max') === 'low', 가벼운강도('max'));
  check('★ 천장이 낮으면 그 아래로는 안 간다', 가벼운강도('low') === 'low', 가벼운강도('low'));
  check('★ 꺼 두면 천장 그대로', 가벼운강도('max', { 켜짐: false }) === 'max', 가벼운강도('max', { 켜짐: false }));
  check('★ off 는 off 다', 가벼운강도('off') === 'off', 가벼운강도('off'));

  check('인사인가: 안녕', 인사인가('안녕') === true);
  check('인사인가: 파일 이름이 있으면 아니다', 인사인가('안녕 src/a.js 좀 봐줘') === false);

  // 밖으로 나가는 턴에서는 강도를 고정한다 — 그 사이 값이 흔들리면
  // 프리픽스가 흔들린다.
  check('★ 고정하면 모드가 안 올린다', effortFor('max', '깊게', 'work', { 고정: true }) === 'max',
    effortFor('max', '깊게', 'work', { 고정: true }));
}

// ── 12. 화면 한 줄이 전선과 같은 말을 하는가 ────────────────────────────
{
  const 클로드 = 기본카드(연결('https://api.anthropic.com/v1', 'anthropic', 'claude-opus-5'));
  const 줄 = 전선말(클로드);
  check('전선 줄에 생각 형식이 있다', 줄.includes('adaptive'), 줄);
  check('전선 줄에 눈금이 있다', 줄.includes('xhigh'), 줄);
  check('빈 카드면 빈 줄', 전선말(null) === '', 전선말(null));

  /*
   * ── 생각을 안 켠 전선이 눈금 넷을 광고했다 ─────────────────────────────
   *
   * `gpt-4o` 카드는 생각형식이 none 인데 회사 눈금을 그대로 들고 있어서
   * 「생각 없음 · 눈금 minimal·low·medium·high」 라고 떴다. 읽는 사람은 눈금을
   * 고를 수 있다고 믿지만 나가는 칸이 아예 없다.
   *
   * 배워서 none 이 된 카드는 눈금을 비우고(카드고치기) 짐작으로 none 인 카드는
   * 안 비워서, 같은 파일 두 갈래가 화면에 서로 다른 말을 했다(30차 리뷰).
   */
  const 사오 = 기본카드(연결('https://api.openai.com/v1', 'openai', 'gpt-4o'));
  const 사오줄 = 전선말(사오);
  check('생각 없음이면 눈금을 안 적는다',
    사오.생각형식 === 'none' && !/minimal|low|medium|high/.test(사오줄), `${사오.생각형식} · ${사오줄}`);
  check('★★★ 값은 안 지운다 — 나중에 켜면 다시 뜻이 있다',
    사오.눈금.length > 0, JSON.stringify(사오.눈금));
  // 반대쪽 — 생각을 켠 전선에서는 눈금이 그대로 보여야 한다.
  const 오 = 기본카드(연결('https://api.openai.com/v1', 'openai', 'gpt-5'));
  check('생각을 켜면 눈금이 보인다',
    오.생각형식 === 'effort' && /minimal/.test(전선말(오)), `${오.생각형식} · ${전선말(오)}`);
  적어둘것.push('전선 줄: ' + 줄);

  // ★ 전선에 나가는 글자는 옮기지 않는다 — 옮기면 화면과 몸이 달라진다.
  언어정하기('en');
  const 영어줄 = 전선말(클로드);
  check('★ 영어 화면에도 한국어가 없다', !/[가-힣]/.test(영어줄), 영어줄);
  check('★ 그래도 나가는 글자는 그대로다', 영어줄.includes('adaptive') && 영어줄.includes('xhigh'), 영어줄);
  적어둘것.push('영어 줄: ' + 영어줄);
  언어정하기('ko');
}

/*
 * ══ 캐시를 정하는 것은 **창구가 아니라 모델**이다 ═══════════════════════
 *
 * 여기는 「bedrock·gemini·azure 는 서버가 알아서 앞머리를 캐시한다」 고 믿고
 * 표식을 안 붙였다. Claude 앞에서 그게 틀린다 — Claude 의 캐시는 자라는
 * 앞머리 캐시가 아니라 **표식으로 끊는 방식**이라, 표식이 없으면 서버가
 * 기본으로 잡아 주는 앞머리에서 멈춘다. 실제로 대화가 6k→59k 로 자라는 동안
 * 읽힌 것이 5.9k 에 못 박혀 있었고 새로 쓴 것은 계속 0 이었다.
 *
 * 창구 이름으로 가르면 창구마다 예외가 하나씩 는다. 모델로 가른다.
 */
trace('캐시-모델로가른다');
{
  const 만틀 = 기본카드(연결('https://bedrock-mantle.us-west-2.api.aws/openai/v1', 'openai', 'anthropic.claude-opus-5'));
  check('★★ OpenAI 꼴이어도 Claude 면 표식을 붙인다', 만틀.캐시 === 'explicit', 만틀.캐시);
  check('그 창구의 최소 크기도 따라간다', 만틀.캐시최소 === 4096, String(만틀.캐시최소));

  // 모르는 사내 게이트웨이도 마찬가지다 — 아는 것은 모델 이름뿐이고, 그거면 된다.
  const 사내 = 기본카드(연결('https://llm.내회사.example/v1', 'openai', 'claude-opus-5'));
  check('★★ 모르는 게이트웨이라도 Claude 면 붙인다', 사내.캐시 === 'explicit', 사내.캐시);

  // 같은 창구라도 Claude 가 아니면 여태대로 둔다. 넓히다 멀쩡한 것을 깨면 안 된다.
  const 노바 = 기본카드(연결('https://bedrock-mantle.us-west-2.api.aws/openai/v1', 'openai', 'amazon.nova-pro'));
  check('★ Claude 가 아니면 안 건드린다', 노바.캐시 === 'auto', 노바.캐시);

  // OpenAI 직통은 제 칸이 따로 있다(prompt_cache_key). 거기는 서버가 알아서 한다.
  const 직통 = 기본카드(연결('https://api.openai.com/v1', 'openai', 'gpt-5'));
  check('★ OpenAI 직통은 제 칸 그대로', 직통.캐시 === 'key', 직통.캐시);

  // Anthropic 직통은 원래 붙이던 대로.
  const 직 = 기본카드(연결('https://api.anthropic.com/v1', 'anthropic', 'claude-opus-5'));
  check('Anthropic 직통은 그대로', 직.캐시 === 'explicit', 직.캐시);
}

/*
 * ══ 「이 칸을 모른다」 가 「캐시를 못 한다」 는 뜻은 아니다 ═══════════════
 *
 * 같은 뜻을 두 규격이 다른 이름으로 적는다 — `cache_control` 은 Anthropic
 * 규격, `prompt_cache_breakpoint` 는 OpenAI 규격의 칸이다. 첫 거절에 바로
 * 끄면 받을 수 있었던 창구에서도 캐시를 영영 안 쓰게 되고, 그건 조용히
 * 비싸지는 쪽이라 화면에 아무 표시도 안 난다.
 */
trace('캐시-두이름');
{
  const 한번 = 배울전선("Unrecognized request argument supplied: cache_control");
  check('★★ 첫 거절에는 다른 이름으로 바꿔 본다',
    한번?.무엇 === '표식칸' && 한번?.값 === 'prompt_cache_breakpoint', JSON.stringify(한번));

  const 두번 = 배울전선("Unrecognized request argument supplied: prompt_cache_breakpoint");
  check('★★ 그것까지 거절당하면 끈다', 두번?.무엇 === '캐시' && 두번?.값 === 'none', JSON.stringify(두번));

  // 배운 것이 카드에 앉고, 남길 때도 그 칸이 남는다.
  const 카드0 = 기본카드(연결('https://llm.내회사.example/v1', 'openai', 'claude-opus-5'));
  const 카드1 = 카드고치기(카드0, 한번);
  check('배운 칸이 카드에 앉는다', 카드1.표식칸 === 'prompt_cache_breakpoint', 카드1.표식칸);
  check('배운 것으로 세어진다', (카드1.배운칸 ?? []).includes('표식칸'), JSON.stringify(카드1.배운칸));
  const 남긴것 = 카드저장꼴(카드1);
  check('★ 디스크에도 그 칸이 남는다', 남긴것?.표식칸 === 'prompt_cache_breakpoint', JSON.stringify(남긴것));

  const 카드2 = 카드고치기(카드1, 두번);
  check('두 번째 거절 뒤에는 꺼진다', 카드2.캐시 === 'none', 카드2.캐시);

  // 값 탓은 여기서도 아무것도 안 배운다 (크기가 모자란다는 말은 칸 이야기가 아니다).
  check('★ 값 탓으로는 안 배운다',
    배울전선('cache_control blocks must be at least 1024 tokens') === null,
    JSON.stringify(배울전선('cache_control blocks must be at least 1024 tokens')));
}

// ── 14. `/think off` 가 전선에서도 꺼지는가 ─────────────────────────────
//
// 화면에 off 라고 적어 두고 실제로는 생각이 도는 자리가 있었다. 규격마다
// 「끈다」 를 적는 법이 달라서다:
//
//   ollama     think: false        칸을 안 실으면 **모델 기본값**(켜짐)이다
//   anthropic  thinking 을 뺀다     빼는 것이 곧 끄는 것이다
//   openai꼴   reasoning_effort     창구가 알려 준 끄는 말(minimal·none)
//
// ollama 자리가 비어 있었다 — `강도말('off')` 이 null 이라 아무것도 안 실었고,
// 그건 이 규격에서 「알아서 해라」 라는 뜻이다.
{
  const 몸 = (conn, think) => buildBody(conn.kind, {
    model: conn.model, messages: [{ role: 'user', content: '안녕' }],
    think, maxTokens: 4096, 카드: 기본카드(conn),
  });

  const 올라마 = 연결('http://localhost:11434', 'ollama', 'qwen3:8b');
  check('★★ ollama: off 는 끄라고 보낸다', 몸(올라마, 'off').think === false,
    JSON.stringify(몸(올라마, 'off').think));
  check('ollama: 켜면 눈금이 나간다', 몸(올라마, 'high').think === 'high',
    JSON.stringify(몸(올라마, 'high').think));

  const 클로드 = 연결('https://api.anthropic.com/v1', 'anthropic', 'claude-opus-5');
  const 클로드몸 = 몸(클로드, 'off');
  check('★ anthropic: off 면 thinking 칸이 아예 없다',
    클로드몸.thinking === undefined, JSON.stringify(클로드몸.thinking));
  check('anthropic: 켜면 thinking 이 있다', 몸(클로드, 'high').thinking != null);

  const 오픈 = 연결('https://api.openai.com/v1', 'openai', 'o3');
  check('★ openai: off 는 그 창구가 아는 끄는 말로 나간다',
    몸(오픈, 'off').reasoning_effort === 'minimal', String(몸(오픈, 'off').reasoning_effort));

  /*
   * ★ 못 끄는 자리 — 여기서 화면이 거짓말을 하기 시작한다.
   *
   * 모르는 게이트웨이 뒤의 추론 모델은 끄는 말을 우리가 모른다. 칸을 안
   * 실으면 서버 기본값으로 돈다. 못 끄는 것 자체는 어쩔 수 없지만,
   * **못 끈다는 사실을 화면이 말해야 한다** — 그 줄을 commands.js 가
   * `카드.생각형식 === 'effort' && 끄는말 없음` 으로 고른다. 그 두 조건이
   * 실제로 이 자리에서 참인지 여기서 못 박는다.
   */
  const 모르는곳 = 연결('https://gw.example.com/v1', 'openai', 'gpt-5');
  const 모르는카드 = 기본카드(모르는곳);
  check('★★ 못 끄는 자리를 화면이 알아볼 수 있다',
    모르는카드.생각형식 === 'effort' && !모르는카드.끄는말
    && 눈금맞추기(모르는카드, 'off') === null,
    `${모르는카드.생각형식} · ${모르는카드.끄는말}`);
  check('그 자리에서는 칸을 안 싣는다', 몸(모르는곳, 'off').reasoning_effort === undefined,
    String(몸(모르는곳, 'off').reasoning_effort));

  // 네 말 모두 그 줄을 가지고 있어야 한다 — 한 말에만 있으면 다른 말로 켠
  // 사람은 못 끈다는 사실을 영영 못 본다. 말모두() 는 열쇠가 빠진 말이 있으면
  // 그만큼 짧은 목록을 준다 (없는 자리는 열쇠 그 자체로 떨어진다).
  const 못끈다는줄 = 말모두('think.wireNoOff');
  check('★★ 네 말 모두 못 끈다는 줄이 있다',
    못끈다는줄.length === 4 && !못끈다는줄.includes('think.wireNoOff'),
    `${못끈다는줄.length}개`);
}

// ── 12. 모드가 강도를 낮추는 자리 ───────────────────────────────────────
//
// ★★ 여기가 조용히 제일 비쌌던 자리다.
//
// 묻기 모드는 think 가 low 다. "이 함수 뭐야?" 에는 맞는 값이다. 그런데
// 무엇이 묻기로 가는지는 낱말이 정하고(route.js), "…설명해줘" 한 마디면
// 간다. 그래서 파일 열 개를 읽고 경합 조건을 짚어야 하는 일까지 low 로
// 돌았다 — 같은 질문을 깊게 본 쪽과 견주면 생각 블록이 0자 대 165,000자였다.
//
// 값이 5분의 1이면 싼 것이지만, 답이 다르면 싼 게 아니다.
{
  const 진짜있었던말 = [
    '이 프로젝트의 공동작업 기능을 분석해서 동시 편집 시 데이터 손실, 덮어쓰기,',
    '충돌 또는 상태 불일치가 발생할 가능성이 있는 부분을 찾아줘.',
    '실제 코드 근거가 있는 문제만 제시하고 각 문제마다 관련 파일과 함수를 설명해줘.',
    '최대 5개까지만 찾아줘.',
  ].join('\n');

  check('★ 시킨 것이 여럿이면 깊이 볼 일이다', 무거운가(진짜있었던말) === true);
  check('한 줄짜리 물음은 아니다', 무거운가('이 함수 뭐야?') === false);
  check('인사도 아니다', 무거운가('안녕') === false);
  check('짧아도 살펴보라는 말이면 깊이 볼 일이다',
    무거운가('공동작업 쪽에 경합 조건 있는지 좀 봐줘') === true);

  check('★★ 무거운 말에는 모드가 강도를 못 낮춘다',
    천장고르기('low', 'medium', 진짜있었던말) === 'medium',
    천장고르기('low', 'medium', 진짜있었던말));
  check('★ 가벼운 말에는 여전히 낮춘다 — 그 값이 옳은 자리다',
    천장고르기('low', 'medium', '이 함수 뭐야?') === 'low',
    천장고르기('low', 'medium', '이 함수 뭐야?'));
  check('★ 모드가 더 세게 보라고 하면 그대로 따른다',
    천장고르기('high', 'medium', '구조 어떻게 바꿔') === 'high');
  check('모드가 정한 값이 없으면 사람이 정한 값 그대로',
    천장고르기(null, 'xhigh', '아무 말') === 'xhigh');
  /*
   * ★★ 끈 것은 모드가 못 켠다.
   *
   * off 는 기본값이 아니라 사람이 고른 값이다. 여기서 켜 주면 "생각 끄기" 가
   * 모드에 따라 안 지켜지는 셈이고, 그건 화면에 아무 표시도 없이 값이 나가는
   * 모양이다 — 이 파일이 재는 것이 전부 그런 자리다.
   */
  check('★★ 끈 것은 모드가 못 켠다', 천장고르기('high', 'off', '분석해줘') === 'off',
    천장고르기('high', 'off', '분석해줘'));
}


// ── 채팅을 보내는 자리는 전부 이름을 단다 (소스 래칫) ────────────────────
//
// 위의 검사들은 「이름을 주면 머리에 붙는다」 를 잰다. 그런데 실제로 샌 자리는
// 그게 아니었다 — **부르는 쪽이 이름을 아예 안 줬다.** probe.js 의 진단 여덟
// 번과 /consult 한 번이 그랬다. 둘 다 진짜 채팅 완성이고, 둘 다 게이트웨이
// 대시보드에 정체 모를 단발 요청으로 쌓였다.
//
// 그 종류는 단위 검사로 못 잡는다. 함수는 멀쩡했다. 그래서 **소스를 본다** —
// 더할머리( 를 부르면서 두 번째 인자를 안 주는 자리가 있나.
//
// 봐주는 자리를 목록으로 둔다. 목록에 적는 것과 그냥 빠뜨리는 것은 다르다.
// 적으려면 왜 봐주는지 여기에 한 줄을 쓰게 되고, 그 한 줄이 없으면 다음 사람이
// 목록을 못 늘린다.
{
  // 파일 이름만 적지 않고 **몇 자리인지도 적는다.** 파일로만 봐주면 그 파일에
  // 채팅을 보내는 자리가 새로 생겨도 조용히 통과한다 — 봐주기가 구멍이 된다.
  const 봐줄곳 = new Map([
    // 모델 제원만 묻는다 — /models · /props · /info. 대화가 아니라 세션에
    // 묶일 것이 없고, 묶으면 오히려 대화 하나에 진단 줄이 섞인다.
    ['src/backend/ctxsize.js', { 왜: '모델 제원 조회 (/models · /props · /info)', 몇: 1 }],
    // /model 이 고를 목록을 받아 오는 두 자리 — 여느 목록과 Azure 배포 목록.
    ['src/commands.js', { 왜: '모델 목록 조회 (/models · Azure 배포 목록)', 몇: 2 }],
  ]);

  const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');
  const 훑기 = (d, 모은것 = []) => {
    for (const 것 of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, 것.name);
      if (것.isDirectory()) 훑기(p, 모은것);
      else if (것.name.endsWith('.js')) 모은것.push(p);
    }
    return 모은것;
  };

  const 맨손 = [];
  const 봐준수 = new Map();
  for (const p of 훑기(join(뿌리, 'src'))) {
    const 이름 = relative(뿌리, p).replace(/\\/g, '/');
    const 글 = readFileSync(p, 'utf8');
    for (const m of 글.matchAll(/더할머리\(([^)]*)\)/g)) {
      // 정의하는 자리(export function 더할머리)는 부르는 자리가 아니다.
      if (/export function/.test(글.slice(Math.max(0, m.index - 20), m.index))) continue;
      const 인자 = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      if (인자.length >= 2) continue;
      if (봐줄곳.has(이름)) { 봐준수.set(이름, (봐준수.get(이름) ?? 0) + 1); continue; }
      맨손.push(`${이름} — 더할머리(${m[1]})`);
    }
  }
  check('★★ 채팅을 보내는 자리는 전부 대화 이름을 단다', 맨손.length === 0, 맨손.join(' · '));

  // 봐주기 목록이 낡지 않게 — 적어 둔 파일이 없어졌으면 여기서 말한다.
  const 어긋난것 = [];
  for (const [f, 것] of 봐줄곳) {
    if (!existsSync(join(뿌리, f))) { 어긋난것.push(`${f} — 파일이 없어졌습니다`); continue; }
    const 센것 = 봐준수.get(f) ?? 0;
    if (센것 !== 것.몇) 어긋난것.push(`${f} — 적어 둔 ${것.몇}자리인데 ${센것}자리`);
  }
  check('★ 봐주기 목록이 실제와 맞는다', 어긋난것.length === 0, 어긋난것.join(' · '));
}

// ── 마무리 ──────────────────────────────────────────────────────────────
const C = (n, s) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[${n}m${s}\x1b[0m` : s);
console.log('');
for (const f of fail) console.log(`  ${C(31, '✗')} ${f.name}${f.note ? C(90, `  ${f.note}`) : ''}`);
for (const 글 of 적어둘것) console.log(`  ${C(90, `· ${글}`)}`);
console.log('');
console.log(`  ${pass.length}개 통과 · ${fail.length}개 실패`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

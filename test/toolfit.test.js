/**
 * 보내기 직전에 회사 규격으로 다듬는가 (backend/toolfit.js).
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────────────
 *
 * 이 기능은 **안 하는 것**이 절반이다. 모르는 주소로 갈 때 도구를 건드리면,
 * 지금 멀쩡히 쓰고 있는 로컬 모델·사내 게이트웨이가 그날로 달라진다. 그래서
 * 「깎았나」 보다 「안 깎았나」 를 먼저 잰다.
 *
 * 그 다음이 되돌리기다. 이름을 고쳐 보내 놓고 안 되돌리면, 모델이 도구를
 * 부르는데 우리는 못 알아듣는다 — 오류도 안 나고 도구만 조용히 안 불린다.
 */
import { 벤더, 도구맞추기, 이름되돌리기 } from '../src/backend/toolfit.js';
import { toolSchemas } from '../src/tools/index.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 연결 = (base, 더 = {}) => ({ base, kind: 'openai', model: 'm', ...더 });

trace('1-어디로-가는지는-주소로');

{
  check('Anthropic 직통', 벤더(연결('https://api.anthropic.com/v1')) === 'anthropic');
  check('Gemini 직통', 벤더(연결('https://generativelanguage.googleapis.com/v1beta/openai/')) === 'gemini');
  check('Bedrock 직통', 벤더(연결('https://bedrock-runtime.ap-northeast-2.amazonaws.com/v1')) === 'bedrock');
  check('OpenAI 직통', 벤더(연결('https://api.openai.com/v1')) === 'openai');
  check('Azure OpenAI', 벤더(연결('https://our.openai.azure.com/openai')) === 'openai');

  /*
   * ★ 모르는 주소면 null 이다.
   *
   * 이 프로그램이 제일 많이 서는 자리가 여기다. 여기서 뭔가를 짐작하기
   * 시작하면, 다듬을 까닭이 없는 곳까지 다듬게 된다.
   */
  check('★ 로컬은 모른다', 벤더(연결('http://127.0.0.1:1234/v1')) === null);
  check('★ 사내 게이트웨이도 모른다', 벤더(연결('https://ai-gw.corp.example/v1')) === null);
  check('★ 주소가 없어도 안 죽는다', 벤더({}) === null);

  /*
   * ★ amazonaws 아래에는 남의 것이 훨씬 많다.
   *
   * 호스트 끝만 보고 Bedrock 이라고 하면, S3 를 앞에 세운 게이트웨이가
   * Bedrock 취급을 받는다.
   */
  check('★ S3 는 Bedrock 이 아니다', 벤더(연결('https://s3.ap-northeast-2.amazonaws.com/x')) === null);
  check('★ 남의 anthropic 도메인이 아니다', 벤더(연결('https://notanthropic.com/v1')) === null);

  // 주소를 못 읽을 때만 규격을 본다.
  check('주소가 없으면 규격을 본다', 벤더({ kind: 'anthropic' }) === 'anthropic');
  check('주소가 있으면 주소가 이긴다',
    벤더({ base: 'https://ai-gw.corp.example/v1', kind: 'anthropic' }) === null);
}

trace('2-모르는-주소면-아무것도-안-바꾼다');

{
  const 도구 = toolSchemas(null, { hasSkills: false, web: true });
  const r = 도구맞추기(도구, 연결('http://127.0.0.1:1234/v1'));
  check('★ 목록을 그대로 돌려준다', r.tools === 도구);
  check('★ 되돌림 표가 아예 없다', r.되돌림 === null);
  check('손본 것이 0', r.손본것.이름 === 0 && r.손본것.스키마 === 0);

  check('빈 목록도 안 죽는다', 도구맞추기([], 연결('https://api.openai.com/v1')).tools.length === 0);
  check('null 도 안 죽는다', 도구맞추기(null, 연결('https://api.openai.com/v1')).tools === null);
}

trace('3-우리-도구는-어디로-보내도-그대로');

{
  /*
   * ★ 우리 도구 스키마는 이미 규격 안에 있다.
   *
   * 여기서 뭔가 바뀐다면 그건 다듬기가 과한 것이다 — 우리가 쓰는 열쇠는
   * type·description·properties·required·items·enum 뿐이고, 이름도 전부
   * 영문이다. 이 검사가 무너지면 MCP 를 안 쓰는 사람 화면까지 달라진다.
   */
  const 도구 = toolSchemas(null, { hasSkills: false, web: true });
  for (const 주소 of [
    'https://api.anthropic.com/v1',
    'https://generativelanguage.googleapis.com/v1beta/openai/',
    'https://bedrock-runtime.ap-northeast-2.amazonaws.com/v1',
    'https://api.openai.com/v1',
  ]) {
    const r = 도구맞추기(도구, 연결(주소));
    const 뜻이같나 = JSON.stringify(r.tools) === JSON.stringify(도구);
    check(`★ 우리 도구는 안 깎인다 — ${new URL(주소).hostname}`, 뜻이같나 && r.되돌림 === null,
      `이름 ${r.손본것.이름} · 스키마 ${r.손본것.스키마}`);
  }
}

trace('4-제미니가-못-받는-열쇠');

{
  // MCP 서버가 흔히 주는 모양. 우리가 쓰는 열쇠가 아니라 남이 준 것이다.
  const 남의것 = [{
    type: 'function',
    function: {
      name: 'mcp__srv__find',
      description: '[srv] find',
      parameters: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', format: 'uri', description: '주소' },
          when: { type: 'string', format: 'date-time' },
          many: { type: ['string', 'null'] },
          how: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          deep: { type: 'object', properties: { n: { type: 'integer', minimum: 0 } } },
        },
        required: ['url'],
      },
    },
  }];

  const g = 도구맞추기(남의것, 연결('https://generativelanguage.googleapis.com/v1beta/openai/'));
  const p = g.tools[0].function.parameters;

  check('★ $schema 를 뺀다', p.$schema === undefined);
  check('★ additionalProperties 를 뺀다', p.additionalProperties === undefined);
  check('★ oneOf 를 뺀다', p.properties.how.oneOf === undefined);
  check('모르는 format 은 뺀다', p.properties.url.format === undefined, String(p.properties.url.format));
  check('아는 format 은 남긴다', p.properties.when.format === 'date-time');

  /*
   * ★ 빼고 나서 갈래가 없어지면 되짚어 준다.
   *
   * oneOf 만 있던 자리는 열쇠를 빼면 빈 것이 된다. 빈 마디를 그대로 보내면
   * 모델이 그 인자에 무엇을 넣어야 하는지 모른 채로 부른다.
   */
  check('★ 빈 마디를 안 남긴다', p.properties.how.type === 'string', JSON.stringify(p.properties.how));
  check('★ 널 갈래는 nullable 로 옮긴다',
    p.properties.many.type === 'string' && p.properties.many.nullable === true,
    JSON.stringify(p.properties.many));
  check('안쪽까지 훑는다', p.properties.deep.properties.n.minimum === 0);

  // 뜻은 그대로 남는다. 깎는 것이 목적이 아니다.
  check('설명은 그대로', p.properties.url.description === '주소');
  check('required 는 그대로', JSON.stringify(p.required) === JSON.stringify(['url']));
  check('스키마를 손봤다고 셌다', g.손본것.스키마 === 1, String(g.손본것.스키마));

  /*
   * ★ 같은 스키마라도 Anthropic 으로는 안 깎는다.
   *
   * 확인 못 한 것을 깎으면, 잘 쓰던 MCP 도구의 뜻이 조용히 얕아진다.
   */
  const a = 도구맞추기(남의것, 연결('https://api.anthropic.com/v1'));
  check('★ Anthropic 에는 스키마를 안 건드린다',
    a.tools[0].function.parameters.additionalProperties === false,
    JSON.stringify(a.손본것));
}

trace('5-이름을-고치면-되돌린다');

{
  const 이상한이름 = 'mcp__사내.서버__파일 읽기';
  const 긴이름 = 'mcp__' + 'a'.repeat(70) + '__go';
  const 목록 = [
    { type: 'function', function: { name: 이상한이름, description: 'x', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 긴이름, description: 'y', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'Read', description: 'z', parameters: { type: 'object', properties: {} } } },
  ];
  const r = 도구맞추기(목록, 연결('https://api.openai.com/v1'));
  const 이름들 = r.tools.map((t) => t.function.name);

  const 규칙 = /^[a-zA-Z0-9_-]{1,64}$/;
  check('★ 보내는 이름이 모두 규격에 맞다', 이름들.every((n) => 규칙.test(n)), 이름들.join(' · '));
  check('★ 멀쩡한 이름은 안 바꾼다', 이름들[2] === 'Read');
  check('되돌림 표에 고친 것만 있다', r.되돌림.size === 2, String(r.되돌림.size));
  check('★ 표를 보면 원래 이름이 나온다', r.되돌림.get(이름들[0]) === 이상한이름);
  check('★ 긴 이름도 되짚을 수 있다', r.되돌림.get(이름들[1]) === 긴이름);

  /*
   * ★ 잘라서 같아지면 안 된다.
   *
   * 64자를 그냥 자르면 앞이 같은 두 도구가 한 이름이 된다. 그러면 모델이
   * 부른 것이 어느 쪽인지 우리가 못 고른다 — 잘리는 것보다 나쁘다.
   */
  const 앞이같은둘 = ['read', 'write'].map((끝) => ({
    type: 'function',
    function: { name: 'mcp__' + 'b'.repeat(70) + '__' + 끝, parameters: { type: 'object', properties: {} } },
  }));
  const 둘 = 도구맞추기(앞이같은둘, 연결('https://api.openai.com/v1'));
  const 둘이름 = 둘.tools.map((t) => t.function.name);
  check('★ 앞이 같아도 이름이 안 겹친다', 둘이름[0] !== 둘이름[1], 둘이름.join(' · '));
  check('둘 다 되짚을 수 있다',
    둘.되돌림.get(둘이름[0]) === 앞이같은둘[0].function.name
    && 둘.되돌림.get(둘이름[1]) === 앞이같은둘[1].function.name);

  /*
   * ★ 겹치지 않는 것만으로는 모자란다 — **모델이 구별할 수 있어야 한다.**
   *
   * 우리 쪽은 뒤에 번호를 붙여 겹침을 면할 수 있다. 그런데 모델이 보는
   * 이름이 `mcp__bbb…bbb` 와 `mcp__bbb…bb_2` 라면, 어느 것이 읽기고 어느
   * 것이 쓰기인지 알 길이 없다. 모델은 아무거나 고르고, 그건 오류도 안 난다.
   */
  check('★ 잘린 이름에도 도구 이름이 남는다',
    둘이름[0].endsWith('read') && 둘이름[1].endsWith('write'), 둘이름.join(' · '));
  check('앞의 서버 자리도 남는다', 둘이름.every((n) => n.startsWith('mcp__')));

  // 되돌리기 — 두 모양 다.
  const 되돌린것 = 이름되돌리기({ toolCalls: [{ id: 'c1', name: 이름들[0], args: {} }] }, r.되돌림);
  check('★ 답에 실린 이름이 원래대로 돌아온다', 되돌린것.toolCalls[0].name === 이상한이름);
  const 함수꼴 = 이름되돌리기({ toolCalls: [{ id: 'c1', function: { name: 이름들[1], arguments: '{}' } }] }, r.되돌림);
  check('function 모양도 되돌린다', 함수꼴.toolCalls[0].function.name === 긴이름);

  /*
   * ★ 표에 없는 이름은 그대로 둔다.
   *
   * 표에 없다고 지우거나 비우면, 다듬을 일이 없던 도구까지 못 부르게 된다.
   */
  const 안바꾼것 = { toolCalls: [{ id: 'c1', name: 'Read', args: {} }] };
  check('★ 표에 없는 이름은 안 건드린다', 이름되돌리기(안바꾼것, r.되돌림).toolCalls[0].name === 'Read');
  check('표가 없으면 그대로 돌려준다', 이름되돌리기(안바꾼것, null) === 안바꾼것);
  check('도구를 안 불렀으면 그대로', 이름되돌리기({ content: 'x' }, r.되돌림).content === 'x');
}

trace('6-인자는-객체여야-한다');

{
  // Anthropic·Bedrock 은 input_schema 가 객체가 아니면 요청을 통째로 거절한다.
  const 이상한것 = [{ type: 'function', function: { name: 'x', description: 'd', parameters: { type: 'string' } } }];
  for (const [주소, 회사] of [
    ['https://api.anthropic.com/v1', 'Anthropic'],
    ['https://bedrock-runtime.us-east-1.amazonaws.com/v1', 'Bedrock'],
  ]) {
    const r = 도구맞추기(이상한것, 연결(주소));
    check(`★ ${회사}: 객체가 아니면 객체로 만든다`, r.tools[0].function.parameters.type === 'object',
      JSON.stringify(r.tools[0].function.parameters));
  }
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n회사별 도구 다듬기 검사  ${D}(모르는 곳은 안 건드리는가 · 고친 이름을 되돌리는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

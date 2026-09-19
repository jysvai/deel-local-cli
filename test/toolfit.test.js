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
  /*
   * ★ Azure 를 OpenAI 직통과 **다른 이름**으로 부른다.
   *
   * 도구를 다듬는 데는 둘이 똑같다(아래에서 그걸 잰다). 갈리는 자리는
   * 몸통이다 — OpenAI 직통의 추론 모델은 출력 상한의 옛 이름(`max_tokens`)을
   * 「지원 안 하는 인자」 라고 튕기는데, Azure 는 옛 판이 아직 많아서 그 이름
   * 만 본다. 한 이름으로 묶어 두면 한쪽을 고치는 순간 다른 쪽이 끊긴다.
   */
  check('★ Azure 는 OpenAI 직통과 따로 센다', 벤더(연결('https://our.openai.azure.com/openai')) === 'azure',
    String(벤더(연결('https://our.openai.azure.com/openai'))));
  check('배포 주소 모양도 Azure 로 센다',
    벤더(연결('https://x.openai.azure.com/openai/deployments/d?api-version=2024-10-21')) === 'azure');
  // 이름이 갈렸다고 다듬기가 갈리면 안 된다. 둘 다 이름만 손보고 스키마는 안 건드린다.
  {
    const 도구 = [{ type: 'function', function: { name: 'a b', parameters: { type: 'object', properties: { x: { $ref: '#/d' } } } } }];
    const o = 도구맞추기(도구, 연결('https://api.openai.com/v1'));
    const z = 도구맞추기(도구, 연결('https://our.openai.azure.com/openai'));
    check('★ Azure 와 OpenAI 직통의 다듬기가 같다',
      JSON.stringify(o.tools) === JSON.stringify(z.tools)
      && o.손본것.이름 === z.손본것.이름 && o.손본것.스키마 === z.손본것.스키마 && z.손본것.스키마 === 0,
      `${JSON.stringify(o.손본것)} / ${JSON.stringify(z.손본것)}`);
  }

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
  // oneOf 는 이제 anyOf 로 옮겨 적는다(아래 블록). 갈래가 남아 있으면 빈 마디가 아니다.
  check('★ 빈 마디를 안 남긴다',
    p.properties.how.type === 'string' || p.properties.how.anyOf?.length === 2, JSON.stringify(p.properties.how));
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

{
  // ★ 속성 없이 additionalProperties 만 적은 자리는 「아무 키나 받는 객체」 다.
  // string 으로 떨어뜨리면 모델이 객체 대신 글을 넣어 부르고, 그 도구는 인자가 틀렸다고만 한다.
  const 자유 = [{
    type: 'function',
    function: {
      name: 'mcp__srv__put', description: 'put',
      parameters: { type: 'object', properties: { meta: { description: '아무 키', additionalProperties: { type: 'string' } } } },
    },
  }];
  const g = 도구맞추기(자유, 연결('https://generativelanguage.googleapis.com/v1beta/openai/'));
  const meta = g.tools[0].function.parameters.properties.meta;
  check('★ additionalProperties 만 적은 자리는 객체로 되짚는다', meta.type === 'object', JSON.stringify(meta));
}

{
  /*
   * ★★ oneOf 는 버리지 않고 anyOf 로 옮겨 적는다.
   *
   * Gemini 스키마는 oneOf 를 모르고 anyOf 는 안다(제미니열쇠). 그런데 oneOf 를
   * 그냥 빼면 그 자리가 빈 마디가 되어 **string** 으로 떨어졌다. 갈래가 객체
   * 둘이면 뜻이 뒤집힌다 — 모델은 객체 대신 글을 넣어 부르고, 그 도구는 인자가
   * 틀렸다고만 한다. 「정확히 하나」 가 「하나 이상」 으로 느슨해질 뿐, 받는
   * 모양은 그대로 남는다.
   */
  const 갈래 = [{
    type: 'function',
    function: {
      name: 'mcp__srv__pick', description: 'pick',
      parameters: {
        type: 'object',
        properties: {
          mode: { oneOf: [
            { type: 'object', properties: { a: { type: 'string' } } },
            { type: 'object', properties: { b: { type: 'number' } }, additionalProperties: false },
          ] },
        },
      },
    },
  }];
  const g = 도구맞추기(갈래, 연결('https://generativelanguage.googleapis.com/v1beta/openai/'));
  const mode = g.tools[0].function.parameters.properties.mode;
  check('★★ 객체 갈래 둘인 oneOf 가 string 으로 안 떨어진다', mode.type !== 'string', JSON.stringify(mode));
  check('★★ 갈래를 anyOf 로 옮겨 적는다',
    mode.anyOf?.length === 2 && mode.anyOf.every((s) => s.type === 'object') && mode.anyOf[1].properties?.b?.type === 'number',
    JSON.stringify(mode));
  check('★ 옮긴 갈래 안쪽도 다듬는다', mode.anyOf?.[1]?.additionalProperties === undefined && mode.oneOf === undefined,
    JSON.stringify(mode));
}

{
  /*
   * ★★ $ref 는 가리키는 정의로 풀어 적는다.
   *
   * pydantic 같은 도구가 만든 MCP 스키마는 중첩 모델을 `$defs` + `$ref` 로 적는다.
   * Gemini 스키마는 $ref 를 모른다. 여태 그 열쇠를 빼기만 해서 마디가 비었고, 빈
   * 마디는 **string** 으로 떨어졌다 — 객체를 받는 인자에 모델이 글을 넣어 부른다.
   */
  const 참조 = [{
    type: 'function',
    function: {
      name: 'mcp__srv__deep', description: 'deep',
      parameters: {
        type: 'object',
        $defs: {
          Opt: { type: 'object', properties: { depth: { type: 'integer' } }, required: ['depth'] },
          Node: { type: 'object', properties: { child: { $ref: '#/$defs/Node' } } },
        },
        definitions: { Old: { type: 'string', enum: ['a', 'b'] } },
        properties: {
          opt: { $ref: '#/$defs/Opt', description: '옵션' },
          list: { type: 'array', items: { $ref: '#/definitions/Old' } },
          tree: { $ref: '#/$defs/Node' },
        },
      },
    },
  }];
  const g = 도구맞추기(참조, 연결('https://generativelanguage.googleapis.com/v1beta/openai/'));
  const p = g.tools[0].function.parameters;
  check('★★ $ref 마디가 가리키는 객체로 풀린다',
    p.properties.opt.type === 'object' && p.properties.opt.properties?.depth?.type === 'integer', JSON.stringify(p.properties.opt));
  check('★ 곁에 적힌 설명은 남는다', p.properties.opt.description === '옵션', JSON.stringify(p.properties.opt));
  check('★ definitions 쪽 옛 이름도 푼다',
    p.properties.list.items?.type === 'string' && p.properties.list.items?.enum?.length === 2, JSON.stringify(p.properties.list));
  check('★★ 자기를 가리키는 정의도 끝없이 풀지 않는다',
    JSON.stringify(p).length < 20000 && p.properties.tree.type === 'object', `${JSON.stringify(p).length}자`);
  check('$defs · definitions 는 안 나간다', p.$defs === undefined && p.definitions === undefined);
}

{
  /*
   * ★★ 고친 이름이 목록에 이미 있는 **진짜** 이름과 같아지지 않는다.
   *
   * 지문을 붙인 이름(`a_b_4m7u2a`)을 다른 도구가 제 이름으로 쓰고 있으면, 고칠 것이
   * 앞에 올 때 둘이 같은 이름으로 나갔다. 여태 겹침은 **앞에서 쓴 이름**만 봤기
   * 때문이다. 이름이 겹친 목록은 창구가 통째로 거절하거나, 되돌림이 모델이 부른
   * 것을 엉뚱한 도구로 돌려준다. 차례가 어느 쪽이든 겹치면 안 된다.
   */
  const 젬 = 연결('https://generativelanguage.googleapis.com/v1beta/openai/');
  const 빈도구 = (이름) => ({ type: 'function', function: { name: 이름, description: 이름, parameters: { type: 'object', properties: {} } } });
  const 지문이름 = 도구맞추기([빈도구('a b')], 젬).tools[0].function.name;
  for (const [차례이름, 차례] of [['고칠 것이 앞', ['a b', 지문이름]], ['진짜가 앞', [지문이름, 'a b']]]) {
    const g = 도구맞추기(차례.map(빈도구), 젬);
    const 나간이름 = g.tools.map((t) => t.function.name);
    check(`★★ 고친 이름이 진짜 이름과 안 겹친다 (${차례이름})`, new Set(나간이름).size === 2, JSON.stringify(나간이름));
    const 진짜자리 = 차례.indexOf(지문이름);
    const 되돌린 = (이름) => 이름되돌리기({ toolCalls: [{ id: 'c', name: 이름, args: {} }] }, g.되돌림).toolCalls[0].name;
    check(`★ 진짜 이름은 그대로 나가고 둘 다 제 이름으로 되돌아온다 (${차례이름})`,
      나간이름[진짜자리] === 지문이름 && 되돌린(나간이름[진짜자리]) === 지문이름 && 되돌린(나간이름[1 - 진짜자리]) === 'a b',
      JSON.stringify({ 나간이름, 되돌림: [...(g.되돌림 ?? [])] }));
  }
}

{
  /*
   * ★★ Gemini 스키마의 enum 은 **글자 목록**뿐이다.
   *
   * API 참조의 Schema 가 `"enum": [ string ]` 이라고 못 박는다. MCP 스키마에는
   * `{ type:'integer', enum:[1,2,3] }` 이 흔한데, 그대로 실으면 그 목록이 거절되고
   * 그 턴이 통째로 죽는다 — 화면에는 열쇠가 틀린 것과 구별이 안 되는 400 이다.
   *
   * 숫자 칸은 숫자로 남긴다. enum 만 빼고 받는 값을 설명에 옮겨 적는다 — 모델은
   * 여전히 무엇을 넣을지 알고, 값이 숫자로 나가니 되돌릴 것도 없다.
   */
  const 목록 = [{
    type: 'function',
    function: {
      name: 'mcp__srv__level', description: 'level',
      parameters: {
        type: 'object',
        properties: {
          level: { type: 'integer', enum: [1, 2, 3], description: '단계' },
          ratio: { type: 'number', enum: [0.5, 1] },
          mode: { type: 'string', enum: ['a', 'b'] },
          maybe: { type: ['string', 'null'], enum: ['x', null] },
          kind: { const: 'fixed' },
          bare: { enum: [1, 2] },
        },
      },
    },
  }];
  const g = 도구맞추기(목록, 연결('https://generativelanguage.googleapis.com/v1beta/openai/'));
  const q = g.tools[0].function.parameters.properties;
  check('★★ 정수 enum 은 빼고 받는 값을 설명에 옮긴다 — 칸은 정수로 남는다',
    q.level.enum === undefined && q.level.type === 'integer' && /1, 2, 3/.test(q.level.description ?? '') && /단계/.test(q.level.description ?? ''),
    JSON.stringify(q.level));
  check('★ 실수 enum 도 같다', q.ratio.enum === undefined && q.ratio.type === 'number' && /0\.5/.test(q.ratio.description ?? ''), JSON.stringify(q.ratio));
  check('★ 글자 enum 은 그대로 둔다', JSON.stringify(q.mode.enum) === '["a","b"]', JSON.stringify(q.mode));
  check('★ enum 속 null 은 nullable 로 옮긴다', JSON.stringify(q.maybe.enum) === '["x"]' && q.maybe.nullable === true, JSON.stringify(q.maybe));
  check('★ const 는 값 하나짜리 enum 으로 옮긴다', q.kind.type === 'string' && JSON.stringify(q.kind.enum) === '["fixed"]', JSON.stringify(q.kind));
  check('★ 갈래 없이 숫자 enum 만 적힌 자리는 숫자 갈래로 되짚는다 (string 이 아니다)',
    q.bare.type === 'integer' && q.bare.enum === undefined, JSON.stringify(q.bare));
  const 글자아닌enum = JSON.stringify(g.tools[0].function.parameters).match(/"enum":\[[^\]]*[^"\]][,\]]/g);
  check('★★ 나가는 스키마의 enum 은 모두 글자 목록이다', !글자아닌enum, JSON.stringify(글자아닌enum));
}

{
  /*
   * ★★ Gemini 는 `required` 에 적힌 이름이 `properties` 에 없으면 스키마째 거절한다
   * ("property is not defined"). 4회차 Gemini 리뷰가 짚었고 실행으로 확인했다.
   *
   * 흔한 길은 `allOf` 다 — Gemini 가 모르는 열쇠라 걸러지면서 그 안의 속성은 사라지고
   * 바깥 `required` 만 남았다. 서버가 적은 스키마가 원래 어긋난 경우(없는 이름을 required 에)도 같다.
   */
  const 한도구 = (parameters) => [{ type: 'function', function: { name: 'mcp__srv__req', description: 'req', parameters } }];
  const 제미니 = 연결('https://generativelanguage.googleapis.com/v1beta/openai/');
  const 어긋난이름 = (s) => {
    const 틀림 = [];
    const 걷기 = (x, 곳) => {
      if (!x || typeof x !== 'object') return;
      if (Array.isArray(x.required)) for (const n of x.required) if (!x.properties || !Object.hasOwn(x.properties, n)) 틀림.push(`${곳}:${n}`);
      for (const [k, v] of Object.entries(x.properties ?? {})) 걷기(v, `${곳}.${k}`);
      if (x.items) 걷기(x.items, `${곳}[]`);
      for (const v of x.anyOf ?? []) 걷기(v, `${곳}|`);
    };
    걷기(s, '$');
    return 틀림;
  };
  const 없는이름 = 도구맞추기(한도구({ type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'missing'] }), 제미니).tools[0].function.parameters;
  check('★★ properties 에 없는 required 이름은 뺀다 — 있는 것은 남긴다',
    !어긋난이름(없는이름).length && JSON.stringify(없는이름.required) === '["a"]', JSON.stringify(없는이름));
  const 안쪽 = 도구맞추기(한도구({ type: 'object', properties: { o: { type: 'object', properties: {}, required: ['z'] } } }), 제미니).tools[0].function.parameters;
  check('★ 안쪽 객체의 required 도 같다', !어긋난이름(안쪽).length, JSON.stringify(안쪽));
  const 올오프 = 도구맞추기(한도구({
    type: 'object',
    allOf: [{ properties: { a: { type: 'string', description: '가' } }, required: ['b'] }, { properties: { b: { type: 'integer' } } }],
    required: ['a'],
  }), 제미니).tools[0].function.parameters;
  check('★★ allOf 안의 속성은 버리지 않고 펼쳐 싣는다 — required 와 짝이 맞는다',
    !어긋난이름(올오프).length && 올오프.properties?.a?.type === 'string' && 올오프.properties?.b?.type === 'integer'
      && JSON.stringify([...(올오프.required ?? [])].sort()) === '["a","b"]', JSON.stringify(올오프));
  const 딴곳 = 도구맞추기(한도구({ type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'missing'] }), 연결('https://api.openai.com/v1')).tools[0].function.parameters;
  check('  Gemini 아닌 곳으로는 required 를 안 건드린다', JSON.stringify(딴곳.required) === '["a","missing"]', JSON.stringify(딴곳));
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

  /*
   * ★ 못 쓰는 글자를 지우고 나서도 **서로 구별이 돼야 한다.**
   *
   * 글자마다 밑줄로 바꾸면 한글 이름 셋이 전부 `mcp__________` 이 된다.
   * 겹침은 뒤에 번호를 붙여 면할 수 있지만, 모델이 보는 이름은 여전히
   * 구별이 안 된다 — 「검색해 줘」 라고 했는데 지우기가 불려도 오류가 안 난다.
   */
  const 한글셋 = ['검색', '열기', '지우기'].map((끝) => ({
    type: 'function',
    function: { name: `mcp__사내문서__${끝}`, description: `[사내문서] ${끝}`, parameters: { type: 'object', properties: {} } },
  }));
  const 셋 = 도구맞추기(한글셋, 연결('https://api.openai.com/v1'));
  const 셋이름 = 셋.tools.map((t) => t.function.name);
  check('★ 한글 이름 셋이 서로 다른 이름이 된다', new Set(셋이름).size === 3, 셋이름.join(' · '));
  check('★ 밑줄만 남지 않는다', 셋이름.every((n) => /[a-z0-9]/.test(n.replace(/^mcp_+/, ''))), 셋이름.join(' · '));
  check('셋 다 되짚을 수 있다',
    셋이름.every((n, i) => 셋.되돌림.get(n) === 한글셋[i].function.name), 셋이름.join(' · '));
  /*
   * ★ 판마다 같아야 한다.
   *
   * 겹침을 번호로만 면하면 이름이 목록 차례를 탄다. MCP 서버가 다시 붙어
   * 차례가 바뀌면 같은 도구가 다른 이름으로 나가고, 그러면 모델이 앞 턴에서
   * 본 이름을 다시 못 부른다.
   */
  const 뒤집어서 = 도구맞추기([...한글셋].reverse(), 연결('https://api.openai.com/v1'));
  check('★ 차례가 바뀌어도 같은 이름이 나온다',
    뒤집어서.tools.map((t) => t.function.name).reverse().join() === 셋이름.join(),
    뒤집어서.tools.map((t) => t.function.name).join(' · '));

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

  /*
   * ── 원래 없던 인자 칸은 **안 만든다** (8회차 뒷단) ──────────────────────
   *
   * 바로 그 약속이 이 파일에 적혀 있는데(「원래 없던 인자 칸을 만들어 두지
   * 않는다」), `객체로(null)` 가 `{type:'object',properties:{}}` 를 새로 지어
   * 놓아 매번 어겨졌다. 인자를 아예 안 받는 MCP 도구가 「인자 없는 객체를
   * 받는 도구」 로 바뀌어 나가고, 스키마손봄 도 1 로 세어진다 — 우리가
   * 도구를 깎았다고 적는 숫자인데 깎을 것이 없던 자리다.
   */
  const 인자없음 = [{ type: 'function', function: { name: 'a b', description: '인자 없는 도구' } }];
  for (const [주소, 회사] of [
    ['https://api.anthropic.com/v1', 'Anthropic'],
    ['https://bedrock-runtime.us-east-1.amazonaws.com/v1', 'Bedrock'],
    ['https://generativelanguage.googleapis.com/v1beta/openai/', 'Gemini'],
  ]) {
    const r = 도구맞추기(인자없음, 연결(주소));
    check(`★★ ${회사}: 원래 없던 인자 칸을 새로 만들지 않는다`,
      !('parameters' in r.tools[0].function) && !('input_schema' in r.tools[0].function),
      JSON.stringify(r.tools[0].function));
    check(`  ${회사}: 안 깎았으면 깎았다고 안 센다`, r.손본것.스키마 === 0, JSON.stringify(r.손본것));
  }

  /*
   * ── 멀쩡한 스키마는 **그 객체 그대로** 나간다 (8회차 뒷단) ──────────────
   *
   * 「안 바뀌었으면 원래 것을 그대로 돌려준다」 는 검사가 참조 동일성인데,
   * 제미니 갈래는 값이 같아도 매번 새 객체를 지어 놓았다. 그래서 요청마다
   * 도구 목록 전체가 통째로 복제됐다 — 값은 같으니 아무 검사도 안 울린다.
   */
  {
    const 멀쩡 = [{ type: 'function', function: { name: 'ok_tool', description: 'd', parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] } } }];
    for (const [주소, 회사] of [
      ['https://generativelanguage.googleapis.com/v1beta/openai/', 'Gemini'],
      ['https://api.anthropic.com/v1', 'Anthropic'],
    ]) {
      const r = 도구맞추기(멀쩡, 연결(주소));
      check(`★ ${회사}: 다듬을 것이 없으면 원래 도구를 그대로 돌려준다`, r.tools[0] === 멀쩡[0],
        JSON.stringify(r.tools[0]));
      check(`  ${회사}: 그때 스키마손봄 은 0`, r.손본것.스키마 === 0, JSON.stringify(r.손본것));
    }
  }

  /*
   * ── `format` 을 `type` 기본값보다 먼저 봤다 (8회차 뒷단) ────────────────
   *
   * `{when:{format:'date-time'}}` 은 갈래를 안 적었을 뿐 멀쩡한 스키마인데,
   * format 을 볼 때 type 이 아직 undefined 라 `제미니format[undefined]` 가
   * 비어 format 이 지워졌다. 그 뒤에 type 이 string 으로 정해진다 — 제미니가
   * 받는 조합(string + date-time)인데 우리가 먼저 깎아 버린 셈이다.
   */
  {
    const 젬 = 연결('https://generativelanguage.googleapis.com/v1beta/openai/');
    const 날짜 = 도구맞추기([{ type: 'function', function: { name: 'f', parameters: { type: 'object', properties: { when: { format: 'date-time' } } } } }], 젬)
      .tools[0].function.parameters.properties.when;
    check('★★ 갈래를 안 적은 date-time 의 format 을 안 지운다',
      날짜.type === 'string' && 날짜.format === 'date-time', JSON.stringify(날짜));
    const 정수 = 도구맞추기([{ type: 'function', function: { name: 'f', parameters: { type: 'object', properties: { n: { type: 'integer', format: 'int64' } } } } }], 젬)
      .tools[0].function.parameters.properties.n;
    check('  적어 둔 갈래에 맞는 format 은 그대로', 정수.format === 'int64', JSON.stringify(정수));
    const 모르는것 = 도구맞추기([{ type: 'function', function: { name: 'f', parameters: { type: 'object', properties: { s: { type: 'string', format: 'uuid' } } } } }], 젬)
      .tools[0].function.parameters.properties.s;
    check('  제미니가 모르는 format 은 여전히 뗀다', 모르는것.format === undefined, JSON.stringify(모르는것));
  }
}

/*
 * ── 지문이 진짜로 갈라 놓는가 ───────────────────────────────────────────
 *
 * 지금까지 이 파일은 이름 서너 개로만 쟀다. 그래서 지문을 만드는 자리가
 * **엉뚱한 쪽을 잘라도** 초록이었다. 32비트 값을 36진수로 적으면 길어야
 * 일곱 자인데 여덟 자로 맞추려고 앞을 0 으로 채웠고, 거기서 앞 여섯 자를
 * 떼고 있었다 — 채워 넣은 0 을 세고 제일 자주 바뀌는 뒷자리를 버린 셈이다.
 * 21억 가지가 330만 가지로 줄었는데 검사는 아무 말이 없었다.
 *
 * 그래서 **많이** 넣어 본다. 겹침은 이름 세 개로는 안 보이고 수천 개에서
 * 보인다. 그리고 겹치면 무슨 일이 나는지도 같이 잰다 — 겹침을 면하려고
 * 뒤에 붙이는 번호는 목록 차례를 타므로, 겹치는 순간 이 파일이 없애려던
 * 고장(검색과 지우기가 이름을 맞바꾸는 것)이 그대로 돌아온다.
 */
trace('8-지문');
{
  const 젬 = { base: 'https://generativelanguage.googleapis.com/v1beta/openai/', kind: 'openai' };
  const 도구 = (이름) => ({ type: 'function', function: { name: 이름, description: 이름, parameters: { type: 'object', properties: {} } } });

  // 한글로만 갈리는 이름 — 다듬고 나면 남는 것은 지문뿐이다.
  const 글자 = '가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허';
  const 많은것 = [];
  for (let i = 0; i < 4000; i++) {
    const a = 글자[i % 글자.length];
    const b = 글자[Math.floor(i / 글자.length) % 글자.length];
    const c = 글자[Math.floor(i / (글자.length * 글자.length)) % 글자.length];
    많은것.push(도구(`mcp__사내문서__${c}${b}${a}`));
  }
  const 큰것 = 도구맞추기(많은것, 젬);
  const 나온이름 = 큰것.tools.map((t) => t.function.name);
  check('★ 한글로만 갈리는 이름 4,000개가 서로 다른 이름으로 나간다',
    new Set(나온이름).size === 나온이름.length, `${new Set(나온이름).size}/${나온이름.length}`);
  /*
   * 겹쳤나는 「혼자 넣었을 때와 같은 이름이 나오나」 로 잰다.
   *
   * 뒤에 붙는 번호로는 못 잰다 — 지문 자체가 숫자로만 될 수 있어서
   * (`mcp_378679`) 「_숫자로 끝난다」 가 겹침의 표가 안 된다. 실제로 이 검사를
   * 그렇게 짰다가 멀쩡한 이름 셋을 겹쳤다고 잘못 걸었다.
   *
   * 혼자 넣으면 겹칠 상대가 없으니 번호가 절대 안 붙는다. 그것과 다르면
   * 목록에 같이 있었다는 이유만으로 이름이 달라졌다는 뜻이고, 그 이름은
   * 목록 차례를 탄다.
   */
  const 홀로다른것 = 많은것.filter((t, i) => 도구맞추기([t], 젬).tools[0].function.name !== 나온이름[i]);
  check('★ 지문이 겹쳐 이름이 목록 차례를 타는 것이 없다',
    홀로다른것.length === 0, 홀로다른것.slice(0, 3).map((t) => t.function.name).join(' · ') || '0개');
  check('되돌림 표는 4,000개를 다 들고 있다', 큰것.되돌림?.size === 4000, String(큰것.되돌림?.size));

  // 차례를 바꿔도 같은 이름이 나와야 한다. 이게 번호가 아니라 지문을 쓰는 까닭이다.
  const 거꾸로 = 도구맞추기([...많은것].reverse(), 젬);
  const 거꾸로표 = new Map(거꾸로.tools.map((t, i) => [많은것[많은것.length - 1 - i].function.name, t.function.name]));
  const 어긋난것 = 많은것.filter((t) => 거꾸로표.get(t.function.name) !== 큰것.tools[많은것.indexOf(t)].function.name);
  check('★ 목록 차례를 뒤집어도 도구마다 같은 이름이 나온다',
    어긋난것.length === 0, 어긋난것.slice(0, 2).map((t) => t.function.name).join(' · ') || '0개');

  // 긴 이름을 접을 때도 앞뒤가 남아야 한다 — 읽기와 쓰기가 구별돼야 한다.
  const 긴서버 = `mcp__${'아주긴서버이름'.repeat(6)}`;
  const 둘 = 도구맞추기([도구(`${긴서버}__read`), 도구(`${긴서버}__write`)], 젬).tools.map((t) => t.function.name);
  check('★ 긴 이름 둘도 서로 달라진다', 둘[0] !== 둘[1], 둘.join(' · '));
  check('긴 이름도 64자를 안 넘는다', 둘.every((n) => n.length <= 64), 둘.map((n) => n.length).join('/'));
}

/*
 * 6회차 Gemini 도구맞춤6 T4 — 영숫자가 하나도 안 남는 이름. 지문을 붙인 **뒤에** 영숫자를 봐서 늘 통과했고,
 * `tool_지문` 이 아니라 `_fxrcde` 처럼 밑줄로 시작하는 이름이 나갔다.
 */
trace('9-한글만이름');
{
  const 젬6 = { kind: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' };
  const 한글도구 = (name) => ({ type: 'function', function: { name, description: 'd', parameters: { type: 'object', properties: {} } } });
  const 맞춘것 = 도구맞추기([한글도구('검색'), 한글도구('찾기')], 젬6);
  const 이름들 = 맞춘것.tools.map((t) => t.function.name);
  check('★ 영숫자가 하나도 없는 이름은 tool_지문 — 밑줄로 시작하지 않는다',
    이름들.every((n) => /^tool_[a-z0-9]+$/i.test(n)) && 이름들[0] !== 이름들[1], 이름들.join(' · '));
  check('  되돌리면 원래 이름', 이름들.map((n) => 맞춘것.되돌림?.get(n)).join(',') === '검색,찾기', JSON.stringify([...(맞춘것.되돌림 ?? [])]));
  const 섞임 = 도구맞추기([한글도구('mcp__사내__검색')], 젬6).tools[0].function.name;
  check('  영숫자가 남는 이름은 전처럼 앞을 살리고 지문', /^mcp_[a-z0-9]+$/i.test(섞임) && !섞임.startsWith('tool_'), 섞임);
}

// 6회차 Gemini 도구맞춤6b1 — Gemini 로 가는 스키마에서 뜻이 사라지던 두 자리.
trace('10-도구맞춤6b');
{
  const 젬6 = { kind: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' };
  const 맞춤 = (parameters) => 도구맞추기([{ type: 'function', function: { name: 't', description: 'd', parameters } }], 젬6).tools[0].function.parameters;

  // G3 · allOf 갈래가 $ref 사슬(A → B)이거나 갈래 안에 또 allOf. 한 겹만 풀어 속성이 통째로 사라졌다.
  const 사슬 = 맞춤({ type: 'object', $defs: { A: { $ref: '#/$defs/B' }, B: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] } }, allOf: [{ $ref: '#/$defs/A' }] });
  check('★ allOf 갈래의 $ref 사슬(A → B)도 끝까지 풀어 속성·required 를 살린다',
    사슬.properties?.x?.type === 'string' && JSON.stringify(사슬.required) === '["x"]', JSON.stringify(사슬));
  const 두겹 = 맞춤({ type: 'object', allOf: [{ allOf: [{ type: 'object', properties: { y: { type: 'integer' } }, required: ['y'] }] }] });
  check('★ 갈래 안의 allOf 도 펼친다', 두겹.properties?.y?.type === 'integer' && JSON.stringify(두겹.required) === '["y"]', JSON.stringify(두겹));
  const 도는참조 = 맞춤({ type: 'object', $defs: { A: { $ref: '#/$defs/B' }, B: { $ref: '#/$defs/A' } }, allOf: [{ $ref: '#/$defs/A' }], properties: { z: { type: 'string' } } });
  check('  서로 가리키는 참조에서도 안 멈추고 바깥 속성은 남는다', 도는참조.properties?.z?.type === 'string', JSON.stringify(도는참조));
  const 앞이김 = 맞춤({ type: 'object', allOf: [{ properties: { k: { type: 'string' } } }, { allOf: [{ properties: { k: { type: 'integer' } } }] }] });
  check('  겹치면 여전히 앞 갈래가 이긴다', 앞이김.properties?.k?.type === 'string', JSON.stringify(앞이김));

  // G1 · 글자·수 둘 다 받는 칸이 첫 갈래(string)로만 좁혀졌다. Gemini 는 anyOf 를 안다.
  const 둘다 = 맞춤({ type: 'object', properties: { v: { type: ['string', 'number'] } } });
  check('★ 둘 이상 받는 칸(type 배열)은 anyOf 로 옮긴다 — 첫 갈래로 좁히지 않는다',
    JSON.stringify(둘다.properties?.v?.anyOf) === '[{"type":"string"},{"type":"number"}]' && 둘다.properties?.v?.type === undefined, JSON.stringify(둘다.properties?.v));
  const 널섞임 = 맞춤({ type: 'object', properties: { v: { type: ['string', 'number', 'null'] } } });
  check('  null 이 섞이면 nullable 도 같이', 널섞임.properties?.v?.nullable === true && 널섞임.properties?.v?.anyOf?.length === 2, JSON.stringify(널섞임.properties?.v));
  const 하나널 = 맞춤({ type: 'object', properties: { v: { type: ['string', 'null'] } } });
  check('  하나 + null 은 전처럼 type 하나에 nullable', 하나널.properties?.v?.type === 'string' && 하나널.properties?.v?.nullable === true && !하나널.properties?.v?.anyOf, JSON.stringify(하나널.properties?.v));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n회사별 도구 다듬기 검사  ${D}(모르는 곳은 안 건드리는가 · 고친 이름을 되돌리는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

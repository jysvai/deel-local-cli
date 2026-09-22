// 답을 **정해진 모양**으로 받는다 — `deel run --output-schema`.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────
//
// `deel run` 은 글을 낸다. 사람이 읽으면 그만이지만, 스크립트에 물리면
// 거기서부터 일이 시작된다.
//
//     deel run "이 계약서에서 계약 기간과 해지 조건을 뽑아 줘" spec.hwpx | ???
//
// 뒤에 무엇을 붙일 수 있나. 답이 매번 다른 모양으로 오므로 `grep` 이나
// `sed` 로 뜯어야 하고, 그 뜯는 코드는 모델이 다음번에 문장을 조금 다르게
// 쓰는 날 조용히 틀린다. **조용히** 가 핵심이다 — 빈 값을 받은 스크립트는
// 오류를 안 내고 그냥 빈 값으로 다음 단계에 넘긴다.
//
// 모양을 미리 못 박으면 이 문제가 통째로 사라진다.
//
//     deel run --output-schema 계약.schema.json "..." | jq -r .해지조건
//
// 그러면 이 프로그램은 **셸 파이프라인에서 부를 수 있는 함수**가 된다.
// doc2md 와 붙이면 「hwpx 계약서 → 구조화 JSON」 이 되는데, 그건 지금
// 어느 경쟁 도구도 못 한다.
//
// ── 왜 우리가 직접 재나 ────────────────────────────────────────────────
//
// 「JSON 으로 답해 줘」 라고 부탁만 하고 안 재는 길도 있다. 그런데 그러면
// 지키는 날과 안 지키는 날이 생기고, 안 지킨 날에 스크립트가 깨진다 —
// 그것도 우리가 아니라 **뒤에 붙은 남의 코드**에서 깨진다. 부탁은 계약이
// 아니다. 계약이라고 부르려면 재야 한다.
//
// 그래서 받아 놓고 여기서 맞춰 본다. 안 맞으면 무엇이 어떻게 안 맞는지를
// 모델에게 그대로 돌려주고 한 번 더 시킨다. 그래도 안 맞으면 **0 이 아닌
// 값으로 끝낸다.** 모양이 안 맞는 JSON 을 표준출력으로 흘려보내는 것이
// 여기서 할 수 있는 제일 나쁜 일이다.
//
// ── 무엇을 안 하나 ─────────────────────────────────────────────────────
//
// **`$ref` 로 바깥을 안 본다.** JSON Schema 는 `$ref` 에 주소를 적을 수 있고,
// 검사기 대부분이 그걸 받아 온다. 우리는 안 받아 온다 — 스키마 파일 하나가
// 이 프로그램의 「나가는 주소는 사람이 정한 하나뿐」 을 깨뜨리는 길이 되면
// 안 된다. 같은 파일 안(`#/$defs/...`)만 따라간다.
//
// 규격을 다 받지도 않는다. 아래 목록에 없는 열쇠는 **본 척하지 않고 그냥
// 넘긴다.** 모르는 규칙을 아는 척 통과시키는 것이 모르는 채로 두는 것보다
// 나쁘다 — 사람은 잰 줄 알고 지낸다. 그래서 `모르는열쇠()` 로 무엇을 안
// 봤는지 셀 수 있게 해 두고, 화면이 그것을 말한다.
import { readFileSync } from 'node:fs';

/** 우리가 실제로 재는 열쇠들. 여기 없는 것은 안 재고, 안 쟀다고 말한다. */
export const 아는열쇠 = Object.freeze([
  'type', 'enum', 'const',
  'properties', 'required', 'additionalProperties', 'patternProperties',
  'items', 'prefixItems', 'minItems', 'maxItems',
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'anyOf', 'oneOf', 'allOf', 'not',
  '$ref', '$defs', 'definitions',
  // 재는 것이 아니라 적어 두는 것들. 모델에게 보여 줄 때 쓴다.
  '$schema', '$id', 'title', 'description', 'default', 'examples',
]);

const 아는것 = new Set(아는열쇠);
// 그 아래 열쇠가 규격 낱말이 아니라 '사람이 지은 칸 이름' 인 자리.
// patternProperties 아래 열쇠는 칸 이름을 가르는 **무늬**다 — 그것도 규격 낱말이 아니다.
const 이름칸 = new Set(['properties', 'patternProperties', '$defs', 'definitions']);

/**
 * 이 스키마에서 우리가 안 보는 열쇠들.
 *
 * 조용히 넘기면 사람은 잰 줄 알고 지낸다. 세어서 화면이 말하게 한다.
 */
export function 모르는열쇠(스키마, 본것 = new Set()) {
  const out = new Set();
  const 훑기 = (s) => {
    if (!s || typeof s !== 'object' || 본것.has(s)) return;
    본것.add(s);
    if (Array.isArray(s)) { for (const x of s) 훑기(x); return; }
    for (const [k, v] of Object.entries(s)) {
      if (!아는것.has(k)) out.add(k);
      if (!v || typeof v !== 'object') continue;
      /*
       * `properties`·`$defs` 아래 열쇠는 **사람이 지은 칸 이름**이지 규격
       * 낱말이 아니다. 그걸 세면 칸을 하나 만들 때마다 「안 재는 열쇠」 가
       * 하나씩 늘어난다 — 그러면 이 경고는 아무도 안 읽는 소음이 되고,
       * 진짜로 안 재는 낱말(format 같은 것)이 그 속에 묻힌다.
       */
      if (이름칸.has(k)) { for (const x of Object.values(v)) 훑기(x); }
      // `default`·`examples` 아래는 **데이터**다(2.0.0 6회차 모양6 O2). 거기 적힌 `host`·`port` 를
      // 「안 재는 열쇠」 로 세면 이 경고가 또 소음이 된다. 칸 이름이 `enum` 인 것은 위 갈래로 간다.
      else if (!값칸.has(k)) 훑기(v);
    }
  };
  훑기(스키마);
  return [...out].sort();
}

/**
 * 스키마 파일을 읽는다.
 *
 * 못 읽으면 **일을 시작하지 않는다.** 스키마가 없는데 그냥 도는 것은
 * 「모양을 못 박아 달라」 는 부탁을 조용히 무시하는 것이고, 그 결과는 파이프
 * 뒤에서 터진다.
 *
 * @returns {{ok: true, 스키마: object, 모른것: string[]} | {ok: false, 왜: string}}
 */
export function 스키마읽기(경로) {
  let 글;
  try { 글 = readFileSync(경로, 'utf8'); }
  catch (err) { return { ok: false, 왜: `스키마 파일을 못 읽었습니다: ${경로}\n  ${err?.message ?? err}` }; }
  /*
   * 맨 앞의 BOM 을 뗀다 (사냥5 B5-05).
   *
   * 윈도우 메모장과 PowerShell 5 의 Out-File 은 UTF-8 에 BOM 을 붙여 저장한다. JSON.parse 는
   * 그 한 글자에서 멈추고, 화면은 「스키마가 JSON 이 아닙니다」 — 눈으로 보면 멀쩡한
   * 파일인데. 윈도우에서 스키마를 처음 적는 사람이 첫 판에 밟는 자리다.
   */
  if (글.startsWith(BOM)) 글 = 글.slice(BOM.length);
  let s;
  try { s = JSON.parse(글); }
  catch (err) { return { ok: false, 왜: `스키마가 JSON 이 아닙니다: ${경로}\n  ${err?.message ?? err}` }; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    return { ok: false, 왜: `스키마는 객체여야 합니다: ${경로}` };
  }
  // 바깥을 가리키는 $ref 는 여기서 막는다. 읽고 나서 막으면 이미 늦다.
  const 바깥 = 바깥ref찾기(s);
  if (바깥.length) {
    return {
      ok: false,
      왜: `스키마가 바깥을 가리킵니다: ${바깥.slice(0, 3).join(' · ')}\n`
        + '  이 프로그램은 스키마를 받아 오지 않습니다 — 나가는 주소는 사람이 정한 하나뿐이어야 합니다.\n'
        + '  같은 파일 안(#/$defs/...)으로 바꿔 주세요.',
    };
  }
  /*
   * 값을 한 칸도 파고들지 않고 제자리로 돌아오는 참조는 **읽는 자리에서** 막는다 (사냥5 L5-3).
   *
   * `{"$ref":"#"}` · a→b→a · `{"allOf":[{"$ref":"#"}]}` 는 같은 값을 같은 스키마로 끝없이
   * 재게 한다. 여기서 안 막았더니 모델을 한 번 부른 **뒤에** 재는 자리에서 호출 스택이
   * 넘쳤고, 그 오류가 표준출력에 맨 글로 찍혔다. 사람이 적은 스키마의 실수라 모델을
   * 부르기 전에 7 로 서야 한다. 나무처럼 **값을 파고들며** 되부르는 참조(items·properties
   * 아래)는 끝이 있으므로 막지 않는다.
   */
  const 도는곳 = 제자리참조찾기(s);
  if (도는곳) {
    return {
      ok: false,
      왜: `스키마의 $ref 가 제자리를 돕니다: ${도는곳}\n`
        + '  값을 한 칸도 파고들지 않고 같은 자리로 돌아오면 끝없이 잽니다. 참조 고리를 끊어 주세요.',
    };
  }
  return { ok: true, 스키마: s, 모른것: 모르는열쇠(s) };
}

// 윈도우 편집기가 파일 맨 앞에 붙이는 표시 한 글자 (스키마읽기 의 BOM 머리말).
const BOM = String.fromCharCode(0xfeff);

// 스키마가 아니라 **값**이 적히는 칸. 그 안의 `$ref` 는 글자일 뿐이라 따라가지 않는다.
const 값칸 = new Set(['enum', 'const', 'default', 'examples']);

/*
 * 같은 값을 그대로 들고 옮겨 가는 길($ref · allOf · anyOf · oneOf · not)만 따라가서
 * 제자리로 돌아오는 고리를 찾는다. 찾으면 사람이 읽을 길 한 줄, 없으면 null.
 *
 * properties·items 아래로 내려가는 길은 값도 한 칸 파고들므로 고리가 되지 않는다 —
 * 그래서 그 길은 「고리 찾기」 에 안 넣고, 「어디서 시작할 수 있나」 에만 쓴다.
 */
function 제자리참조찾기(뿌리) {
  const 끝남 = new Set();
  const 가는중 = new Set();
  const 같은값길 = (n) => {
    const out = [];
    if (typeof n.$ref === 'string') {
      const t = ref따라가기(뿌리, n.$ref);
      // 참/거짓 스키마는 더 갈 곳이 없어 고리가 못 된다 — 길에 안 올린다.
      if (t && typeof t === 'object') out.push([t, n.$ref]);
    }
    for (const k of ['allOf', 'anyOf', 'oneOf']) {
      if (Array.isArray(n[k])) for (const x of n[k]) if (x && typeof x === 'object') out.push([x, k]);
    }
    if (n.not && typeof n.not === 'object') out.push([n.not, 'not']);
    return out;
  };
  const 돌기 = (n, 길) => {
    if (끝남.has(n)) return null;
    if (가는중.has(n)) return 길.join(' → ');
    가는중.add(n);
    for (const [다음, 표] of 같은값길(n)) {
      const 찾음 = 돌기(다음, [...길, 표]);
      if (찾음) return 찾음;
    }
    가는중.delete(n);
    끝남.add(n);
    return null;
  };
  const 본것 = new Set();
  const 훑기 = (x) => {
    if (!x || typeof x !== 'object' || 본것.has(x)) return null;
    본것.add(x);
    if (!Array.isArray(x)) {
      const 찾음 = 돌기(x, ['#']);
      if (찾음) return 찾음;
    }
    for (const [k, v] of Object.entries(x)) {
      if (!Array.isArray(x) && 값칸.has(k)) continue;
      const 찾음 = 훑기(v);
      if (찾음) return 찾음;
    }
    return null;
  };
  return 훑기(뿌리);
}

/** 같은 파일 안(`#`으로 시작)이 아닌 `$ref` 를 다 찾는다. */
function 바깥ref찾기(스키마, 본것 = new Set()) {
  const out = [];
  const 훑기 = (s) => {
    if (!s || typeof s !== 'object' || 본것.has(s)) return;
    본것.add(s);
    if (Array.isArray(s)) { for (const x of s) 훑기(x); return; }
    if (typeof s.$ref === 'string' && !s.$ref.startsWith('#')) out.push(s.$ref);
    /*
     * 값 칸(`default`·`const`·`examples`·`enum`) 속은 스키마가 아니라 데이터라 안 들어간다
     * (2.0.0 6회차 모양6 O1). 예시 값에 `{"$ref":"http://…"}` 가 있다고 멀쩡한 스키마를 거절했다.
     * 칸 이름(`properties` 아래)이 `default` 인 것은 스키마이므로 그 자리는 그대로 훑는다 —
     * 거기 바깥 주소를 숨기면 아래 거절이 비켜 간다.
     */
    for (const [칸, v] of Object.entries(s)) {
      if (!v || typeof v !== 'object') continue;
      if (이름칸.has(칸)) { for (const x of Object.values(v)) 훑기(x); }
      else if (!값칸.has(칸)) 훑기(v);
    }
  };
  훑기(스키마);
  return [...new Set(out)];
}

/**
 * `#/$defs/이름` 같은 자리를 뿌리에서 따라간다. 못 찾으면 undefined.
 *
 * 스키마는 객체일 수도, 참/거짓 그 자체일 수도 있다. 그래서 「없다」 를 null 이 아니라
 * undefined 로 말한다 — `false` 를 「없다」 로 되돌리면 부르는 쪽이 못 가른다.
 */
function ref따라가기(뿌리, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) return undefined;
  /*
   * 퍼센트를 먼저 풀고 `~1`·`~0` 을 푼다 (RFC 6901 §6 의 차례). 날 `%` 가 섞인 조각은
   * decodeURIComponent 가 URIError 를 던져 **스키마 읽기와 재기가 통째로 던졌다**
   * (2.0.0 6회차 모양6 O5) — 그런 조각은 적힌 글자 그대로 찾는다.
   */
  const 조각들 = ref.slice(1).split('/');
  /*
   * 맨 앞 하나만 떼고 **빈 조각은 남긴다** (2.0.0 8회차 스키마). 포인터 `/` 의 조각은
   * 「이름이 빈 칸」 하나지 조각 없음이 아니다 (RFC 6901 §3). 빈 것을 다 지웠더니
   * `#/` 가 뿌리로 돌아가 엉뚱한 자리를 재고, 그 탈이 사람에게는 스키마가 틀린 것으로 보였다.
   */
  if (조각들[0] === '') 조각들.shift();
  const 길 = 조각들.map((x) => {
    let 풀린 = x;
    try { 풀린 = decodeURIComponent(x); } catch { /* 적힌 그대로 */ }
    return 풀린.replace(/~1/g, '/').replace(/~0/g, '~');
  });
  let 여기 = 뿌리;
  for (const 조각 of 길) {
    if (!여기 || typeof 여기 !== 'object') return undefined;
    여기 = 여기[조각];
  }
  if (typeof 여기 === 'boolean') return 여기;
  return 여기 && typeof 여기 === 'object' ? 여기 : undefined;
}

const 갈래 = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v === 'number' ? 'number' : typeof v;
};

const 갈래맞나 = (v, t) => {
  if (t === 'integer') return Number.isInteger(v);
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (t === 'array') return Array.isArray(v);
  if (t === 'null') return v === null;
  if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  return typeof v === t;
};

/*
 * JSON 값이 같은가 — 객체는 **키 순서를 안 본다** (2.0.0 6회차 모양6뒤). JSON.stringify 로 견줬더니
 * `{"b":2,"a":1}` 이 `const: {"a":1,"b":2}` 에 「여야 합니다」 로 걸렸다. 모델은 키 순서를 안 지킨다.
 */
function 같은값(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => 같은값(x, b[i]));
  const 앞열쇠 = Object.keys(a);
  return 앞열쇠.length === Object.keys(b).length
    && 앞열쇠.every((k) => Object.prototype.hasOwnProperty.call(b, k) && 같은값(a[k], b[k]));
}

/*
 * 스키마의 무늬를 정규식으로 — **유니코드 꼴로 먼저** 짓는다 (2.0.0 6회차 모양6뒤). JSON 스키마의 정규식은
 * ECMA-262 유니코드 꼴이라 글자 갈래 무늬(p 뒤 중괄호)를 쓴다. u 없이 지었더니 그게 글자 p 로 읽혀
 * 맞는 글을 거절했다. u 로 안 지어지는 옛 꼴(쓸데없는 이스케이프)은 u 없이 한 번 더. 둘 다 안 되면 null.
 */
function 정규식짓기(무늬) {
  try { return new RegExp(무늬, 'u'); } catch { /* 옛 꼴일 수 있다 */ }
  try { return new RegExp(무늬); } catch { return null; }
}

/**
 * 값이 스키마에 맞나.
 *
 * 탈은 **다 모아서** 준다. 하나만 주면 고치고 다시 돌리고를 반복하게 되는데,
 * 그 한 바퀴가 모델 호출 한 번이라 값이 비싸다. 그리고 사람이 스키마를
 * 잘못 적은 경우에도 한 번에 다 보이는 편이 낫다.
 *
 * @returns {{ok: boolean, 탈: string[]}}
 */
export function 맞나(값, 스키마, 옵션 = {}) {
  /*
   * ── 같은 값을 같은 스키마로 **또** 재려 하면 거기서 끊는다 (사냥5 L5-3) ─────────
   *
   * `{"$ref":"#"}` 나 a→b→a 는 값을 한 칸도 안 파고들고 제자리로 돈다. 여기가 그걸 몰라
   * 호출 스택이 넘쳤고, 한 방 실행은 그 RangeError 를 표준출력에 찍었다.
   *
   * 지금 재는 길 위에 (스키마, 값) 짝이 이미 있으면 고리다. 값을 파고들면 값이 바뀌고,
   * JSON 에는 제 몸을 품는 값이 없으므로 끝이 있는 재귀(나무 모양 스키마)는 여기에 안
   * 걸린다. 읽는 자리(스키마읽기)가 먼저 막지만, 이 함수를 곧장 부르는 쪽도 터지면 안 된다.
   * 부르는 자리를 하나하나 고치지 않고 이름 하나로 감싼 것은, 안쪽 재귀가 전부 이 이름을
   * 거쳐 가기 때문이다 — 새 열쇠를 재는 줄이 늘어도 울타리가 따라간다.
   */
  const 여기 = 옵션?.자리 || '(뿌리)';
  if (재는길.some(([a, b]) => a === 스키마 && Object.is(b, 값))) {
    return { ok: false, 탈: [`${여기}: 스키마가 제자리를 돕니다 — 같은 값을 같은 자리로 또 재려 합니다`] };
  }
  재는길.push([스키마, 값]);
  try { return 맞나속(값, 스키마, 옵션); } finally { 재는길.pop(); }
}

// 지금 재고 있는 (스키마, 값) 짝들 — 맞나 의 고리 울타리.
const 재는길 = [];

function 맞나속(값, 스키마, { 뿌리 = 스키마, 자리 = '' } = {}) {
  const 탈 = [];
  const 여기 = 자리 || '(뿌리)';
  const s = 스키마;
  /*
   * ── 참/거짓 그 자체가 스키마다 ──────────────────────────────────────────
   *
   * 바로 아래 줄이 「true/false 스키마와 $ref 를 먼저 푼다」 고 적어 두고는
   * 정작 참·거짓은 안 풀고 있었다. 객체가 아니면 그대로 통과였다.
   *
   * 그래서 `false` — 규격이 「무엇도 안 된다」 고 못 박는 자리 — 가 **무엇이든
   * 통과**였고, 그 열쇠는 아는열쇠 안에 있으니 「안 잰 열쇠」 목록에도 안 떴다.
   * 화면은 다 쟀다고 하고, 아무것도 안 쟀다. 이 파일 머리말이 제일 나쁘다고
   * 적어 둔 모양이 바로 그것이다.
   */
  if (s === true) return { ok: true, 탈 };
  if (s === false) return { ok: false, 탈: [`${여기}: 여기에는 아무 값도 올 수 없습니다`] };
  if (!s || typeof s !== 'object') return { ok: true, 탈 };

  /*
   * `$ref` 옆의 형제 열쇠도 잰다.
   *
   * 여태는 가리킨 곳을 재고 **그 자리에서 돌아섰다.** 그러면
   *
   *     { "$ref": "#/$defs/아이디", "minLength": 8 }
   *
   * 에서 minLength 가 한 번도 안 걸린다. 규격을 좁히려고 덧붙인 줄인데,
   * 덧붙이면 덧붙인 만큼 조용히 사라진 셈이다. 가리킨 곳을 재고 **이어서**
   * 형제도 잰다 — 탈은 원래 다 모아서 주는 자리라 합치기만 하면 된다.
   */
  if (typeof s.$ref === 'string') {
    const 간것 = ref따라가기(뿌리, s.$ref);
    /*
     * 가리킨 곳이 `false` 여도 「없습니다」 라고 하면 안 된다 (2.0.0 8회차 스키마). 그 자리는
     * 규격이 「무엇도 올 수 없다」 고 못 박은 자리라 있는 것이고, 사람은 스키마에 없는 오타를
     * 찾으러 간다. 위에서 참/거짓 스키마를 푸니 그대로 넘기면 제 말이 나온다.
     */
    if (간것 === undefined) return { ok: false, 탈: [`${여기}: 스키마 안에 ${s.$ref} 가 없습니다`] };
    탈.push(...맞나(값, 간것, { 뿌리, 자리 }).탈);
  }

  if (Array.isArray(s.type) ? !s.type.some((t) => 갈래맞나(값, t)) : (s.type && !갈래맞나(값, s.type))) {
    탈.push(`${여기}: ${Array.isArray(s.type) ? s.type.join('|') : s.type} 이어야 하는데 ${갈래(값)} 입니다`);
    // 갈래부터 틀리면 그 아래는 재 봐야 헛말만 늘어난다.
    return { ok: false, 탈 };
  }

  if (Array.isArray(s.enum) && !s.enum.some((x) => 같은값(x, 값))) {
    탈.push(`${여기}: ${s.enum.map((x) => JSON.stringify(x)).join(' · ')} 중 하나여야 합니다`);
  }
  if ('const' in s && !같은값(s.const, 값)) {
    탈.push(`${여기}: ${JSON.stringify(s.const)} 여야 합니다`);
  }

  if (typeof 값 === 'string') {
    if (Number.isFinite(s.minLength) && [...값].length < s.minLength) 탈.push(`${여기}: ${s.minLength}자 이상이어야 합니다`);
    if (Number.isFinite(s.maxLength) && [...값].length > s.maxLength) 탈.push(`${여기}: ${s.maxLength}자 이하여야 합니다`);
    if (typeof s.pattern === 'string') {
      // 스키마를 적은 사람의 정규식이 잘못됐을 수 있다. 그것도 탈로 말한다 —
      // 조용히 통과시키면 안 재고 있는 규칙이 하나 생긴다.
      const 무늬 = 정규식짓기(s.pattern);
      if (!무늬) 탈.push(`${여기}: 스키마의 pattern 이 잘못된 정규식입니다 (${s.pattern})`);
      else if (!무늬.test(값)) 탈.push(`${여기}: ${s.pattern} 모양이어야 합니다`);
    }
  }

  if (typeof 값 === 'number') {
    if (Number.isFinite(s.minimum) && 값 < s.minimum) 탈.push(`${여기}: ${s.minimum} 이상이어야 합니다`);
    if (Number.isFinite(s.maximum) && 값 > s.maximum) 탈.push(`${여기}: ${s.maximum} 이하여야 합니다`);
    if (Number.isFinite(s.exclusiveMinimum) && 값 <= s.exclusiveMinimum) 탈.push(`${여기}: ${s.exclusiveMinimum} 보다 커야 합니다`);
    if (Number.isFinite(s.exclusiveMaximum) && 값 >= s.exclusiveMaximum) 탈.push(`${여기}: ${s.exclusiveMaximum} 보다 작아야 합니다`);
    if (Number.isFinite(s.multipleOf) && s.multipleOf > 0) {
      const 나눈것 = 값 / s.multipleOf;
      if (Math.abs(나눈것 - Math.round(나눈것)) > 1e-9) 탈.push(`${여기}: ${s.multipleOf} 의 배수여야 합니다`);
    }
  }

  if (Array.isArray(값)) {
    if (Number.isFinite(s.minItems) && 값.length < s.minItems) 탈.push(`${여기}: ${s.minItems}개 이상이어야 합니다`);
    if (Number.isFinite(s.maxItems) && 값.length > s.maxItems) 탈.push(`${여기}: ${s.maxItems}개 이하여야 합니다`);
    /*
     * `items` 는 두 모양으로 온다.
     *
     * 하나는 「원소가 다 이 모양」 (스키마 하나). 여태 이것만 쟀다. 다른 하나는
     * Draft-07 의 **자리별 모양** —
     *
     *     "items": [{"type":"string"}, {"type":"number"}]      ← [이름, 나이]
     *
     * 배열이면 위 `!Array.isArray` 에 걸려 통째로 안 쟀다. 그런데 'items' 는
     * 아는열쇠 안에 있어서 「안 잰 열쇠」 에도 안 올랐다 — 안 재면서 잰다고
     * 말한 자리다. 첫 칸에 숫자가 와도 그냥 나갔고, 그 값을 파이프 뒤의 jq 가
     * 문자열로 알고 받았다.
     *
     * 자리별로 재고, 튜플보다 뒤에 오는 원소는 안 잰다 — 그건 additionalItems
     * 가 정하는 것이고 우리는 그 열쇠를 모른다. 모르는 것은 모르는열쇠() 가 센다.
     */
    /*
     * 2020-12 는 자리별 모양을 `prefixItems` 로 적고, 그때 `items` 는 **그 뒤** 원소들의 모양이다
     * (2.0.0 6회차 모양6뒤). prefixItems 를 몰라서 `items` 를 0번부터 씌웠다 — `["a", 1]` 이
     * 「[0]: number 이어야」 로 거절됐다.
     */
    const 자리별 = Array.isArray(s.prefixItems) ? s.prefixItems : (Array.isArray(s.items) ? s.items : null);
    if (자리별) {
      자리별.forEach((칸, i) => {
        if (i < 값.length) 탈.push(...맞나(값[i], 칸, { 뿌리, 자리: `${여기}[${i}]` }).탈);
      });
    }
    const 뒤모양 = Array.isArray(s.prefixItems) ? s.items : (Array.isArray(s.items) ? undefined : s.items);
    if (뒤모양 === true || 뒤모양 === false || (뒤모양 && typeof 뒤모양 === 'object' && !Array.isArray(뒤모양))) {
      for (let i = Array.isArray(s.prefixItems) ? s.prefixItems.length : 0; i < 값.length; i += 1) {
        탈.push(...맞나(값[i], 뒤모양, { 뿌리, 자리: `${여기}[${i}]` }).탈);
      }
    }
  }

  if (값 !== null && typeof 값 === 'object' && !Array.isArray(값)) {
    for (const k of Array.isArray(s.required) ? s.required : []) {
      if (!Object.prototype.hasOwnProperty.call(값, k)) 탈.push(`${여기}: ${k} 칸이 없습니다`);
    }
    const 칸들 = s.properties && typeof s.properties === 'object' ? s.properties : {};
    /*
     * `patternProperties` — 이름이 무늬에 맞는 칸의 모양 (2.0.0 6회차 모양6뒤). 몰라서 그런 칸이
     * `additionalProperties: false` 에 「적으면 안 되는 칸」 으로 걸렸고, 무늬까지 안 재는 열쇠로 셌다.
     * properties 와 무늬는 **둘 다** 씌운다(규격). 어느 쪽에도 안 걸린 칸만 additionalProperties 가 본다.
     */
    const 무늬들 = [];
    if (s.patternProperties && typeof s.patternProperties === 'object') {
      for (const [p, 칸] of Object.entries(s.patternProperties)) {
        const re = 정규식짓기(p);
        if (re) 무늬들.push([re, 칸]);
        else 탈.push(`${여기}: 스키마의 patternProperties 무늬가 잘못된 정규식입니다 (${p})`);
      }
    }
    for (const [k, v] of Object.entries(값)) {
      const 칸자리 = 여기 === '(뿌리)' ? k : `${여기}.${k}`;
      const 이름있음 = Object.prototype.hasOwnProperty.call(칸들, k);
      if (이름있음) 탈.push(...맞나(v, 칸들[k], { 뿌리, 자리: 칸자리 }).탈);
      const 맞은무늬 = 무늬들.filter(([re]) => re.test(k));
      for (const [, 칸] of 맞은무늬) 탈.push(...맞나(v, 칸, { 뿌리, 자리: 칸자리 }).탈);
      if (이름있음 || 맞은무늬.length) continue;
      if (s.additionalProperties === false) {
        탈.push(`${여기}: ${k} 는 적으면 안 되는 칸입니다`);
      } else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
        탈.push(...맞나(v, s.additionalProperties, { 뿌리, 자리: 칸자리 }).탈);
      }
    }
  }

  if (Array.isArray(s.allOf)) for (const x of s.allOf) 탈.push(...맞나(값, x, { 뿌리, 자리 }).탈);
  if (Array.isArray(s.anyOf) && !s.anyOf.some((x) => 맞나(값, x, { 뿌리, 자리 }).ok)) {
    탈.push(`${여기}: anyOf 중 어느 것에도 안 맞습니다`);
  }
  if (Array.isArray(s.oneOf)) {
    const 맞은수 = s.oneOf.filter((x) => 맞나(값, x, { 뿌리, 자리 }).ok).length;
    if (맞은수 !== 1) 탈.push(`${여기}: oneOf 중 정확히 하나에 맞아야 하는데 ${맞은수}개에 맞습니다`);
  }
  /*
   * `{"not": true}` 는 「무엇도 안 된다」 는 뜻이다 — false 스키마를 돌려 적은
   * 꼴이고, 스키마를 만들어 주는 도구들이 실제로 그렇게 뱉는다. 여기가 객체만
   * 보고 있어서 그 한 줄은 통째로 통과였다. 참·거짓도 스키마니 그대로 재 준다.
   */
  const not잴것 = s.not === true || s.not === false || (s.not && typeof s.not === 'object');
  if (not잴것 && 맞나(값, s.not, { 뿌리, 자리 }).ok) {
    탈.push(`${여기}: not 에 걸립니다`);
  }

  return { ok: 탈.length === 0, 탈 };
}

/**
 * 모델이 낸 글에서 JSON 을 뽑는다.
 *
 * 「JSON 만 내라」 고 적어 둬도 모델은 ```json 울타리를 두르거나 앞에 한 줄
 * 인사를 붙인다. 그걸 실패로 치면 멀쩡한 답을 버리게 되므로, **뽑을 수 있으면
 * 뽑는다.** 다만 뽑아 놓고 아무 말도 안 하면 안 된다 — 무엇을 걷어냈는지
 * 돌려줘서 화면이 말하게 한다.
 *
 * @returns {{ok: true, 값: any, 군말: boolean} | {ok: false, 왜: string}}
 */
export function 답에서JSON뽑기(글, { 스키마 = null } = {}) {
  const s = String(글 ?? '').trim();
  if (!s) return { ok: false, 왜: '답이 비었습니다' };

  const 해보기 = (t) => { try { return { ok: true, 값: JSON.parse(t) }; } catch { return null; } };

  const 그대로 = 해보기(s);
  if (그대로) return { ...그대로, 군말: false };

  /*
   * ── 후보를 **다** 모은 뒤에 고른다 (사냥5 B5-06 · L5-4) ───────────────────────
   *
   * 여기는 첫 울타리 하나, 첫 `{`·`[` 하나만 보고 거기서 안 되면 포기했다. 그래서
   *   · 「See [docs] below. {"a":"x"}」 · 「- [x] done」 · 「Use {placeholder}」 처럼 JSON 앞에
   *     괄호 낀 산문이 있으면 뒤의 멀쩡한 JSON 을 못 찾아 7 로 섰고,
   *   · 울타리가 둘인데 앞의 것이 예시면 **예시**를 답으로 냈다 — 예시가 모양에 맞으면
   *     7 도 안 나고 지어낸 값이 파이프 뒤로 흘렀다.
   *
   * 고르는 규칙.
   *   1) 울타리 안에서 읽힌 것이 하나라도 있으면 그것들만 본다. 「이것이 JSON 이다」 라고
   *      모델이 표시한 자리라, 산문 속 `[1]` 같은 우연한 JSON 보다 믿을 만하다.
   *   2) 없으면 맨글에서 짝이 맞는 괄호 덩이들을 앞에서부터 모은다(읽힌 덩이 안쪽은 건너뛴다).
   *   3) 그중 스키마에 맞는 **마지막** 것 → 없으면 스키마 뿌리 갈래가 같은 마지막 것 →
   *      그것도 없으면 그냥 마지막 것. 모델은 예시·되풀이를 앞에, 답을 끝에 둔다 — 시킬말도
   *      「마지막 답은 JSON 하나」 라고 적는다. 스키마로 고르는 것은 그 규칙이 틀리는 날의
   *      두 번째 그물이다. 맞는 것이 없을 때도 갈래가 같은 쪽을 골라야 되묻는 탈 목록이
   *      엉뚱한 `[1]` 이야기가 아니라 진짜 답 이야기가 된다.
   */
  const 울타리후보 = [];
  for (const m of s.matchAll(/```(?:jsonc?)?[ \t]*\r?\n?([\s\S]*?)```/gi)) {
    const r = 해보기(m[1].trim());
    if (r) 울타리후보.push(r);
  }

  /*
   * 울타리 안 것이 **하나도 스키마에 안 맞으면** 맨글도 본다 (2.0.0 6회차 · Gemini 백엔드5역).
   *
   * 1) 을 그대로 두면 「예시는 이렇습니다: ```json {…} ``` 실제 답: {…}」 에서 울타리 안 예시만 보고
   * 그걸 답으로 냈다 — 스키마를 같이 받아 놓고도 울타리 밖의 맞는 답을 못 봤다. 맨글에서도 스키마에
   * **맞는** 것만 고르므로(아래 밖맞는것) 산문 속 우연한 `[1]` 은 여전히 안 뽑힌다.
   */
  const 스키마있나 = 스키마 !== null && 스키마 !== undefined;
  const 맞음 = (r) => { try { return 맞나(r.값, 스키마).ok; } catch { return false; } };
  const 울타리맞음 = 스키마있나 && 울타리후보.some(맞음);
  const 맨글후보 = [];
  if (!울타리후보.length || (스키마있나 && !울타리맞음)) {
    let i = 0;
    /*
     * 괄호가 수천 개 박힌 긴 답에서 끝없이 돌지 않게 묶는다 — **시작 자리 수가 아니라 훑은 글자 수**로
     * (2.0.0 6회차 모양6좁).
     *
     * 시작 자리 256번으로 묶었더니 「item[0] item[1] … 최종 답: {"a":1}」 처럼 앞 산문의 작은 괄호
     * 하나하나가 멀쩡한 JSON 이라 한 번씩을 다 쓰고, 끝의 진짜 답에 닿기 전에 멈춰 `[255]` 를 냈다.
     * 로그·코드 조각을 앞에 붙인 긴 답에서 그대로 생긴다. 비싼 것은 짝이 없는 괄호에서 글 끝까지
     * 훑는 쪽이라, 그 글자 수를 세어 글 길이의 64배(작은 글은 최소 64KB)를 넘으면 멈춘다.
     */
    const 훑기예산 = Math.max(64 * s.length, 64 * 1024);
    let 훑은 = 0;
    while (i < s.length && 훑은 <= 훑기예산) {
      const 다음 = 괄호찾기(s, i);
      if (다음 < 0) break;
      const 끝 = 짝찾기(s, 다음);
      훑은 += (끝 >= 0 ? 끝 + 1 : s.length) - 다음;
      const r = 끝 >= 0 ? 해보기(s.slice(다음, 끝 + 1)) : null;
      if (r) { 맨글후보.push(r); i = 끝 + 1; } else i = 다음 + 1;
    }
  }

  const 후보들 = 울타리후보.length ? 울타리후보 : 맨글후보;
  if (!후보들.length) return { ok: false, 왜: '답에서 JSON 을 못 찾았습니다' };
  let 고른것 = 후보들.at(-1);
  if (스키마있나) {
    const 맞는것 = 후보들.filter(맞음);
    // 울타리 안에 맞는 것이 없을 때만 — 울타리 밖에서 스키마에 맞는 것 (위 6회차 머리말).
    const 밖맞는것 = 울타리후보.length && !맞는것.length ? 맨글후보.filter(맞음) : [];
    const 갈래들 = 스키마 && typeof 스키마 === 'object'
      ? (Array.isArray(스키마.type) ? 스키마.type : (typeof 스키마.type === 'string' ? [스키마.type] : null))
      : null;
    const 같은갈래 = 갈래들 ? 후보들.filter((r) => 갈래들.some((t) => 갈래맞나(r.값, t))) : [];
    // 울타리 안에 맞는 것도 같은 갈래도 없을 때 — 울타리 밖의 같은 갈래 (2.0.0 6회차 모양6좁).
    // 이게 없으면 「예시: ```json [1,2]``` 답: {"a":1}」 에서 {"a":1} 을 두고 갈래도 다른 예시를 냈다.
    // 맞는 것이 없으니 되묻기로 가는 길이지만, 그 탈 목록이 진짜 답 이야기여야 모델이 고친다.
    const 밖같은갈래 = 갈래들 && 울타리후보.length && !맞는것.length && !같은갈래.length
      ? 맨글후보.filter((r) => 갈래들.some((t) => 갈래맞나(r.값, t)))
      : [];
    고른것 = 맞는것.at(-1) ?? 밖맞는것.at(-1) ?? 같은갈래.at(-1) ?? 밖같은갈래.at(-1) ?? 고른것;
  }
  return { ...고른것, 군말: true };
}

// i 자리부터 처음 나오는 `{` 또는 `[` 의 자리. 없으면 -1.
function 괄호찾기(s, i) {
  const a = s.indexOf('{', i);
  const b = s.indexOf('[', i);
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

/*
 * 시작 괄호와 짝이 맞는 닫는 괄호의 자리. 없으면 -1.
 *
 * 따옴표 안의 괄호를 안 세는 것이 중요하다 — `{"글": "}"}` 를 깊이로만 세면 첫 `}`
 * 에서 끊긴다. 따옴표는 **시작 괄호부터** 센다 — 그 앞 산문의 따옴표는 JSON 이 아니다.
 */
function 짝찾기(s, 시작) {
  const 열림 = s[시작];
  const 닫힘 = 열림 === '{' ? '}' : ']';
  let 깊이 = 0;
  let 글속 = false;
  for (let i = 시작; i < s.length; i++) {
    const ch = s[i];
    if (글속) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') 글속 = false;
      continue;
    }
    if (ch === '"') { 글속 = true; continue; }
    if (ch === 열림) 깊이++;
    else if (ch === 닫힘 && --깊이 === 0) return i;
  }
  return -1;
}

/**
 * 모델에게 붙일 말.
 *
 * 스키마를 통째로 싣는다 — 줄여 적으면 모델이 못 본 규칙을 어기고, 그러면
 * 우리가 재서 되돌리는 한 바퀴가 더 돈다. 그 한 바퀴가 모델 호출 한 번이라
 * 스키마를 다 싣는 것보다 비싸다.
 */
export function 시킬말(스키마, { 다시 = null } = {}) {
  const 몸 = [
    '',
    '── 답의 모양이 정해져 있습니다 ─────────────────────────────────',
    '',
    '마지막 답은 **JSON 하나**여야 하고, 아래 스키마에 맞아야 합니다.',
    '설명·인사·```울타리를 붙이지 마세요. JSON 만 내세요.',
    '',
    '```json',
    JSON.stringify(스키마, null, 2),
    '```',
    '',
    '모르는 값은 지어내지 말고, 스키마가 허락하면 null 이나 빈 배열로 두세요.',
    '지어낸 값 하나가 이 답을 받아 쓰는 쪽에서 조용히 틀린 결정이 됩니다.',
  ];
  if (다시?.length) {
    몸.push(
      '',
      '방금 낸 답이 아래에서 안 맞았습니다. 그것만 고쳐서 JSON 을 다시 내세요.',
      ...다시.map((x) => `  - ${x}`),
    );
  }
  return 몸.join('\n');
}

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
  'properties', 'required', 'additionalProperties',
  'items', 'minItems', 'maxItems',
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'anyOf', 'oneOf', 'allOf', 'not',
  '$ref', '$defs', 'definitions',
  // 재는 것이 아니라 적어 두는 것들. 모델에게 보여 줄 때 쓴다.
  '$schema', '$id', 'title', 'description', 'default', 'examples',
]);

const 아는것 = new Set(아는열쇠);
// 그 아래 열쇠가 규격 낱말이 아니라 '사람이 지은 칸 이름' 인 자리.
const 이름칸 = new Set(['properties', '$defs', 'definitions']);

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
      else 훑기(v);
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
  return { ok: true, 스키마: s, 모른것: 모르는열쇠(s) };
}

/** 같은 파일 안(`#`으로 시작)이 아닌 `$ref` 를 다 찾는다. */
export function 바깥ref찾기(스키마, 본것 = new Set()) {
  const out = [];
  const 훑기 = (s) => {
    if (!s || typeof s !== 'object' || 본것.has(s)) return;
    본것.add(s);
    if (Array.isArray(s)) { for (const x of s) 훑기(x); return; }
    if (typeof s.$ref === 'string' && !s.$ref.startsWith('#')) out.push(s.$ref);
    for (const v of Object.values(s)) if (v && typeof v === 'object') 훑기(v);
  };
  훑기(스키마);
  return [...new Set(out)];
}

/** `#/$defs/이름` 같은 자리를 뿌리에서 따라간다. 못 찾으면 null. */
function ref따라가기(뿌리, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) return null;
  const 길 = ref.slice(1).split('/').filter(Boolean)
    .map((x) => decodeURIComponent(x.replace(/~1/g, '/').replace(/~0/g, '~')));
  let 여기 = 뿌리;
  for (const 조각 of 길) {
    if (!여기 || typeof 여기 !== 'object') return null;
    여기 = 여기[조각];
  }
  return 여기 && typeof 여기 === 'object' ? 여기 : null;
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

/**
 * 값이 스키마에 맞나.
 *
 * 탈은 **다 모아서** 준다. 하나만 주면 고치고 다시 돌리고를 반복하게 되는데,
 * 그 한 바퀴가 모델 호출 한 번이라 값이 비싸다. 그리고 사람이 스키마를
 * 잘못 적은 경우에도 한 번에 다 보이는 편이 낫다.
 *
 * @returns {{ok: boolean, 탈: string[]}}
 */
export function 맞나(값, 스키마, { 뿌리 = 스키마, 자리 = '' } = {}) {
  const 탈 = [];
  const 여기 = 자리 || '(뿌리)';
  const s = 스키마;
  if (!s || typeof s !== 'object') return { ok: true, 탈 };

  // true/false 스키마와 $ref 를 먼저 푼다.
  if (typeof s.$ref === 'string') {
    const 간것 = ref따라가기(뿌리, s.$ref);
    if (!간것) return { ok: false, 탈: [`${여기}: 스키마 안에 ${s.$ref} 가 없습니다`] };
    return 맞나(값, 간것, { 뿌리, 자리 });
  }

  if (Array.isArray(s.type) ? !s.type.some((t) => 갈래맞나(값, t)) : (s.type && !갈래맞나(값, s.type))) {
    탈.push(`${여기}: ${Array.isArray(s.type) ? s.type.join('|') : s.type} 이어야 하는데 ${갈래(값)} 입니다`);
    // 갈래부터 틀리면 그 아래는 재 봐야 헛말만 늘어난다.
    return { ok: false, 탈 };
  }

  if (Array.isArray(s.enum) && !s.enum.some((x) => JSON.stringify(x) === JSON.stringify(값))) {
    탈.push(`${여기}: ${s.enum.map((x) => JSON.stringify(x)).join(' · ')} 중 하나여야 합니다`);
  }
  if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(값)) {
    탈.push(`${여기}: ${JSON.stringify(s.const)} 여야 합니다`);
  }

  if (typeof 값 === 'string') {
    if (Number.isFinite(s.minLength) && [...값].length < s.minLength) 탈.push(`${여기}: ${s.minLength}자 이상이어야 합니다`);
    if (Number.isFinite(s.maxLength) && [...값].length > s.maxLength) 탈.push(`${여기}: ${s.maxLength}자 이하여야 합니다`);
    if (typeof s.pattern === 'string') {
      // 스키마를 적은 사람의 정규식이 잘못됐을 수 있다. 그것도 탈로 말한다 —
      // 조용히 통과시키면 안 재고 있는 규칙이 하나 생긴다.
      try { if (!new RegExp(s.pattern).test(값)) 탈.push(`${여기}: ${s.pattern} 모양이어야 합니다`); }
      catch { 탈.push(`${여기}: 스키마의 pattern 이 잘못된 정규식입니다 (${s.pattern})`); }
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
    if (s.items && typeof s.items === 'object' && !Array.isArray(s.items)) {
      값.forEach((v, i) => 탈.push(...맞나(v, s.items, { 뿌리, 자리: `${여기}[${i}]` }).탈));
    }
  }

  if (값 !== null && typeof 값 === 'object' && !Array.isArray(값)) {
    for (const k of Array.isArray(s.required) ? s.required : []) {
      if (!Object.prototype.hasOwnProperty.call(값, k)) 탈.push(`${여기}: ${k} 칸이 없습니다`);
    }
    const 칸들 = s.properties && typeof s.properties === 'object' ? s.properties : {};
    for (const [k, v] of Object.entries(값)) {
      if (Object.prototype.hasOwnProperty.call(칸들, k)) {
        탈.push(...맞나(v, 칸들[k], { 뿌리, 자리: 여기 === '(뿌리)' ? k : `${여기}.${k}` }).탈);
      } else if (s.additionalProperties === false) {
        탈.push(`${여기}: ${k} 는 적으면 안 되는 칸입니다`);
      } else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
        탈.push(...맞나(v, s.additionalProperties, { 뿌리, 자리: 여기 === '(뿌리)' ? k : `${여기}.${k}` }).탈);
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
  if (s.not && typeof s.not === 'object' && 맞나(값, s.not, { 뿌리, 자리 }).ok) {
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
export function 답에서JSON뽑기(글) {
  const s = String(글 ?? '').trim();
  if (!s) return { ok: false, 왜: '답이 비었습니다' };

  const 해보기 = (t) => { try { return { ok: true, 값: JSON.parse(t) }; } catch { return null; } };

  const 그대로 = 해보기(s);
  if (그대로) return { ...그대로, 군말: false };

  // ```json … ``` 울타리
  const 울타리 = /```(?:json|jsonc)?\s*\n([\s\S]*?)\n?```/i.exec(s);
  if (울타리) {
    const r = 해보기(울타리[1].trim());
    if (r) return { ...r, 군말: true };
  }

  /*
   * 앞뒤에 말이 붙은 경우. 첫 `{`(또는 `[`)부터 짝이 맞는 자리까지 잘라 본다.
   *
   * 따옴표 안의 괄호를 안 세는 것이 중요하다 — `{"글": "}"}` 를 깊이로만
   * 세면 첫 `}` 에서 끊긴다.
   */
  const 시작 = Math.min(...['{', '['].map((ch) => { const i = s.indexOf(ch); return i < 0 ? Infinity : i; }));
  if (Number.isFinite(시작)) {
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
      else if (ch === 닫힘 && --깊이 === 0) {
        const r = 해보기(s.slice(시작, i + 1));
        if (r) return { ...r, 군말: true };
        break;
      }
    }
  }
  return { ok: false, 왜: '답에서 JSON 을 못 찾았습니다' };
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

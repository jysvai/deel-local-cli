// @파일 지목 — 말 속에 @경로 를 쓰면 그 파일을 바로 붙여 보낸다.
//
// 왜 필요한가:
//   지금은 파일 하나 보여주려면 모델이 Read 도구를 스스로 불러야 한다. 왕복이
//   한 번 더 든다. 로컬 모델은 도구 호출이 약해서 그 한 번이 자주 헛돈다 —
//   엉뚱한 경로를 부르거나, 아예 안 부르고 지어낸다. 사람은 이미 어느 파일인지
//   알고 있는데 모델더러 찾아보라고 시키는 셈이다.
//
// 여기서 어려운 것은 붙이는 일이 아니라 '아닌 것을 파일로 오해하지 않기' 다.
// @ 로 시작하는 것은 세상에 널렸다 — 이메일 주소, CSS 의 @media, 파이썬 장식자,
// npm 의 @scope/pkg, 사람 아이디. 잘못 붙이면 엉뚱한 글이 대화에 섞여 들어가고,
// 사람은 자기가 안 보낸 것이 왜 거기 있는지 모른다.
//
// 그래서 규칙을 하나로 뒀다: **실제로 있는 경로일 때만 붙인다.**
// 없으면 아무 말 없이 글자 그대로 둔다. 지목이 아니었을 테니 조용한 편이 맞다.
import { existsSync, statSync, readdirSync } from 'node:fs';
import { readTextFull } from '../tools/fsutil.js';
import { estimateTokens } from './session.js';

// 붙일 수 있는 최대 토큰. 부르는 쪽에서 컨텍스트에 맞춰 넘겨준다.
const 기본예산 = 6000;
const 폴더최대 = 60;      // 폴더를 지목했을 때 늘어놓을 항목 수
const 뒤에붙는것 = /[,.?!;:)\]}"'」』]+$/;

/**
 * 글에서 @지목을 찾는다. 붙일지 말지는 여기서 안 정한다 — 자리만 찾는다.
 *
 * @returns {Array<{path:string, start:number, end:number, raw:string}>}
 */
export function findMentions(text) {
  const s = String(text ?? '');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '@') continue;
    // 앞이 글자면 지목이 아니다 — hong@example.com 의 @ 가 여기서 걸러진다.
    const 앞 = i > 0 ? s[i - 1] : ' ';
    if (!/[\s(\[{'"]/.test(앞)) continue;

    // @"띄어쓰기 든 이름.txt" — 따옴표로 묶으면 통째로 하나다.
    if (s[i + 1] === '"' || s[i + 1] === "'") {
      const 따옴 = s[i + 1];
      const 끝 = s.indexOf(따옴, i + 2);
      if (끝 > i + 2) {
        out.push({ path: s.slice(i + 2, 끝), start: i, end: 끝 + 1, raw: s.slice(i, 끝 + 1) });
        i = 끝;
        continue;
      }
    }

    let j = i + 1;
    while (j < s.length && !/[\s"'`]/.test(s[j])) j++;
    if (j === i + 1) continue;                    // @ 뒤가 비었다
    const raw = s.slice(i, j);
    out.push({ path: s.slice(i + 1, j), start: i, end: j, raw });
    i = j - 1;
  }
  return out;
}

/** 이 지목이 가리키는 실제 자리. 못 찾거나 범위 밖이면 왜인지 같이 준다. */
function 찾아보기(m, scope) {
  const 후보 = [m.path];
  // 뒤에 붙은 문장부호를 떼고도 한 번 본다 — "@src/a.js, 이것" 처럼 쓴다.
  const 뗀것 = m.path.replace(뒤에붙는것, '');
  if (뗀것 && 뗀것 !== m.path) 후보.push(뗀것);

  for (const p of 후보) {
    if (!p) continue;
    let abs;
    try { abs = scope.resolve(p); }
    catch (err) { return { why: 'blocked', note: err.message, path: p }; }
    if (existsSync(abs)) return { abs, path: p };
  }
  return { why: 'missing', path: m.path };
}

function 폴더내용(abs, show) {
  let 목록 = [];
  try { 목록 = readdirSync(abs, { withFileTypes: true }); }
  catch (err) { return `(폴더를 못 읽었습니다: ${err.message})`; }
  const 줄들 = 목록.slice(0, 폴더최대).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  const 더 = 목록.length > 폴더최대 ? `\n… 전체 ${목록.length}개 중 ${폴더최대}개까지` : '';
  return `${show} 는 폴더입니다. 안에 든 것:\n${줄들.join('\n')}${더}`;
}

/**
 * @지목을 실제 내용으로 바꿔 붙인다.
 *
 * 글 자체는 안 건드린다 — 사람이 쓴 말은 그대로 두고, 뒤에 파일을 덧붙인다.
 * 지목한 자리를 내용으로 갈아치우면 "@src/a.js 이거 왜 느려?" 가 코드 덩어리
 * 한복판에서 끝나는 문장이 되어 버려서, 모델이 무엇을 물었는지 놓친다.
 *
 * @param {string} text
 * @param {{scope?:object, budget?:number, seen?:Set<string>, onRead?:Function}} opts
 *   seen 을 주면 통째로 붙은 파일을 '읽은 것' 으로 적어 둔다 — 그래야 Edit 이
 *   'Read 부터 하라' 며 되돌려 보내지 않는다. 잘린 파일은 안 적는다.
 *   안 본 데를 본 것으로 치면 그 자리를 그냥 고쳐 버린다.
 */
export function expand(text, { scope = null, budget = 기본예산, seen = null, onRead = null } = {}) {
  const 원문 = String(text ?? '');
  const 빈답 = { text: 원문, attached: [], missing: [], blocked: [] };
  if (!원문.includes('@') || !scope?.resolve) return 빈답;

  const 지목들 = findMentions(원문);
  if (!지목들.length) return 빈답;

  const attached = [];
  const missing = [];
  const blocked = [];
  const 붙일것 = [];
  const 본것 = new Set();
  let 남은예산 = Math.max(200, Number(budget) || 기본예산);

  for (const m of 지목들) {
    const 자리 = 찾아보기(m, scope);
    if (자리.why === 'blocked') { blocked.push({ path: 자리.path, why: 자리.note }); continue; }
    if (자리.why === 'missing') { missing.push(자리.path); continue; }
    if (본것.has(자리.abs)) continue;               // 같은 파일을 두 번 적지 않는다
    본것.add(자리.abs);

    const show = scope.show ? scope.show(자리.abs) : 자리.path;
    let 몸통;
    let 통째로 = true;

    try {
      if (statSync(자리.abs).isDirectory()) {
        몸통 = 폴더내용(자리.abs, show);
      } else {
        // 사내 파일은 CP949 가 흔하다. 그냥 읽으면 통째로 깨진다.
        const 읽음 = readTextFull(자리.abs);
        const 줄들 = 읽음.text.split('\n');
        const 붙은글 = 줄들.map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n');
        if (estimateTokens(붙은글) <= 남은예산) {
          몸통 = 붙은글;
        } else {
          // 예산만큼만 앞에서 자른다. 글자 수로 어림잡되 남는 쪽으로 잡는다.
          통째로 = false;
          const 어림 = Math.max(1, Math.floor(남은예산 * 3));
          const 자른것 = 붙은글.slice(0, 어림);
          const 마지막줄 = 자른것.split('\n').length;
          몸통 = `${자른것}\n… 전체 ${줄들.length}줄 중 ${마지막줄}줄까지만 붙였습니다 (나머지는 Read 로 읽으세요)`;
        }
        if (onRead) onRead(자리.abs, 읽음.text);
        if (통째로 && seen) seen.add(자리.abs);
      }
    } catch (err) {
      // 못 읽는 파일(바이너리 등)은 붙이지 않는다. 그렇다고 말은 해 준다.
      몸통 = `(못 읽었습니다: ${err.message})`;
      통째로 = false;
    }

    const 토막 = `\n\n--- ${show} ---\n${몸통}\n--- ${show} 끝 ---`;
    남은예산 -= estimateTokens(토막);
    붙일것.push(토막);
    attached.push({ path: 자리.abs, show, full: 통째로 });
    if (남은예산 <= 0) break;
  }

  if (!붙일것.length) return { text: 원문, attached, missing, blocked };
  const 머리 = attached.length === 1
    ? '아래는 사용자가 @ 로 지목한 파일입니다. 이미 읽은 것으로 치고 답하세요.'
    : `아래는 사용자가 @ 로 지목한 파일 ${attached.length}개입니다. 이미 읽은 것으로 치고 답하세요.`;
  return { text: `${원문}\n\n${머리}${붙일것.join('')}`, attached, missing, blocked };
}

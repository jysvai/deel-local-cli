/**
 * 지난 대화 찾기.
 *
 * 왜 필요한가:
 *   deel 은 대화를 .deel/sessions/*.jsonl 로 꼬박꼬박 남긴다. 그런데 지금까지
 *   할 수 있는 일은 목록을 보는 것(/sessions)과 통째로 이어받는 것(--continue)
 *   뿐이었다. "저번에 그 인코딩 문제 어떻게 풀었더라" 를 찾을 방법이 없었다.
 *   기록이 있는데 못 찾으면 없는 것과 같다.
 *
 * 왜 색인을 안 만드나:
 *   FTS 색인을 두면 빠르지만, 색인은 반드시 낡는다 — 대화 파일은 매 턴 늘어나고,
 *   딴 창에서도 늘어나고, 사람이 지우기도 한다. 낡은 색인은 **없는 것보다 나쁘다**:
 *   "못 찾았습니다" 가 "없습니다" 로 읽히기 때문이다.
 *   그래서 그때그때 읽는다. 대신 **얼마나 읽었고 무엇을 못 읽었는지 반드시 말한다.**
 *
 * 의존성 0 이라 점수도 직접 매긴다. 대단한 순위가 필요한 게 아니다 —
 * 낱말이 많이 맞고, 다 맞고, 최근인 것이 위로 오면 된다.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sessionsDir } from './store.js';
// 도구 부름·결과·글이 어디 실리는지는 규격마다 다르다 (backend/adapter.js).
import { 부른것들, 결과들, 도구결과인가, 본문글 } from '../backend/adapter.js';

// 한 번 찾을 때 읽을 최대 바이트. 넘으면 거기서 멈추고 **멈췄다고 말한다.**
export const 읽기예산 = 64 * 1024 * 1024;
// 한 메시지에서 볼 최대 길이. 파일을 통째로 붙인 도구 결과가 수 MB 씩 있다.
const 메시지최대 = 200 * 1024;

/**
 * 물음을 낱말로 쪼갠다.
 *
 * 한국어는 띄어쓰기가 낱말 경계와 안 맞는다("인코딩을" ≠ "인코딩"). 그래서
 * 조사처럼 보이는 꼬리를 떼어 **둘 다** 찾는다. 형태소 분석기를 붙일 수는 없다
 * (의존성 0). 이 정도만 해도 "인코딩을 어떻게" 로 "인코딩" 을 찾아낸다.
 */
export function 낱말쪼개기(물음) {
  const 조사 = /(을|를|이|가|은|는|에|에서|으로|로|와|과|의|도|만|까지|부터|에게|한테|보다|처럼|랑|이랑)$/;
  const 본 = String(물음 ?? '').toLowerCase().split(/[\s,.;:!?()[\]{}"'`]+/).filter(Boolean);
  const 낱말 = new Set();
  for (const w of 본) {
    if (w.length < 2) continue;         // 한 글자는 아무 데나 걸린다
    낱말.add(w);
    const 짧은 = w.replace(조사, '');
    if (짧은.length >= 2 && 짧은 !== w) 낱말.add(짧은);
  }
  return [...낱말];
}

/** 맞은 자리 앞뒤를 잘라 보여 줄 토막을 만든다. */
export function 토막내기(글, 낱말들, 폭 = 150) {
  const s = String(글 ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= 폭) return s;
  const 낮은 = s.toLowerCase();
  let 자리 = -1;
  for (const w of 낱말들) {
    const i = 낮은.indexOf(w);
    if (i >= 0 && (자리 < 0 || i < 자리)) 자리 = i;
  }
  if (자리 < 0) return s.slice(0, 폭) + '…';
  const 앞 = Math.max(0, 자리 - Math.floor(폭 / 3));
  return (앞 > 0 ? '…' : '') + s.slice(앞, 앞 + 폭) + (앞 + 폭 < s.length ? '…' : '');
}

/** 메시지 하나를 사람이 읽을 글로. 도구 호출은 이름과 인자만 남긴다. */
function 글로(m) {
  /*
   * 규격을 안 가린다.
   *
   * 여기가 `m.tool_calls` 와 `p?.text` 로만 읽고 있었다. Anthropic 꼴에서
   * 부름은 `tool_use` 블록(`.text` 가 없다)이고 결과는 `tool_result`
   * 블록(`.content` 다)이라 **둘 다 빈 글**로 떨어졌고, 빈 글은 아래에서
   * 버려진다. 그래서 그 창구로 한 일은 `/recall` 로 아무리 찾아도 안 나왔다 —
   * 「그런 얘기 한 적 없다」 와 구별이 안 되는 고장이다.
   */
  const 조각 = [];
  const 글 = 본문글(m);
  if (글) 조각.push(글);
  for (const t of 부른것들(m)) {
    let 인자 = '';
    try { 인자 = JSON.stringify(t.args ?? {}); } catch { /* 못 적어도 이름은 남긴다 */ }
    조각.push(`${t.name ?? '도구'}(${인자})`);
  }
  for (const r of 결과들(m)) if (r.글) 조각.push(r.글);
  return 조각.join(' ');
}

const 누구 = { user: '나', assistant: '모델', tool: '도구결과', system: '규칙' };

/**
 * 대화가 스스로 적어 둔 시각. 없거나 말이 안 되면 null 을 준다.
 *
 * 옛 기록에는 meta 줄이 아예 없고, 손으로 고치다 깨진 파일도 있다.
 * 여기서 터지면 /recall 이 통째로 죽는다 — 못 읽은 날짜 하나 때문에.
 */
function 때(meta) {
  const v = meta?.at;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 지난 대화에서 찾는다.
 *
 * @param {string} root 작업 폴더
 * @param {string} 물음
 * @param {{limit?: number, 예산?: number, 지금세션?: string, 도구결과까지?: boolean}} o
 * @returns {{맞은것: object[], 본파일: number, 전체파일: number, 읽은바이트: number, 예산초과: boolean, 낱말: string[]}}
 */
export function 찾기(root, 물음, o = {}) {
  const limit = o.limit ?? 8;
  const 예산 = o.예산 ?? 읽기예산;
  const 도구결과까지 = o.도구결과까지 ?? false;
  const 낱말 = 낱말쪼개기(물음);
  const dir = sessionsDir(root);

  const 빈결과 = { 맞은것: [], 본파일: 0, 전체파일: 0, 읽은바이트: 0, 예산초과: false, 낱말 };
  if (!낱말.length || !existsSync(dir)) return 빈결과;

  // 최근 것부터 본다. 예산이 모자라 멈추더라도 **쓸모 있는 쪽**에서 멈춘다.
  const 파일들 = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      const file = join(dir, name);
      const st = statSync(file);
      파일들.push({ id: name.slice(0, -6), file, at: st.mtime, bytes: st.size });
    } catch { /* 지워지는 중이거나 권한이 없다 */ }
  }
  파일들.sort((a, b) => b.at - a.at);

  const 맞은것 = [];
  let 읽은바이트 = 0;
  let 본파일 = 0;
  let 예산초과 = false;
  const 가장최근 = 파일들[0]?.at?.getTime?.() ?? Date.now();

  for (const f of 파일들) {
    if (읽은바이트 + f.bytes > 예산) { 예산초과 = true; break; }
    let 원문;
    try { 원문 = readFileSync(f.file, 'utf8'); } catch { continue; }
    읽은바이트 += f.bytes;
    본파일 += 1;

    // 파일 전체에 낱말이 하나도 없으면 줄을 쪼갤 것도 없다. 큰 파일에서 크게 빠르다.
    const 낮은전체 = 원문.toLowerCase();
    if (!낱말.some((w) => 낮은전체.includes(w))) continue;

    let 차례 = 0;
    let meta = null;
    for (const line of 원문.split('\n')) {
      if (!line) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.t === 'meta') { meta = j; continue; }
      차례 += 1;
      if (j.role === 'system') continue;
      // 결과가 어느 role 에 실리는지도 규격마다 다르다 (도구결과인가).
      if (!도구결과까지 && 도구결과인가(j)) continue;

      const 글 = 글로(j).slice(0, 메시지최대);
      if (!글) continue;
      const 낮은 = 글.toLowerCase();

      let 맞은낱말 = 0;
      let 횟수 = 0;
      for (const w of 낱말) {
        let n = 0;
        let i = 낮은.indexOf(w);
        while (i >= 0 && n < 50) { n += 1; i = 낮은.indexOf(w, i + w.length); }
        if (n) { 맞은낱말 += 1; 횟수 += n; }
      }
      if (!맞은낱말) continue;

      /*
       * 점수.
       *   낱말이 **몇 개나** 맞았나가 제일 세다 — 두 낱말이 다 나오는 글이
       *   한 낱말이 열 번 나오는 글보다 거의 언제나 원하는 것이다.
       *   최근일수록 조금 올린다. 같은 것을 두 번 물어본 경우 최근 답이 낫다.
       */
      const 다맞음 = 맞은낱말 === 낱말.length ? 12 : 0;
      const 오래됨 = Math.max(0, (가장최근 - f.at.getTime()) / (1000 * 60 * 60 * 24));
      const 최근점 = Math.max(0, 6 - 오래됨 / 7);
      맞은것.push({
        세션: f.id,
        // 화면에 적는 날짜는 **대화가 적어 둔 날**이지 파일이 만져진 날이 아니다.
        //
        // 이 도구는 오프라인 PC 로 폴더째 옮겨 다니는 것을 전제로 만들었다.
        // 그렇게 옮기면 mtime 은 옮긴 날로 전부 바뀐다 — 반 년 치 대화가
        // 하나같이 "오늘" 이 되고, 그러면 이 화면은 아무 말도 안 하는 셈이다.
        //
        // 점수(최근점)는 그대로 mtime 을 쓴다. 그건 파일을 읽기 전에 정해야
        // 하는 값이고(예산 순서), 순서가 조금 흔들리는 것은 날짜가 통째로
        // 거짓말하는 것과 무게가 다르다.
        언제: 때(meta) ?? f.at,
        model: meta?.model ?? null,
        role: j.role,
        누구: 누구[j.role] ?? j.role,
        차례,
        글,
        토막: 토막내기(글, 낱말),
        점수: 맞은낱말 * 10 + 다맞음 + Math.min(6, 횟수) + 최근점,
      });
    }
  }

  맞은것.sort((a, b) => b.점수 - a.점수 || b.언제 - a.언제);

  // 한 대화에서 열 줄이 몰려 나오면 다른 대화를 못 본다. 세션당 셋까지만.
  const 세션별 = new Map();
  const 추린것 = [];
  for (const h of 맞은것) {
    const n = 세션별.get(h.세션) ?? 0;
    if (n >= 3) continue;
    세션별.set(h.세션, n + 1);
    추린것.push(h);
    if (추린것.length >= limit) break;
  }

  return { 맞은것: 추린것, 본파일, 전체파일: 파일들.length, 읽은바이트, 예산초과, 낱말, 전체맞음: 맞은것.length };
}

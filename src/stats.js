// `deel stats` — 이 폴더에서 이 도구가 무엇을 했나.
//
// ── 왜 만드나 ──────────────────────────────────────────────────────────
//
// 감사기록(`.deel/audit.jsonl`)은 **쓰기만 하고 아무도 안 읽는 파일**이었다.
// 무엇을 언제 어떻게 했는지 전부 남는다고 팔아 놓고, 정작 그 파일을 사람 말로
// 되돌려 주는 명령이 없었다. `deel audit` 은 「무엇을 적는가」 라는 사양을
// 내놓는 명령이지 적힌 것을 읽는 명령이 아니다.
//
// 그런데 사내에 도구를 넣고 나면 곧바로 묻는 것이 이것이다.
//
//   · 이걸 실제로 쓰고는 있나 (달마다 갱신할지 정해야 한다)
//   · 무엇을 제일 많이 하나 (Read 만 하는지, 진짜로 고치는지)
//   · 막힌 적이 있나 (규칙이 실제로 걸리는지 — 안 걸리면 규칙이 아니다)
//   · 되돌린 적이 있나 (되돌리기가 안전망이라면 쓰인 적이 있어야 한다)
//
// 네 가지 다 이미 디스크에 적혀 있다. 읽어 주기만 하면 된다.
//
// ── 무엇을 안 하나 ─────────────────────────────────────────────────────
//
// **토큰과 돈은 안 적는다.** 감사기록에 그 값이 없기 때문이다. 없는 값을
// 그럴듯하게 지어내느니 없다고 말한다 — 요금표를 소스에 안 박는 것과 같은
// 까닭이다(backend/price.js). 이번 대화에서 쓴 것은 `/cost` 가 실측으로 낸다.
//
// **사람이 친 말은 안 보여 준다.** `turn` 줄에는 시킨 말이 (가려진 채로)
// 500자까지 남아 있는데, 여기서는 **세기만** 한다. 통계를 뽑으려고 연 화면이
// 옆 사람 어깨너머로 대화 내용을 보여 주는 화면이 되면 안 된다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 이 폴더의 감사기록 자리. */
export function 기록자리(root = process.cwd()) {
  return join(root, '.deel', 'audit.jsonl');
}

/** 하루. 이 PC 와 기록을 적은 PC 의 시계가 조금 어긋나는 것까지는 받는다. */
const 시계어긋남 = 86400000;

/**
 * 감사기록의 시각이 우리가 적은 꼴인가. 맞으면 견줄 수 있게 ISO 글자로, 아니면 null.
 *
 * 글자가 아니면(숫자·없음) 버린다. `Date.parse` 는 `"5"` 도 날짜로 읽으므로 앞머리가
 * `YYYY-MM-DDT` 인지도 본다. **이제보다 하루 넘게 뒤**인 것도 버린다 — 9999년 한 줄이
 * 「마지막으로 쓴 날」 을 영영 차지한다.
 */
function 성한시각(값, 이제) {
  if (typeof 값 !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(값)) return null;
  const t = Date.parse(값);
  if (!Number.isFinite(t) || t > 이제.getTime() + 시계어긋남) return null;
  return new Date(t).toISOString();
}

/**
 * 감사기록을 읽어 센다.
 *
 * 망가진 줄은 **버리되 세어 둔다.** 조용히 넘기면 「도구를 3번 썼다」 는 화면이
 * 사실은 300줄 중 3줄만 읽은 결과일 수 있다. 그 화면을 보고 사람은 아무도
 * 안 쓴다고 판단한다.
 *
 * @param {string} 자리  audit.jsonl 경로
 * @param {object} o
 * @param {number|null} o.날수  최근 며칠만. null 이면 전부
 * @param {Date} o.이제  '오늘' 을 언제로 볼까 (검사가 못 박는다)
 */
export function 세기(자리, { 날수 = 30, 이제 = new Date() } = {}) {
  if (!existsSync(자리)) return { 있나: false, 자리 };
  let 글 = '';
  try { 글 = readFileSync(자리, 'utf8'); }
  catch (err) { return { 있나: false, 자리, 못읽음: err?.message ?? String(err) }; }

  const 자름 = Number.isFinite(날수) && 날수 > 0
    ? new Date(이제.getTime() - 날수 * 86400000).toISOString()
    : null;

  const 셈 = {
    있나: true,
    자리,
    날수: 자름 ? 날수 : null,
    줄: 0,
    깨진줄: 0,
    // 자른 기간 밖이라 안 센 줄. 「예전 것도 있다」 를 말해 줘야 사람이
    // --days 를 늘려 볼 생각을 한다.
    지난줄: 0,
    처음: null,
    마지막: null,
    세션: new Set(),
    날: new Set(),
    대화: 0,
    도구: 0,
    도구실패: 0,
    // 됐는지 **모르는** 것. 성공에도 실패에도 안 넣는다 (아래 tool 갈래).
    도구모름: 0,
    도구별: new Map(),    // 이름 → { 수, 실패, 모름 }
    막힘: 0,
    막힌까닭: new Map(),  // 까닭 → 수
    되돌림: 0,
    비밀: 0,              // 도구 결과에서 비밀을 가린 횟수 (kind: 'secret')
  };

  for (const 줄 of 글.split('\n')) {
    if (!줄.trim()) continue;
    셈.줄 += 1;
    let r;
    try { r = JSON.parse(줄); } catch { 셈.깨진줄 += 1; continue; }
    if (!r || typeof r !== 'object' || Array.isArray(r)) { 셈.깨진줄 += 1; continue; }
    /*
     * ── 우리가 적은 꼴이 아닌 줄은 못 읽은 줄이다 ──────────────────────
     *
     * 시각이 없는 줄은 기간 자르기(`at && at < 자름`)를 그냥 지나 「최근 30일」
     * 안으로 들어왔고, 숫자 시각도 그랬고, 9999년 줄은 「마지막」 을 9999-12-31
     * 로 만들었다. 도구 이름이 객체면 「[object Object]」 라는 도구로 셌고, 이름이
     * 아예 없으면 「?」 라는 도구를 지어내 그 이름으로 셌다.
     * 감사기록(safety/audit.js)은 언제나 ISO 시각 글자와 도구 이름 글자를 적는다.
     * 그 꼴이 아니면 손으로 고쳤거나 다른 것이 섞인 줄이다 — 셈에 넣으면 숫자가
     * 조용히 틀리고, 버리기만 하면 몇 줄을 못 읽었는지가 사라진다. 그래서 센다.
     */
    const at = 성한시각(r.at, 이제);
    if (!at) { 셈.깨진줄 += 1; continue; }
    // 도구 이름은 **있어야** 한다. 없는 줄을 `?` 라는 도구로 세면 쓴 적 없는 도구가 화면에 생긴다.
    if (r.kind === 'tool' && (typeof r.tool !== 'string' || !r.tool)) { 셈.깨진줄 += 1; continue; }
    if (자름 && at < 자름) { 셈.지난줄 += 1; continue; }

    if (!셈.처음 || at < 셈.처음) 셈.처음 = at;
    if (!셈.마지막 || at > 셈.마지막) 셈.마지막 = at;
    셈.날.add(at.slice(0, 10));
    if (typeof r.session === 'string' && r.session) 셈.세션.add(r.session);

    switch (r.kind) {
      case 'turn': 셈.대화 += 1; break;
      case 'tool': {
        셈.도구 += 1;
        const 이름 = r.tool;   // 위에서 빈 이름을 이미 걸렀다 — 여기서 지어내지 않는다
        const 것 = 셈.도구별.get(이름) ?? { 수: 0, 실패: 0, 모름: 0 };
        것.수 += 1;
        /*
         * ok 가 없는 줄은 **모른다.** 성공도 실패도 아니다.
         *
         * 바로 위 주석이 「모르는 것을 좋은 쪽으로 세면 실패율이 늘 실제보다
         * 낮게 나온다」 라고 적어 두고, 정작 `ok === false` 만 세어서 ok 없는
         * 줄이 분모에만 들어갔다 — 그게 곧 성공으로 세는 것이다. 감사기록은
         * 언제나 ok 를 적으므로(safety/audit.js), 없는 줄은 옛 기록이거나 손으로
         * 고친 줄이다. 실패로 미는 것도 지어내는 것이라 **따로 세어 말한다.**
         */
        if (r.ok === false) { 것.실패 += 1; 셈.도구실패 += 1; }
        else if (r.ok !== true) { 것.모름 += 1; 셈.도구모름 += 1; }
        셈.도구별.set(이름, 것);
        break;
      }
      case 'blocked': {
        셈.막힘 += 1;
        // 글자가 아닌 까닭은 「[object Object]」 로 모이지 않게 없는 것으로 친다.
        const 왜 = typeof r.why === 'string' && r.why ? r.why : '(까닭 없음)';
        셈.막힌까닭.set(왜, (셈.막힌까닭.get(왜) ?? 0) + 1);
        break;
      }
      case 'undo': 셈.되돌림 += 1; break;
      case 'secret': 셈.비밀 += 1; break;
      default: break;
    }
  }
  return 셈;
}

/** 도구를 많이 쓴 차례로. 같으면 이름 차례 — 화면이 판마다 흔들리면 안 된다. */
export function 도구차례(셈, 몇 = 8) {
  return [...셈.도구별.entries()]
    .map(([이름, 것]) => ({ 이름, ...것 }))
    .sort((a, b) => b.수 - a.수 || a.이름.localeCompare(b.이름))
    .slice(0, 몇);
}

export function 막힘차례(셈, 몇 = 5) {
  return [...셈.막힌까닭.entries()]
    .map(([왜, 수]) => ({ 왜, 수 }))
    .sort((a, b) => b.수 - a.수 || a.왜.localeCompare(b.왜))
    .slice(0, 몇);
}

/** 기계가 읽을 모양. Map·Set 은 JSON 이 못 실으므로 여기서 편다. */
export function 셈JSON(셈) {
  if (!셈.있나) return { ok: false, 자리: 셈.자리, ...(셈.못읽음 ? { error: 셈.못읽음 } : {}) };
  return {
    ok: true,
    file: 셈.자리,
    days: 셈.날수,
    from: 셈.처음,
    to: 셈.마지막,
    lines: 셈.줄,
    broken: 셈.깨진줄,
    older: 셈.지난줄,
    sessions: 셈.세션.size,
    activeDays: 셈.날.size,
    turns: 셈.대화,
    tools: 셈.도구,
    toolFailures: 셈.도구실패,
    toolUnknown: 셈.도구모름,
    byTool: 도구차례(셈, 100).map((x) => ({ name: x.이름, calls: x.수, failures: x.실패, unknown: x.모름 })),
    blocked: 셈.막힘,
    blockedBy: 막힘차례(셈, 100).map((x) => ({ why: x.왜, count: x.수 })),
    undos: 셈.되돌림,
    secretsMasked: 셈.비밀,
  };
}

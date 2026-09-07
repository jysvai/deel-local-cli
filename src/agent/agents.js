/**
 * 이름 붙인 하위 작업 — `.deel/agents/*.json`.
 *
 * ── 무엇이 달라지나 ─────────────────────────────────────────────────────
 *
 * `Task` 는 이미 있다. 다만 **매번 처음부터 적어야** 한다 — 무슨 모드로, 어느
 * 모델에게, 무엇을 조심하며, 무엇이 끝나면 다 된 것인지. 팀에서 늘 같은 일을
 * 시키는데도 그렇다.
 *
 * 그래서 그 묶음에 이름을 붙여 파일 하나로 둔다. 그다음부터 부모 모델이 할 일은
 * 이것뿐이다 —
 *
 *   Task({ agent: "리뷰어", purpose: "…", task: "…" })
 *
 * 모드·모델·도구·지침·걸음 수는 그 파일이 들고 있다. 모델이 매번 고르지
 * 않으므로 **매번 다르게 고르는 일도 없어진다.** 사내에서 「검토는 이렇게
 * 한다」 를 글이 아니라 파일로 못 박는 자리다.
 *
 * ── 이건 스킬과 같은 무게다 ────────────────────────────────────────────
 *
 * 훅(safety/hooks.js)은 믿는 폴더에서만 읽는다 — **명령을 돌리기** 때문이다.
 * 여기는 안 돌린다. 지침은 글이고, 도구는 **줄이기만** 하고, 모델은 이 PC 설정에
 * 적힌 프로필 이름으로만 고른다. 즉 스킬·DEEL.md 와 같은 갈래라, 같은 규칙으로
 * 읽는다(skills/discover.js). 여기만 다른 규칙을 두면 사람은 왜 어떤 파일은
 * 읽히고 어떤 파일은 안 읽히는지 알 수 없게 된다.
 *
 * 그래도 두 줄은 못 박는다.
 *
 *   · **도구는 줄이기만 한다.** 정의에 적은 이름 중 모드가 이미 주는 것만
 *     남긴다. 설계 모드에 `Write` 를 적어 넣는 것으로 「파일을 안 바꾼다」 는
 *     약속을 깨고 나갈 길이 생기면 안 된다.
 *   · **모드는 부모보다 셀 수 없다.** task.js 의 하위모드() 를 그대로 지난다.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { frontmatter } from '../skills/discover.js';

/** 한 폴더에서 읽을 수 있는 수. 스무 개를 넘기면 목록이 프롬프트를 먹는다. */
export const 최대 = 24;
/** 설명 한 줄의 길이. 이 글이 매 요청에 실린다. */
export const 설명길이 = 140;

export const 자리들 = (밑) => [join(밑, '.deel', 'agents'), join(밑, '.claude', 'agents')];

/** 파일 이름에서 뽑은 이름. 확장자와 경로를 뗀 것. */
const 이름뽑기 = (파일) => 파일.replace(/\.(json|md)$/i, '').trim();

/**
 * 정의 하나를 우리 모양으로 편다.
 *
 * 못 알아들으면 null 을 돌려주고, 왜인지는 부르는 쪽이 적는다. 조용히 버리면
 * 사람은 제가 만든 에이전트가 왜 안 보이는지 영영 모른다.
 */
export function 한정의(이름, 것, 출처) {
  const 설명 = String(것?.설명 ?? 것?.description ?? '').trim();
  if (!설명) return null;      // 설명이 없으면 부모 모델이 고를 수가 없다
  const 도구 = 것?.도구 ?? 것?.tools ?? null;
  return {
    이름: String(이름).trim(),
    설명: 설명.length > 설명길이 ? `${설명.slice(0, 설명길이)}…` : 설명,
    모드: String(것?.모드 ?? 것?.mode ?? '').trim() || null,
    모델: String(것?.모델 ?? 것?.model ?? '').trim() || null,
    /*
     * 도구는 **적힌 것만** 쓴다. 배열로도 쉼표 글로도 받는다 — 사람이 손으로
     * 적는 파일이라 둘 다 온다.
     */
    도구: Array.isArray(도구)
      ? 도구.map((x) => String(x).trim()).filter(Boolean)
      : (typeof 도구 === 'string' && 도구.trim()
        ? 도구.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)
        : null),
    지침: String(것?.지침 ?? 것?.prompt ?? 것?.본문 ?? '').trim() || null,
    걸음: Number.isFinite(Number(것?.걸음 ?? 것?.maxSteps)) && Number(것?.걸음 ?? 것?.maxSteps) > 0
      ? Math.min(Math.floor(Number(것?.걸음 ?? 것?.maxSteps)), 200)
      : null,
    출처,
  };
}

function 파일하나(경로, 파일, 출처) {
  const 이름 = 이름뽑기(파일);
  if (!이름) return { 왜: `${파일}: 이름이 없습니다` };
  const 글 = readFileSync(경로, 'utf8');
  if (extname(파일).toLowerCase() === '.json') {
    let j;
    try { j = JSON.parse(글); } catch (e) { return { 왜: `${파일}: JSON 이 아닙니다 — ${e.message}` }; }
    const r = 한정의(j?.이름 ?? j?.name ?? 이름, j, 출처);
    return r ? { 것: r } : { 왜: `${파일}: 설명이 없습니다 (설명 · description)` };
  }
  /*
   * `.md` 도 받는다 — Claude Code 의 에이전트 파일이 그 모양이다.
   *
   * MCP 에서 mcpServers 를, 훅에서 hooks 를 그대로 받는 것과 같은 판단이다.
   * 이미 그 파일을 가진 사람에게 「우리 모양으로 다시 적어라」 고 하면, 그
   * 사람은 이 기능을 안 쓴다. 본문은 통째로 지침이 된다.
   */
  const { data, body } = frontmatter(글);
  const r = 한정의(data?.name ?? data?.이름 ?? 이름, { ...data, 지침: data?.지침 ?? body }, 출처);
  return r ? { 것: r } : { 왜: `${파일}: 앞머리에 description 이 없습니다` };
}

function 폴더하나(폴더, 출처, 모은것, 버린것) {
  if (!existsSync(폴더)) return;
  let 것들;
  try { 것들 = readdirSync(폴더, { withFileTypes: true }); } catch { return; }
  for (const d of 것들) {
    if (!d.isFile()) continue;
    if (!/\.(json|md)$/i.test(d.name)) continue;
    if (모은것.size >= 최대) { 버린것.push(`${최대}개까지만 읽습니다 — ${d.name} 부터는 안 읽었습니다`); break; }
    try {
      const r = 파일하나(join(폴더, d.name), d.name, 출처);
      if (r.것) 모은것.set(r.것.이름, r.것); else 버린것.push(r.왜);
    } catch (e) {
      버린것.push(`${d.name}: 못 읽었습니다 — ${e.message}`);
    }
  }
}

/**
 * 이 자리에서 쓸 에이전트를 다 읽는다.
 *
 * 이 PC 것을 먼저, 프로젝트 것을 나중에 읽는다 — 이름이 같으면 **가까운
 * 쪽이 이긴다.** 스킬과 같은 규칙이다(skills/discover.js 의 dedupe).
 */
export function 에이전트읽기(root, { 집 = homedir(), env = process.env } = {}) {
  const 모은것 = new Map();
  const 버린것 = [];
  const 끔 = String(env.DEEL_AGENTS ?? '').trim().toLowerCase();
  if (끔 === 'off' || 끔 === '0' || 끔 === 'false') {
    return { 에이전트들: [], 버린것: [], 켜짐: false };
  }
  for (const 폴더 of 자리들(집)) 폴더하나(폴더, '이 PC', 모은것, 버린것);
  for (const 폴더 of 자리들(root)) 폴더하나(폴더, '프로젝트', 모은것, 버린것);
  return { 에이전트들: [...모은것.values()], 버린것, 켜짐: true };
}

/** 이름으로 찾는다. 대소문자는 안 가린다 — 사람이 부르는 이름이다. */
export function 찾기(에이전트들, 이름) {
  const s = String(이름 ?? '').trim().toLowerCase();
  if (!s) return null;
  return (에이전트들 ?? []).find((a) => a.이름.toLowerCase() === s) ?? null;
}

/**
 * `Task` 스키마의 `agent` 칸에 붙일 설명.
 *
 * 이름과 한 줄 설명만 싣는다. 지침 본문은 **고른 뒤에** 하위 프롬프트로 가지,
 * 여기 실리지 않는다 — 여기 실으면 안 쓰는 에이전트의 지침까지 매 요청에
 * 나간다. 스킬을 2단계로 올리는 것과 같은 셈법이다(skills/discover.js).
 */
export function 고를말(에이전트들) {
  if (!에이전트들?.length) return null;
  const 목록 = 에이전트들.map((a) => `${a.이름}(${a.설명})`).join(' · ');
  return '**미리 정해 둔 하위 작업**을 이름으로 고른다. 고르면 그 정의가 모드·모델·도구·지침을'
    + ' 대신 정하므로, mode·model 은 안 적어도 된다. 쓸 수 있는 이름: ' + 목록
    + '. 여기 없는 이름은 지어내지 마라 — 안 먹는다.';
}

/**
 * 하위에게 줄 지침을 한 덩이로 만든다.
 *
 * 시킨 일보다 **앞에** 놓는다. 지침은 「어떻게 하는가」 이고 시킨 일은
 * 「무엇을 하는가」 인데, 뒤에 놓으면 모델이 마지막에 읽은 것을 일로 여긴다.
 */
export function 할일합치기(정의, 할일) {
  if (!정의?.지침) return 할일;
  return `${정의.지침}\n\n---\n\n${할일}`;
}

/**
 * 정의가 적은 도구로 **줄인다.** 늘리지 않는다.
 *
 * 이게 이 파일에서 제일 중요한 함수다. 모드가 안 주는 도구를 정의에 적어
 * 넣는 것으로 그 모드의 약속이 깨지면 안 된다 — 설계 모드에 `Write` 를
 * 적는 것 한 줄이 「파일을 안 바꾼다」 를 없던 일로 만든다.
 *
 * 정의에 적은 이름 중 **하나도 안 남으면** 줄이지 않는다. 도구가 0개인
 * 하위는 아무것도 못 하고 걸음만 태우는데, 그 까닭이 화면 어디에도 안
 * 나타난다. 오타 하나가 조용한 실패가 되는 자리라 그렇게는 안 한다.
 *
 * @returns {{도구:string[], 못준것:string[]}}
 */
export function 도구줄이기(정의, 모드가준것) {
  const 있는것 = 모드가준것 ?? [];
  if (!정의?.도구?.length) return { 도구: 있는것, 못준것: [] };
  const 남길것 = 정의.도구.filter((n) => 있는것.includes(n));
  const 못준것 = 정의.도구.filter((n) => !있는것.includes(n));
  return { 도구: 남길것.length ? 남길것 : 있는것, 못준것 };
}

/** 화면 한 줄 (`/agents` · doctor). */
export function 에이전트줄들(r) {
  const 줄 = [];
  if (!r.켜짐) { 줄.push({ 상태: 'warn', 이름: '에이전트', 값: '꺼져 있습니다 (DEEL_AGENTS=off)' }); return 줄; }
  for (const 왜 of r.버린것 ?? []) 줄.push({ 상태: 'warn', 이름: '에이전트 · 못 읽음', 값: 왜 });
  if (!r.에이전트들.length) return 줄;
  줄.push({
    상태: 'ok', 이름: '에이전트', 값: `${r.에이전트들.length}개`,
    덧말: r.에이전트들.map((a) => a.이름).join(' · '),
  });
  return 줄;
}

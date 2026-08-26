/**
 * 한 세션 안에서 여러 모델 쓰기.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────
 *
 * 로컬에서는 모델 하나를 골라도 늘 어딘가 아쉽다. 7B 는 계획을 잘 세우는데
 * 파일 열 개를 고치다 보면 창이 차고, 1.5B 는 창은 넉넉한데 무엇을 할지를
 * 못 정한다. 클라우드였으면 큰 것 하나로 끝날 일인데, 8GB 램에서는 둘 다
 * 올려 두고 **나눠 쓰는 것**이 실제로 가능한 유일한 길이다.
 *   7B q4 (약 4.4GB) + 1.5B q4 (약 1.3GB) ≒ 5.7GB — 8GB 안에 들어간다.
 *
 * 그래서 두 자리를 연다.
 *   Task 에 `모델`     큰 것이 계획을 쥐고, 잔일 한 덩이를 작은 것에 떼어 준다.
 *   /ask <프로필>      지금 쓰던 것을 안 바꾸고 다른 모델에게 한 번 물어본다.
 *
 * ── 안 하는 것 ─────────────────────────────────────────────────────────
 *
 * 요약(compact)을 작은 모델에게 안 넘긴다. 요약은 '무엇을 버려도 되는가' 를
 * 정하는 일이라 대화 전체를 제일 잘 아는 쪽이 해야 하는데, 그게 작은 모델이면
 * 버려선 안 될 것을 버린다. 그 손해는 몇 턴 뒤에야 드러나고, 그때는 원인을
 * 못 찾는다. 토큰 몇 푼 아끼자고 낼 값이 아니다.
 *
 * ── 경계선은 어떻게 되나 ───────────────────────────────────────────────
 *
 * 이게 이 파일에서 제일 조심한 자리다. deel 은 나갈 수 있는 자리를 **하나만**
 * 연다(safety/network.js). 둘째 모델을 쓴다는 것은 그 자리를 하나 더 연다는
 * 뜻이고, 그 자리가 바깥 게이트웨이면 "이 컴퓨터 안" 이 조용히 거짓이 된다.
 *
 *   1) 모델이 주소를 지어낼 수 없다. **사람이 설정에 적어 둔 프로필**만 쓴다.
 *   2) 그 일이 도는 동안만 열고 끝나면 닫는다 (allowTemporarily).
 *   3) 주소가 지금 쓰는 것과 다르면 **화면과 감사기록에 그렇게 적는다.**
 *      조용히 열면 그게 제일 나쁘다.
 *   4) 오프라인 잠금이면 이 컴퓨터 밖 프로필은 아예 못 쓴다.
 */
import { load, activeProfile, resolveKey } from '../config.js';
import { isLocalHost, isOffline } from '../safety/network.js';

// 컨텍스트를 못 알아냈을 때 쓰는 값. repl.js 와 같은 값을 봐야 한다.
export const CTX_DEFAULT = 32768;

/**
 * 프로필 하나로 연결을 만든다.
 *
 * repl.js 도 이걸 쓴다. 두 군데서 따로 만들면 한쪽에만 손이 가고, 그러면
 * `/ask` 로 부른 모델만 스트리밍이 꺼져 있다거나 하는 일이 생긴다 —
 * 화면에는 "느리네" 로만 보이고 원인은 안 보인다.
 */
export function 연결만들기(prof, { ctx = null, maxTokens = null } = {}) {
  if (!prof) return null;
  return {
    kind: prof.kind,
    base: prof.baseUrl,
    auth: prof.auth,
    key: resolveKey(prof),
    model: prof.model,
    ctx: ctx ?? prof.ctx ?? CTX_DEFAULT,
    maxTokens: maxTokens ?? prof.maxTokens ?? null,
    streaming: prof.streaming ?? false,
    tools: prof.tools ?? false,
    json: prof.json ?? false,
    think: prof.think ?? false,
  };
}

/** 설정에 있는 프로필들. */
export function 프로필들(cfg = load()) {
  return Array.isArray(cfg?.profiles) ? cfg.profiles : [];
}

/**
 * 이름으로 프로필 찾기.
 *
 * id → 이름 → 모델 이름 → 앞부분 일치 순으로 본다. 사람은 `/ask small ...`
 * 처럼 기억나는 대로 치지, 설정에 적은 id 를 외우고 있지 않다.
 *
 * 앞부분 일치에서 **둘 이상 걸리면 고르지 않는다.** 아무거나 골라 주면
 * 물어본 사람은 어느 모델이 답했는지 모른 채로 그 답을 믿게 된다.
 */
export function 프로필찾기(이름, cfg = load()) {
  const q = String(이름 ?? '').trim().toLowerCase();
  if (!q) return { ok: false, why: '없음', 후보: [] };
  const 목록 = 프로필들(cfg);
  if (!목록.length) return { ok: false, why: '설정에 프로필이 하나도 없습니다', 후보: [] };

  const 딱 = 목록.find((p) => String(p.id).toLowerCase() === q)
    ?? 목록.find((p) => String(p.name ?? '').toLowerCase() === q)
    ?? 목록.find((p) => String(p.model ?? '').toLowerCase() === q);
  if (딱) return { ok: true, prof: 딱, 후보: [딱] };

  const 걸린것 = 목록.filter((p) => [p.id, p.name, p.model]
    .some((v) => String(v ?? '').toLowerCase().includes(q)));
  if (걸린것.length === 1) return { ok: true, prof: 걸린것[0], 후보: 걸린것 };
  if (걸린것.length > 1) {
    return { ok: false, why: `'${이름}' 에 여러 개가 걸립니다`, 후보: 걸린것 };
  }
  return { ok: false, why: `'${이름}' 이라는 프로필이 없습니다`, 후보: [] };
}

/**
 * 이 프로필로 나가도 되는가.
 *
 * 오프라인 잠금은 여기서도 지킨다. 잠갔는데 하위 작업만 밖으로 나가면,
 * 잠금은 화면에만 있고 실제로는 안 잠긴 것이 된다.
 */
export function 쓸수있나(prof) {
  if (!prof?.baseUrl) return { ok: false, why: '주소가 없는 프로필입니다' };
  let 로컬 = false;
  try { 로컬 = isLocalHost(new URL(prof.baseUrl).hostname); } catch {
    return { ok: false, why: `주소를 읽을 수 없습니다: ${prof.baseUrl}` };
  }
  if (isOffline() && !로컬) {
    return { ok: false, why: '오프라인 잠금 중입니다 — 이 컴퓨터 밖 프로필은 못 씁니다' };
  }
  return { ok: true, 로컬 };
}

/** 두 주소가 같은 자리인가. 다르면 사람에게 알려야 한다. */
export function 같은자리(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

/**
 * 다른 모델을 쓸 때 화면과 감사기록에 남길 한 줄.
 *
 * 같은 자리면 모델 이름만, 다른 자리면 **어디로 나가는지**까지 적는다.
 * 이 줄이 없으면 사람은 제 소스가 어느 서버로 갔는지 알 방법이 없다.
 * @returns {{말: string, 밖으로: boolean, 다른자리: boolean}}
 */
export function 알릴말(지금conn, 새conn) {
  const 다른자리 = !같은자리(지금conn?.base, 새conn?.base);
  let 밖으로 = false;
  try { 밖으로 = !isLocalHost(new URL(새conn.base).hostname); } catch { 밖으로 = true; }
  if (!다른자리) return { 말: `모델 ${새conn.model}`, 밖으로, 다른자리 };
  let 어디 = 새conn.base;
  try { 어디 = new URL(새conn.base).host; } catch { /* 못 읽으면 통째로 */ }
  return {
    말: `모델 ${새conn.model} · ${밖으로 ? '바깥' : '이 컴퓨터 안'} ${어디}`,
    밖으로,
    다른자리,
  };
}

/**
 * 지금 붙어 있는 프로필. `/ask` 가 '나 자신에게 묻기' 를 걸러낼 때 쓴다.
 */
export function 지금프로필(cfg = load()) {
  return activeProfile(cfg);
}

/**
 * 화면에 낼 프로필 한 줄들.
 * @returns {{id:string, name:string, model:string, 어디:string, 로컬:boolean, 지금:boolean}[]}
 */
export function 목록보기(cfg = load()) {
  const 지금 = 지금프로필(cfg);
  return 프로필들(cfg).map((p) => {
    let 어디 = String(p.baseUrl ?? '');
    let 로컬 = false;
    try { const u = new URL(p.baseUrl); 어디 = u.host; 로컬 = isLocalHost(u.hostname); } catch { /* 못 읽으면 통째로 */ }
    return {
      id: p.id,
      name: p.name ?? p.id,
      model: p.model ?? '',
      어디,
      로컬,
      지금: 지금?.id === p.id,
    };
  });
}

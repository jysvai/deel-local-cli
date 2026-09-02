// 열쇠를 우리가 갖고 있지 않고, 그때그때 **받아 온다.**
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────
//
// 사내 게이트웨이는 고정된 열쇠를 안 준다. 한 시간짜리 토큰을 주고, 그것도
// 사내 로그인(SSO)을 거쳐야 나온다. 그러면 지금 구조로는 이렇게 된다.
//
//   1. 아침에 사내 포털에서 토큰을 복사한다
//   2. `deel setup` 에 붙여 넣는다
//   3. 점심 때 만료된다. 화면에는 `HTTP 401` 한 줄
//   4. 1번으로
//
// 이건 못 쓰는 물건이다. 그리고 3번이 제일 나쁘다 — 401 은 「열쇠가 틀렸다」
// 와 「열쇠가 늙었다」 를 구별해 주지 않아서, 사람은 열쇠를 다시 발급받으러
// 간다. 발급받아도 한 시간 뒤 같은 화면을 본다.
//
// 그래서 **열쇠를 적어 두는 대신, 열쇠를 얻는 방법을 적어 둔다.**
//
//     "열쇠받기": { "명령": "az account get-access-token --query accessToken -o tsv",
//                   "수명": 3600 }
//
// ── 왜 이름이 `열쇠받기` 인가 ──────────────────────────────────────────
//
// 처음 계획은 `인증` 이었다. 그런데 프로필에는 이미 `auth` 가 있고, 그건
// **머리말 모양**(bearer · x-api-key · api-key)을 뜻한다. 한 덩이 안에
// `auth` 와 `인증` 이 서로 다른 뜻으로 나란히 앉으면, 둘 중 하나는 반드시
// 잘못 적힌다. 하는 일 그대로 부른다.
//
// ── 지키는 선 ──────────────────────────────────────────────────────────
//
// 1) **경로는 사람이 직접 적는다.** 찾아 주지 않는다. `az` 가 PATH 에 있나
//    보고 알아서 부르는 짓을 하면, 이 프로그램이 언제 무엇을 실행할지 사람이
//    모르게 된다. 못 적었으면 못 쓰는 것이고, 그게 맞다.
// 2) **딴 프로세스로 띄운다.** import 하지 않는다. 남이 적어 준 코드를 우리
//    프로세스 안에서 돌리면 그 코드가 우리 메모리(다른 열쇠·대화)를 본다.
// 3) **봉인(offline)에서는 안 부른다.** 이 안에서만 돌겠다고 해 놓고 사내
//    포털에 로그인하러 나가면 그건 약속을 깬 것이다.
// 4) **실을 자리가 없으면 안 부른다.** `auth: 'none'` 인 연결(로컬 Ollama 가
//    그렇다)에는 열쇠를 실을 머리말이 아예 없다. 브라우저만 뜨고 끝난다.
// 5) **한 번 묻고 기억한다.** 관리 정책이 준 명령은 안 묻는다 — 회사가 정한
//    것을 개인이 승인하는 모양은 뜻이 안 맞는다.
// 6) **디스크에 안 적는다.** 받은 토큰은 이 프로세스 메모리에만 있다. 파일에
//    적으면 지금 config.json 에 평문으로 두는 것과 같아진다.
// 7) **가린다.** 토큰도, 머리말 값도, 명령이 stderr 로 뱉은 것도. 사내 로그인
//    도구는 오류 메시지에 토큰을 통째로 찍는 것이 드물지 않다.
import { spawn } from 'node:child_process';
import { 셸명령 } from '../tools/shell.js';
import { isOffline } from './network.js';
import { 가리기 } from './secrets.js';

/** 기다려 주는 시간. 사내 로그인은 브라우저를 열고 사람을 기다린다. */
export const 기본기다림 = 180000;

/** 수명을 안 알려 줄 때 몇 초짜리로 볼까. 짧게 잡는다 — 늦게 아는 것보다 낫다. */
export const 기본수명 = 3300;

/*
 * 만료 얼마 전부터 미리 받아 오나.
 *
 * 딱 만료 시각까지 쓰면, 보내는 순간에는 살아 있던 토큰이 게이트웨이에 닿을
 * 때 죽어 있다. 그 한 번이 401 이고, 사람 눈에는 그냥 실패로 보인다.
 */
export const 미리 = 60000;

let 마지막명령줄 = null;
/**
 * 마지막으로 띄운 명령줄. 검사가 **열쇠가 명령줄에 안 실렸는지** 볼 때 쓴다.
 * (safety/keystore.js 의 마지막명령줄 과 같은 뜻이다.)
 */
export function 마지막명령() { return 마지막명령줄; }

let 받은것 = null;      // { token, headers, 만료, 언제 } — 메모리에만. 파일로 안 나간다.
let 물어본것 = null;    // 이번 판에 사람이 뭐라고 답했나 (true/false)

/** 검사와 `/model` 갈아타기가 부른다. */
export function 잊기() { 받은것 = null; 물어본것 = null; 마지막명령줄 = null; }

/** 지금 들고 있는 것. 없으면 null. 화면·심사서가 **토큰 없이** 상태만 볼 때. */
export function 지금상태() {
  if (!받은것) return null;
  return { 있음: true, 만료: 받은것.만료, 남은초: Math.max(0, Math.round((받은것.만료 - Date.now()) / 1000)) };
}

/**
 * 이 프로필이 열쇠를 받아 오게 되어 있나.
 *
 * 정책이 이긴다. 회사가 "이 게이트웨이는 이 명령으로만" 이라고 정했으면
 * 개인 설정이 그것을 못 바꾼다 — safety/policy.js 와 같은 순서다.
 *
 * @returns {{명령: string, 수명: number, 곳: '정책'|'설정'}|null}
 */
export function 받기설정(프로필, { 정책값 = null } = {}) {
  /*
   * 영어 이름도 받는다.
   *
   * 설정 파일은 **사람이 손으로 적는 것**이다. `열쇠받기`·`명령`·`수명` 은
   * 한글 자판이 없는 사람에게는 옮겨 적을 수조차 없는 글자다. 화면을 영어로
   * 켤 수 있게 해 놓고 설정만 한글로 두면, 그 사람은 이 기능을 못 쓴다.
   *
   * 코드 안의 이름은 그대로 한국어다 — 그건 이 저장소의 뜻이라 안 바꾼다.
   * 바깥에서 들어오는 이름만 두 벌 받는다 (price.js 의 입력·in·input 과 같다).
   */
  const 고르기 = (것, 곳) => {
    const 명령 = String(것?.명령 ?? 것?.command ?? '').trim();
    if (!명령) return null;
    const 수명 = Number(것?.수명 ?? 것?.ttl);
    return { 명령, 수명: Number.isFinite(수명) && 수명 > 0 ? Math.floor(수명) : 기본수명, 곳 };
  };
  const 칸 = (x) => x?.열쇠받기 ?? x?.authCommand ?? null;
  return 고르기(칸(정책값), '정책') ?? 고르기(칸(프로필), '설정');
}

/**
 * 지금 이 연결에서 열쇠받기를 써도 되나. 안 되면 왜 안 되는지를 같이 준다.
 *
 * 「쓸 수 있나」 와 「적혀 있나」 는 다른 물음이다. 적혀 있는데 봉인이라 안
 * 부르는 것은 고장이 아니라 약속을 지키는 것이고, 그 사실이 화면에 보여야
 * 사람이 왜 열쇠가 안 붙는지 안다.
 */
export function 쓸수있나(설정, { auth = 'bearer', 봉인 = isOffline() } = {}) {
  if (!설정) return { 된다: false, 왜: null };
  if (봉인) return { 된다: false, 왜: '봉인(offline) 중이라 열쇠를 받으러 나가지 않습니다' };
  /*
   * 실을 자리가 없으면 안 받는다.
   *
   * 처음에는 「이 컴퓨터 안의 서버(127.0.0.1)면 안 받는다」 로 잡았다.
   * 막으려던 것은 로컬 Ollama 에 사내 토큰을 실어 보내는 일이었는데,
   * 주소로 가르면 **localhost 로 회사 게이트웨이를 중계하는 구성**까지
   * 같이 막힌다 — 사이드카 프록시나 `kubectl port-forward` 가 그 모양이고,
   * 그때는 주소만 이 안이지 열쇠는 진짜로 필요하다.
   *
   * 진짜 갈림은 주소가 아니라 `auth` 다. 로컬 Ollama 프로필은 `auth: 'none'`
   * 이라 애초에 열쇠를 실을 자리가 없다 — 막으려던 것이 정확히 여기서 막힌다.
   * 그리고 자리가 없는데 명령을 띄우면 브라우저만 뜨고 아무 일도 안 된다.
   */
  if (String(auth ?? 'none') === 'none') {
    return { 된다: false, 왜: '이 연결은 열쇠를 안 씁니다 (auth: none) — 받아 봐야 실을 자리가 없습니다' };
  }
  return { 된다: true, 왜: null };
}

/*
 * 토큰으로 볼 수 있는 글자.
 *
 * 사내 로그인 도구는 토큰만 깔끔하게 뱉지 않는다. 배너를 찍고, 「Logged in as
 * …」 를 찍고, 그 다음 줄에 토큰을 찍는다. 그걸 통째로 Authorization 에 실으면
 * 게이트웨이는 400 을 주고, 화면에는 열쇠가 틀린 것처럼 보인다.
 *
 * 그래서 **한 줄이고 토큰 글자만인 것**만 받는다. 아니면 거절하고, 무엇이
 * 왔는지 첫 줄을 보여 준다 — 그래야 사람이 `--query` 를 붙일 줄 안다.
 */
const 토큰글자 = /^[A-Za-z0-9._~+/=-]{16,8192}$/;

/**
 * 명령이 뱉은 것을 읽는다.
 *
 * 두 가지를 받는다.
 *   · 토큰 한 줄
 *   · `{"token": "...", "expires_at": 1700000000, "headers": {"X-Tenant": "..."}}`
 *
 * @returns {{ok: true, token: string, headers: object, 만료: number|null}
 *          |{ok: false, 왜: string, 보인것: string}}
 */
export function 읽기(글, { 수명 = 기본수명, 지금 = Date.now() } = {}) {
  const s = String(글 ?? '').trim();
  if (!s) return { ok: false, 왜: '아무것도 안 나왔습니다', 보인것: '' };

  const 첫줄 = s.split('\n')[0].trim().slice(0, 120);

  if (s.startsWith('{')) {
    let 것;
    try { 것 = JSON.parse(s); } catch (err) {
      return { ok: false, 왜: `JSON 처럼 시작하는데 못 읽었습니다 (${err.message})`, 보인것: 첫줄 };
    }
    const token = String(것?.token ?? 것?.access_token ?? '').trim();
    if (!token) return { ok: false, 왜: 'JSON 은 읽었는데 token 이 없습니다', 보인것: 첫줄 };
    if (!토큰글자.test(token)) return { ok: false, 왜: 'token 에 토큰이 아닌 글자가 들었습니다', 보인것: 첫줄 };
    /*
     * expires_at 은 **초**로 온다(유닉스 시각). 밀리초로 주는 곳도 있어서
     * 자릿수로 가른다 — 초로 읽어 버리면 1970년으로 계산돼 늘 만료로 보이고,
     * 그러면 한마디마다 로그인 명령을 부른다.
     */
    const 값 = Number(것?.expires_at ?? 것?.expiresAt);
    let 만료 = null;
    if (Number.isFinite(값) && 값 > 0) 만료 = 값 > 1e12 ? 값 : 값 * 1000;
    const headers = {};
    for (const [k, v] of Object.entries(것?.headers ?? {})) {
      // 머리말 이름에 못 쓰는 글자가 있으면 요청 자체가 안 만들어진다.
      if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(String(k))) continue;
      headers[String(k)] = String(v);
    }
    return { ok: true, token, headers, 만료: 만료 ?? 지금 + 수명 * 1000 };
  }

  if (!토큰글자.test(s)) {
    const 줄수 = s.split('\n').length;
    return {
      ok: false,
      왜: 줄수 > 1
        ? `${줄수}줄이 나왔습니다 — 토큰 한 줄만 나오게 해 주세요 (배너·안내문이 섞이면 게이트웨이가 거절합니다)`
        : '토큰으로 보이지 않는 글자가 섞여 있습니다',
      보인것: 첫줄,
    };
  }
  return { ok: true, token: s, headers: {}, 만료: 지금 + 수명 * 1000 };
}

/**
 * 명령을 띄우고 나온 것을 읽는다. 여기서는 캐시도 승인도 안 본다 — 그건 위층.
 *
 * @returns {Promise<{ok: boolean, token?, headers?, 만료?, 왜?, 보인것?, ms: number}>}
 */
export async function 한번받기(설정, { 기다림 = 기본기다림, signal = null, 알림 = null } = {}) {
  const t0 = Date.now();
  const { file, args } = 셸명령(설정.명령);
  마지막명령줄 = [file, ...args];

  알림?.({ type: '시작', 명령: 설정.명령 });

  const 결과 = await new Promise((done) => {
    let 나온것 = '';
    let 탈난것 = '';
    let 끝났나 = false;
    let kid;
    try {
      kid = spawn(file, args, {
        // stdin 은 안 연다. 여기서 사람에게 뭘 물어보는 명령이면 그건 설정이
        // 잘못된 것이고, 열어 두면 그 자리에서 영영 멈춘다.
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      return done({ ok: false, 왜: `명령을 못 띄웠습니다 (${err.message})`, 보인것: '' });
    }
    const 마치기 = (것) => { if (!끝났나) { 끝났나 = true; clearTimeout(시계); 끊기해제(); done(것); } };
    const 시계 = setTimeout(() => {
      try { kid.kill('SIGKILL'); } catch { /* 이미 죽었으면 그만 */ }
      마치기({ ok: false, 왜: `${Math.round(기다림 / 1000)}초를 기다렸는데 안 끝났습니다`, 보인것: '' });
    }, 기다림);
    const 끊기 = () => { try { kid.kill('SIGKILL'); } catch { /* 그만 */ } 마치기({ ok: false, 왜: '중단했습니다', 보인것: '' }); };
    const 끊기해제 = () => signal?.removeEventListener?.('abort', 끊기);
    if (signal?.aborted) return 끊기();
    signal?.addEventListener?.('abort', 끊기, { once: true });

    kid.stdout.on('data', (b) => { 나온것 += b; });
    kid.stderr.on('data', (b) => { 탈난것 += b; });
    kid.on('error', (err) => 마치기({ ok: false, 왜: `명령을 못 띄웠습니다 (${err.message})`, 보인것: '' }));
    kid.on('close', (code) => {
      if (code !== 0) {
        /*
         * 실패한 까닭은 stderr 에 있다. 그런데 사내 로그인 도구는 그 자리에
         * 토큰을 통째로 찍기도 한다. 그래서 보여 주되 **가려서** 보여 준다.
         */
        const 첫줄 = 가리기(탈난것.trim().split('\n')[0] ?? '', {}).글.slice(0, 200);
        return 마치기({ ok: false, 왜: `종료코드 ${code}`, 보인것: 첫줄 });
      }
      마치기({ ...읽기(나온것, { 수명: 설정.수명 }), 나온바이트: 나온것.length });
    });
  });

  const ms = Date.now() - t0;
  알림?.({ type: '끝', ok: !!결과.ok, ms });
  return { ...결과, ms };
}

/**
 * 쓸 열쇠를 내놓는다. 들고 있는 것이 아직 살아 있으면 그것, 아니면 받아 온다.
 *
 * @param {object} o
 * @param {object} o.설정        받기설정() 이 준 것
 * @param {boolean} [o.다시]     들고 있는 것을 버리고 새로 받는다 (401 을 맞았을 때)
 * @param {Function} [o.물어보기] async () => boolean. 정책이 준 명령이면 안 부른다.
 */
export async function 열쇠(설정, { 다시 = false, 물어보기 = null, signal = null, 알림 = null, 기다림 = 기본기다림 } = {}) {
  if (!설정) return { ok: false, 왜: '열쇠받기가 설정되어 있지 않습니다' };

  if (다시) 받은것 = null;
  if (받은것 && 받은것.만료 - 미리 > Date.now()) {
    return { ok: true, token: 받은것.token, headers: 받은것.headers, 만료: 받은것.만료, 그대로: true };
  }

  /*
   * 물어보기.
   *
   * 정책이 준 명령은 안 묻는다 — 회사가 정한 것을 개인이 승인하는 모양은
   * 뜻이 안 맞고, 어차피 아니라고 답할 수도 없다.
   *
   * 한 판에 한 번만 묻는다. 토큰이 한 시간짜리면 세 시간 일하는 동안 세 번
   * 받아 오는데, 세 번 다 물으면 사람은 그냥 손이 가는 대로 누른다.
   */
  if (설정.곳 !== '정책' && 물어보기) {
    if (물어본것 === false) return { ok: false, 왜: '이 판에서는 안 부르기로 했습니다' };
    if (물어본것 === null) {
      물어본것 = !!(await 물어보기(설정));
      if (!물어본것) return { ok: false, 왜: '이 판에서는 안 부르기로 했습니다' };
    }
  }

  const r = await 한번받기(설정, { signal, 알림, 기다림 });
  if (!r.ok) return r;
  받은것 = { token: r.token, headers: r.headers, 만료: r.만료, 언제: Date.now() };
  return { ok: true, token: r.token, headers: r.headers, 만료: r.만료, ms: r.ms, 그대로: false };
}

/**
 * 화면에 낼 글에서 받아 온 토큰을 지운다.
 *
 * 머리말 **값**도 같이 지운다. `X-Tenant: 12345` 는 토큰이 아니지만 사내
 * 식별자이고, 그걸 화면 사진이나 심사서에 그대로 남길 까닭이 없다.
 */
export function 가림(글) {
  const 것들 = [];
  if (받은것?.token) 것들.push(받은것.token);
  for (const v of Object.values(받은것?.headers ?? {})) if (v) 것들.push(String(v));
  return 가리기(String(글 ?? ''), { 열쇠들: 것들 }).글;
}

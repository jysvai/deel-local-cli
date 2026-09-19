// `deel config explain <칸>` — 이 값은 **어디서 왔나**.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────
//
// 설정을 읽는 자리가 넷이다 — 관리 정책 · 환경변수 · 프로젝트 설정 · 이 PC
// 설정. 겹치는 규칙은 문서에 적어 두었지만, 문서를 읽는 것과 **지금 이 자리에서
// 무엇이 이겼는지 아는 것**은 다른 일이다.
//
// 막히는 모양은 늘 같다. 파일에 분명히 적어 놨는데 안 먹는다. 그러면 사람은
// 그 파일을 고치고, 또 고치고, 결국 설정이라는 것을 안 믿게 된다. 실제로 값을
// 쥐고 있던 것은 환경변수 하나이거나, 프로젝트 설정을 안 믿는 폴더여서
// 읽지도 않은 것이다. 둘 다 **말해 주면 5초에 끝나는** 일이다.
//
// 그래서 층을 하나씩 열어서 「이 칸을 적어 둔 곳」 을 다 보여 주고, 어느 것이
// 이겼는지 표시한다. 값이 겹칠 때만 쓸모 있는 화면이 아니라, **아무 데도 안
// 적혀 있다**는 것을 보여 줄 때도 똑같이 쓸모 있다.
//
// ── 비밀은 안 보여 준다 ────────────────────────────────────────────────
//
// 열쇠 칸(apiKey)은 값을 안 적고 「적혀 있음」 만 적는다. 이 화면은 그대로
// 캡처되어 사내 메신저로 간다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homeDir, 집설정파일인가, 열쇠환경이름 } from './config.js';
import { 믿나, 프로젝트거르기, BOM떼기, 연결칸 } from './safety/trust.js';
import { 정책읽기, 정책자리 } from './safety/policy.js';
import { 받기설정 } from './safety/authcmd.js';

/*
 * 이 PC 프로필에 겹치는 저장소 프로필에서 연결 칸(baseUrl·kind·auth·제공자)을 걷는다.
 *
 * 이 칸들은 프로젝트거르기가 아니라 config.js 의 겹치기가 걷는다 — 이 PC 설정을 봐야
 * 「겹치나」 를 알 수 있어서다. 여기가 그걸 몰라서, 믿는 저장소가 이 PC 프로필과 같은
 * 이름으로 적은 baseUrl 이 「프로젝트 설정이 이긴다」 로 떴다. 실제로 붙는 주소는 이
 * PC 것이다. 사람은 제 열쇠가 저장소 주소로 가는 줄 알고 놀라거나, 반대로 거기
 * 적으면 먹는 줄 알고 계속 고친다.
 *
 * 맞추는 차례는 겹치기와 같다 — id 로, 없으면 name 으로. 저장소가 **새로 더한**
 * 프로필은 안 겹치므로 그대로 둔다(그쪽 주소는 정말로 저장소가 정한다).
 */
function 겹칠때걷기(방값, 집값) {
  const 집것 = Array.isArray(집값?.profiles) ? 집값.profiles : [];
  const id들 = new Set(집것.map((x) => x?.id).filter((v) => v != null));
  const 이름들 = new Set(집것.map((x) => x?.name).filter((v) => v != null));
  for (const p of Array.isArray(방값?.profiles) ? 방값.profiles : []) {
    if (!p || typeof p !== 'object') continue;
    const 겹침 = (p.id != null && id들.has(p.id)) || (p.name != null && 이름들.has(p.name));
    if (!겹침) continue;
    for (const 칸 of 연결칸) delete p[칸];
  }
  return 방값;
}

/** 값을 안 보여 줄 칸. 이름만 봐도 알 수 있는 것만 넣는다. */
const 가릴칸 = new Set(['apiKey', 'key', 'passphrase', '암호']);

/**
 * 이 칸을 정할 수 있는 환경변수.
 *
 * 손으로 적는다. 자동으로 긁으면 「무엇이 이 칸을 이길 수 있나」 가 코드를
 * 읽어야만 아는 것이 되는데, 그건 이 명령이 없애려는 바로 그 상태다.
 */
const 환경변수 = {
  // 차례는 **이기는 차례**다 (config.js 의 resolveKey). 아래에서 첫 번째로 켜진 것을
  // 「이 값」 으로 적으므로, 여기가 어긋나면 화면이 안 이기는 쪽을 가리킨다.
  apiKey: ['DEEL_KEY_<프로필ID>', 'DEEL_API_KEY'],
  shell: ['DEEL_SHELL'],
  offline: [],
  proxy: ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY'],
  lang: ['DEEL_LANG'],
};

/*
 * 비밀 칸의 값은 **읽는 자리에서** 바꿔치기한다.
 *
 * 그리는 자리에서만 가리면 `--json` 이 날것을 그대로 낸다. 그 출력은
 * 파이프를 타고 로그로, 사내 티켓으로 간다 — 화면만 가려 놓고 안전하다고
 * 하는 것이 이런 자리에서 제일 흔한 사고다.
 */
export const 비밀표시 = '(적혀 있음 — 값은 안 보여 줍니다)';
const 지운값 = (칸, v) => (v !== undefined && 가릴칸.has(칸) ? 비밀표시 : v);

const 값보이기 = (칸, v) => {
  if (v === undefined) return null;
  if (v === null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/**
 * 한 칸이 어느 층에 적혀 있나.
 *
 * @param {string} 칸  `offline` 처럼 맨 위 칸, 또는 `profiles.사내.model` 처럼
 *                     프로필 안의 칸
 * @returns {{칸:string, 층들:Array, 이긴층:object|null, 환경변수:string[]}}
 */
export function 설명(칸, { root = process.cwd(), env = process.env } = {}) {
  const 조각 = String(칸 ?? '').split('.').filter(Boolean);
  const 층들 = [];

  const 파일읽기 = (자리) => {
    if (!existsSync(자리)) return { 있나: false };
    // BOM 은 설정을 읽는 자(config.js)와 똑같이 뗀다. 안 떼면 이 화면만 「못 읽었습니다」 다.
    try { return { 있나: true, 값: JSON.parse(BOM떼기(readFileSync(자리, 'utf8'))) }; }
    catch (err) { return { 있나: true, 탈: err?.message ?? String(err) }; }
  };

  const 파고들기 = (덩이) => {
    let 여기 = 덩이;
    for (let i = 0; i < 조각.length; i++) {
      if (여기 == null || typeof 여기 !== 'object') return undefined;
      const 이름 = 조각[i];
      /*
       * `profiles.<이름>.<칸>` 은 배열을 이름으로 뒤진다.
       *
       * 사람이 설정에서 프로필을 부르는 이름은 배열 번호가 아니라 name 이다.
       * 번호로 적게 하면 프로필 하나를 지웠을 때 이 명령이 조용히 딴 것을
       * 가리킨다.
       */
      if (Array.isArray(여기)) {
        여기 = 여기.find((x) => x?.name === 이름 || x?.id === 이름);
        continue;
      }
      // 물려받은 이름(`constructor` · `toString`)으로 파고들면 **없는 칸이
      // 있는 것이 된다.** 여기서 막아야 아래 세 층이 다 안전하다.
      // 위 루프 머리에서 여기가 object 임을 이미 봤다 — 또 보지 않는다.
      여기 = Object.hasOwn(여기, 이름) ? 여기[이름] : undefined;
    }
    return 여기;
  };

  const 끝칸이름지금 = 조각[조각.length - 1] ?? '';

  // ── 1. 이 PC 설정 (제일 아래) ───────────────────────────────────────
  const 집자리 = join(homeDir(), 'config.json');
  const 집 = 파일읽기(집자리);
  if (집.있나) {
    층들.push({
      층: '이 PC 설정', 자리: 집자리, 읽나: !집.탈,
      값: 집.탈 ? undefined : 지운값(끝칸이름지금, 파고들기(집.값)), 탈: 집.탈 ?? null,
    });
  }

  // ── 2. 프로젝트 설정 (믿는 폴더에서만) ──────────────────────────────
  const 방자리 = join(root, '.deel', 'config.json');
  // 집 폴더에서 켜면 이 파일이 곧 위의 「이 PC 설정」 이다. 한 파일을 두 층으로 그리지 않는다.
  if (existsSync(방자리) && !집설정파일인가(방자리)) {
    const 믿나결과 = 믿나(root);
    const 방 = 파일읽기(방자리);
    /*
     * 저장소가 못 정하는 칸은 **걷은 뒤** 값으로 그린다 (safety/trust.js 의 프로젝트거르기).
     *
     * 날값을 그렸더니, 믿는 저장소의 `profiles[].offline:false` 가 「프로젝트 설정 =
     * false 가 이긴다」 로 떴다. 실제로는 걷혀서 이 PC 의 봉인이 걸려 있다. 이 화면이
     * 사람을 속이면, 봉인이 풀린 줄 알고 바깥 주소를 적거나 관리자에게 엉뚱한 것을 묻는다.
     */
    const 걸러진 = 방.탈 ? undefined : 겹칠때걷기(프로젝트거르기(방.값).값, 집.탈 ? null : 집.값);
    /*
     * 걷힌 칸은 「이 칸은 없음」 이 아니라 **걷힌다**고 적는다. 파일에는 분명히 적혀
     * 있으므로 「없음」 이라고 하면 사람은 이 화면을 못 믿는다. 적힌 값도 같이 보여 준다.
     */
    const 날값 = 방.탈 ? undefined : 파고들기(방.값);
    const 남은값 = 방.탈 ? undefined : 파고들기(걸러진);
    const 걷힘 = 날값 !== undefined && 남은값 === undefined;
    층들.push({
      층: '프로젝트 설정', 자리: 방자리, 읽나: 믿나결과 && !방.탈,
      값: 방.탈 ? undefined : 지운값(끝칸이름지금, 남은값), 탈: 방.탈 ?? null,
      걷힘, 걷힌값: 걷힘 ? 지운값(끝칸이름지금, 날값) : undefined,
      // 읽지도 않는 파일에 적어 둔 것이 이 화면에서 제일 자주 나오는 답이다.
      왜못읽나: 믿나결과 ? null : '믿는 폴더가 아닙니다 (deel trust)',
    });
  }

  // ── 3. 환경변수 ─────────────────────────────────────────────────────
  const 끝칸 = 조각[조각.length - 1] ?? '';
  /*
   * `환경변수[끝칸] ?? []` 였다.
   *
   * `deel config explain constructor` 는 배열이 아니라 **함수**를 받아
   * 바로 다음 줄에서 터졌다 — 화면에 뜬 말은 「오류 볼환경.filter is not a
   * function」 이다. 없는 칸을 물었으면 없다고 해야 한다.
   */
  /*
   * `DEEL_KEY_<프로필ID>` 는 이름이 아니라 **틀**이다.
   *
   * 틀인 채로 두면 바로 아래 `<` 거르는 줄에서 통째로 빠진다. 그래서 그 환경변수가
   * **지금 열쇠를 쥐고 있는** 판에서도 이 화면은 파일을 가리키거나 「아무 데도 안
   * 적혀 있습니다」 라고 했다 — 이 명령이 없애려던 바로 그 상태를, 열쇠 칸에서만
   * 제 손으로 만들고 있었다.
   *
   * 물어본 프로필의 진짜 id 로 펼친다. 이름을 짓는 자는 config.js 의 열쇠환경이름
   * 하나다 — 집는 쪽과 그리는 쪽이 다른 이름을 쓰면 사람은 없는 자리를 고친다.
   * (저장소가 더한 프로필은 그 환경변수를 안 집으므로 이 PC 설정에서만 찾는다.)
   */
  const 이프로필환경 = (() => {
    if (조각[0] !== 'profiles' || 조각.length < 2) return null;
    const 집프로필 = Array.isArray(집.값?.profiles) ? 집.값.profiles : [];
    return 열쇠환경이름(집프로필.find((x) => x?.name === 조각[1] || x?.id === 조각[1]) ?? null);
  })();
  const 볼환경 = (Object.hasOwn(환경변수, 끝칸) ? 환경변수[끝칸] : [])
    .map((이름) => (이프로필환경 && 이름 === 'DEEL_KEY_<프로필ID>' ? 이프로필환경 : 이름));
  const 켜진환경 = 볼환경.filter((이름) => !이름.includes('<') && env[이름]);
  if (켜진환경.length) {
    층들.push({
      층: '환경변수', 자리: 켜진환경.join(' · '), 읽나: true,
      값: 지운값(끝칸, env[켜진환경[0]]),
    });
  }

  // ── 4. 관리 정책 (제일 위) ──────────────────────────────────────────
  /*
   * 정책이 이 칸에 **실제로 얹는** 값만 그린다. 안 얹으면 undefined.
   *
   * 정책 파일에 적혀 있다고 다 걸리는 것이 아니다. 정책값을 읽는 자리는 셋뿐이다 —
   * config.js 정책덮기(baseUrl·offline·permissions.deny) · policy.js 규칙모으기(permissions) ·
   * authcmd.js 받기설정(열쇠받기). 날값을 그렸더니 정책 `offline:false`(끄지는 못한다) ·
   * 빈 baseUrl · 빈 명령의 열쇠받기 · 아무도 안 읽는 `shell` 이 「관리 정책이 이긴다」 로
   * 떴다 (2.0.0 6회차 CX5). 관리자에게 따지러 갈 근거가 통째로 거짓이 되는 자리다.
   *
   * 정책 파일은 JSON 이라 프로토타입을 그대로 물려받는다. 그래서 칸은 hasOwn 으로만 본다.
   */
  const 정책이얹는값 = (정책값) => {
    const 제칸 = (덩이, 이름) => (덩이 && typeof 덩이 === 'object' && Object.hasOwn(덩이, 이름) ? 덩이[이름] : undefined);
    if (조각[0] === 'permissions') {
      const 권한 = 제칸(정책값, 'permissions');
      const 목록만 = {};
      for (const k of ['allow', 'deny']) if (Array.isArray(제칸(권한, k))) 목록만[k] = 권한[k];
      if (조각.length === 1) return Object.keys(목록만).length ? 목록만 : undefined;
      return 조각.length === 2 ? 제칸(목록만, 조각[1]) : undefined;
    }
    if (끝칸 === 'baseUrl') {
      const 주소 = 제칸(정책값, 'baseUrl');
      return typeof 주소 === 'string' && 주소.trim() ? 주소.trim() : undefined;
    }
    if (끝칸 === 'offline') {
      const 봉 = 제칸(정책값, 'offline');
      return 봉 === true || 봉 === 'true' ? true : undefined;
    }
    if (끝칸 === '열쇠받기' || 끝칸 === 'authCommand') {
      if (받기설정(null, { 정책값 })?.곳 !== '정책') return undefined;
      return 제칸(정책값, '열쇠받기') ?? 제칸(정책값, 'authCommand');
    }
    return undefined;
  };

  const 정책 = 정책읽기({ env, 다시: true });
  if (정책.값 && typeof 정책.값 === 'object') {
    const 그값 = 정책이얹는값(정책.값);
    if (그값 !== undefined) {
      층들.push({ 층: '관리 정책', 자리: 정책.곳 ?? 정책자리(env)[0], 읽나: true, 값: 지운값(끝칸, 그값) });
    }
  }

  // 이긴 층 — 뒤에 온 것이 이긴다. 다만 **읽는 층** 중에서만 고른다.
  const 쓸수있는것 = 층들.filter((x) => x.읽나 && x.값 !== undefined);
  /*
   * 금지·허락은 이기고 지는 칸이 아니라 **더해지는** 칸이다 — 이 PC·저장소 금지는 겹치기가
   * 합치고(config.js), 정책 금지·허락은 정책덮기·규칙모으기가 더한다(policy.js). 「한 곳이
   * 이긴다」 로 그리면 사람은 제 금지가 풀린 줄 안다 (2.0.0 6회차 CX5).
   */
  const 합치는칸 = 조각[0] === 'permissions'
    && (조각.length === 1 || (조각.length === 2 && (조각[1] === 'deny' || 조각[1] === 'allow')));
  if (합치는칸) return { 칸, 층들, 이긴층: null, 합침: 쓸수있는것, 환경변수: 볼환경 };

  const 이긴층 = 쓸수있는것.length ? 쓸수있는것[쓸수있는것.length - 1] : null;

  return { 칸, 층들, 이긴층, 환경변수: 볼환경 };
}

/** 화면에 그릴 줄들. 색은 부르는 쪽이 입힌다. */
export function 설명줄들(r) {
  const 줄 = [];
  // 더해지는 칸(금지·허락)은 이긴 한 곳이 아니라 걸리는 곳 전부를 적는다 (설명 의 합치는칸).
  if (r.합침?.length) {
    줄.push({ 갈래: '값', 글: `${r.합침.length}곳에 적힌 규칙이 합쳐져 다 걸립니다`, 곁: r.합침.map((x) => x.층).join(' + ') });
  } else if (r.이긴층) 줄.push({ 갈래: '값', 글: `${값보이기(끝칸이름(r.칸), r.이긴층.값)}`, 곁: `${r.이긴층.층}` });
  else 줄.push({ 갈래: '없음', 글: '아무 데도 안 적혀 있습니다 (기본값으로 돕니다)', 곁: null });

  for (const 층 of r.층들) {
    const 값 = 값보이기(끝칸이름(r.칸), 층.값);
    줄.push({
      갈래: 층 === r.이긴층 || r.합침?.includes(층) ? '이김' : (층.읽나 ? '아래' : '안읽음'),
      글: `${층.층}`,
      곁: [
        층.자리,
        값 !== null ? `= ${값}`
          : (층.걷힘
            ? `= ${값보이기(끝칸이름(r.칸), 층.걷힌값)} — 걷힙니다: 저장소가 못 정하는 칸이라 이 값은 안 씁니다`
            : '(이 칸은 없음)'),
        층.왜못읽나 ? `— ${층.왜못읽나}` : null,
        층.탈 ? `— 못 읽었습니다: ${층.탈}` : null,
      ].filter(Boolean).join('  '),
    });
  }
  if (r.환경변수.length) {
    줄.push({ 갈래: '참고', 글: '이 칸을 이길 수 있는 환경변수', 곁: r.환경변수.join(' · ') });
  }
  return 줄;
}

const 끝칸이름 = (칸) => String(칸 ?? '').split('.').filter(Boolean).pop() ?? '';

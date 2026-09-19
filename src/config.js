// 연결 프로필 저장/읽기.  ~/.deel/config.json 위에 프로젝트의 .deel/config.json 을 겹친다
// (믿는 폴더일 때만 — safety/trust.js).
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, renameSync, rmSync } from 'node:fs';
import { 프록시정하기 } from './backend/proxy.js';
import { 셸정하기 } from './tools/shell.js';
import { 애저정하기 } from './backend/azure.js';
import { 정책읽기 } from './safety/policy.js';
import { 잠그기, 풀기, 잠긴것인가, 쓸수있나, 보관방식, 잠그다실패한까닭 } from './safety/keystore.js';
import { 믿나, 프로젝트거르기, 프로젝트설정줄들, 프로젝트금지칸, 연결칸, BOM떼기 } from './safety/trust.js';
import { 규칙모으기 } from './safety/policy.js';
import { mark } from './ui/ansi.js';

// 설정이 놓이는 자리.
//
// DEEL_HOME 을 주면 그 폴더를 쓴다. 두 군데서 필요했다 —
//   1) 사내에서 USB·공유폴더에 통째로 넣어 쓰는 휴대용 설치.
//      집 폴더가 로밍 프로필이면 설정이 엉뚱한 데로 따라다닌다.
//   2) 검사. 예전에는 검사가 진짜 설정 파일에 값을 써 버렸다.
//      실제로 /level 검사가 사용자 설정을 바꾼 것을 보고 이걸 넣었다.
//
// 모듈을 읽을 때가 아니라 쓸 때마다 본다. 그래야 부르는 쪽에서 언제 정하든 먹는다.
function userDir() {
  return process.env.DEEL_HOME ? resolve(process.env.DEEL_HOME) : join(homedir(), '.deel');
}
/*
 * ── 「이 폴더」 가 언제나 process.cwd() 였다 ───────────────────────────
 *
 * 여기·configPath()·읽기() 셋이 다 `process.cwd()` 를 박아 놓고 있었다.
 * 터미널에서는 그게 맞다 — 켠 자리가 곧 일하는 자리다. 그런데 문이 하나
 * 더 있다. 에디터(ACP)는 **제가 연 프로젝트 폴더를 요청에 담아 준다**
 * (`session/new` 의 `cwd`). 그 값은 에디터를 띄운 자리와 다를 수 있고,
 * 창 하나에 폴더가 여럿인 구성에서는 세션마다도 다르다.
 *
 * 그래서 한 세션 안에서 **두 폴더가 섞였다** — 도구는 에디터가 준 폴더에서
 * 파일을 고치는데, 설정과 신뢰와 승인 규칙은 에디터를 띄운 폴더 것을 봤다.
 * 열어 둔 프로젝트의 `.deel/config.json` 은 아예 안 읽히고, 남의 폴더
 * `permissions.deny` 가 이 프로젝트에 걸렸다. 아무 말도 안 난다 —
 * 「안 읽었다」 를 알리는 프로젝트설정소식() 조차 다른 폴더를 기준으로 났다.
 *
 * acp/serve.js 머리말이 바로 이 실수를 「제일 무서운 종류」 라고 적어 뒀다.
 * 도구 쪽은 그 말대로 고쳐져 있었고, 설정 쪽만 남아 있었다.
 *
 * 뿌리를 받는다. 안 주면 예전처럼 켠 자리다.
 */
function projectDir(root = process.cwd()) {
  return join(root, '.deel');
}

/**
 * 이 PC 의 설정 폴더 (`~/.deel` 또는 DEEL_HOME).
 *
 * configPath() 와 다르다 — 저쪽은 프로젝트에 설정이 있으면 그쪽을 준다.
 * 여기는 언제나 **이 PC 것**이다. 모델에 대해 알아낸 것처럼 폴더를 옮겨도
 * 따라와야 하는 것을 여기 둔다 (agent/evolve.js).
 */
export function homeDir() { return userDir(); }

/**
 * 지금 실제로 쓰는 설정 파일.
 *
 * 프로젝트 설정이 있어도 **믿는 폴더일 때만** 그쪽을 준다 (safety/trust.js).
 * 안 읽는 파일에 쓰지도 않아야 한다 — 안 믿어서 무시한 파일에 `deel setup`
 * 이 값을 적으면, 다음에 켤 때 그 값이 또 무시된다. 사람은 두 번 적고 두 번
 * 다 안 먹는 것을 보는데, 그때 무엇 때문인지 알 길이 없다.
 */
export function configPath(root = process.cwd()) {
  const local = join(projectDir(root), 'config.json');
  if (existsSync(local) && 믿나(root)) return local;
  return join(userDir(), 'config.json');
}

/**
 * 이 파일이 **이 PC 설정 파일 그 자체인가.**
 *
 * ── 집 폴더에서 켜면 두 자리가 한 파일이다 ──────────────────────────────
 *
 * DEEL_HOME 을 안 주면 이 PC 설정은 `~/.deel/config.json` 이다. 그런데 집
 * 폴더(`~`)에서 켜면 「이 폴더의 프로젝트 설정」 `<폴더>/.deel/config.json` 도 바로
 * 그 파일이다. 그걸 따로 봤더니 세 가지가 어긋났다:
 *
 *   · 켤 때마다 「이 폴더 프로젝트 설정을 안 읽었습니다 — deel trust」 가 떴다.
 *     제 설정인데. doctor 는 같은 파일을 ✓설정 과 ⚠프로젝트 설정 으로 두 번 적었다.
 *   · 그 말대로 `deel trust` 를 치면 **집 폴더 전체**가 믿는 폴더가 된다 — 그 아래
 *     받아 둔 남의 저장소가 전부 믿긴다.
 *   · 믿고 나면 제 설정의 permissions.allow 를 「저장소가 적은 것이라 걷어냈다」 고
 *     거짓말했다. 실제로는 이 PC 파일로 읽혀 그대로 걸려 있었다.
 *
 * reset.js 의 같은자리와 같은 기준이다 — 윈도우는 대소문자를 안 가린다.
 */
export function 집설정파일인가(파일) {
  const [x, y] = [resolve(String(파일 ?? '')), resolve(join(userDir(), 'config.json'))];
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * 이 PC 설정 파일에 **직접 적힌** 칸 하나. 없거나 못 읽으면 undefined.
 *
 * load() 가 주는 것은 저장소 설정까지 겹친 것이라, 「사람이 이 PC 에 적어 둔 값」 이
 * 필요한 자리에는 못 쓴다. 승인 모드(mode)가 그렇다 — 저장소가 `"mode": "auto"` 를
 * 적어 이 PC 의 strict 를 헐겁게 만드는 길을 열면 안 된다.
 *
 * 못 읽는 파일은 여기서 말하지 않는다. 곧이어 load() 가 어느 파일 몇째 줄인지까지
 * 적어 멈춘다 — 두 자리에서 따로 말하면 같은 탈이 두 번 뜬다.
 */
export function 이PC설정값(칸) {
  const p = join(userDir(), 'config.json');
  if (!existsSync(p)) return undefined;
  try {
    const j = JSON.parse(BOM떼기(readFileSync(p, 'utf8')));
    return j && typeof j === 'object' && Object.hasOwn(j, 칸) ? j[칸] : undefined;
  } catch { return undefined; }
}

const EMPTY = { version: 1, active: null, profiles: [] };

/*
 * 열쇠를 이 PC 의 잠금장치에 옮긴다 (safety/keystore.js).
 *
 * 예전 판이 평문으로 적어 둔 설정이 그대로 남아 있다. 사람더러 다시 넣으라고
 * 하면 대부분 안 한다 — 지금 잘 되고 있으니까. 그래서 **처음 읽을 때 한 번**
 * 조용히 옮기고, 옮겼다는 것만 한 줄로 알린다.
 *
 * 못 잠그면 파일을 아예 안 건드린다. 반쯤 잠근 파일을 남기면 그 뒤로는
 * 무엇이 잠긴 것이고 무엇이 평문인지 아무도 모른다.
 *
 * DEEL_KEYSTORE=off 면 안 한다 — 잠금장치가 정책으로 막힌 곳에서 매번
 * 파워셸을 두드리며 느려지는 것을 사람이 끌 수 있어야 한다.
 */
let 옮겨봤나 = false;
let 소식 = null;

/** 열쇠를 옮겼으면 그 한 줄을 준다. 한 번 읽으면 지워진다 (두 번 안 알린다). */
export function 잠금소식() { const s = 소식; 소식 = null; return s; }

/** 화면·심사서에 그대로 쓰는 '열쇠를 어디에 두나' 한 줄. */
export function 열쇠보관(cfg = null) {
  const p = cfg ? activeProfile(cfg) : null;
  return 보관방식(p?.apiKey ?? null);
}

function 잠금옮기기(cfg, root = process.cwd()) {
  if (옮겨봤나 || process.env.DEEL_KEYSTORE === 'off') return;
  옮겨봤나 = true;
  const 평문 = (cfg.profiles ?? []).filter((p) => p?.apiKey && !잠긴것인가(p.apiKey));
  if (!평문.length) return;
  if (!쓸수있나().되나) return;

  let 옮김 = 0;
  for (const p of 평문) {
    const 잠근것 = 잠그기(p.apiKey, { 프로필id: p.id });
    if (잠근것) { p.apiKey = 잠근것; 옮김 += 1; }
  }
  if (!옮김) return;
  /*
   * 하나라도 못 잠갔으면 **파일은 그대로 둔다** (머리말).
   *
   * 여기가 `옮김` 이 0 만 아니면 적었다. 그러면 못 잠근 열쇠는 평문 그대로 그 파일에
   * 실려 나가는데 화면에는 「잠갔습니다」 한 줄만 떴다. 그 파일이 무엇인지 — 잠긴
   * 파일인지 평문이 섞인 파일인지 — 아무도 모르는 상태로 백업 폴더와 다른 PC 로 간다.
   * 반쯤 잠근 파일을 안 남기는 쪽이, 이번 판에 안 잠기는 것보다 낫다.
   */
  if (옮김 < 평문.length) {
    const 못한것 = 평문.length - 옮김;
    소식 = `게이트웨이 열쇠 ${평문.length}개 가운데 ${못한것}개를 못 잠갔습니다`
      + `${잠그다실패한까닭() ? ` (${잠그다실패한까닭()})` : ''}`
      + ' — 반쯤 잠근 파일을 안 남기려고 설정 파일은 그대로 두었습니다 (파일에는 평문 그대로입니다)';
    return;
  }
  try {
    /*
     * 언제나 **이 PC 파일에** 적는다. 평문 열쇠는 이 PC 설정에서만 온다 —
     * 저장소 설정의 apiKey 는 읽을 때 걷힌다(safety/trust.js).
     *
     * 여기는 「읽은 자리에 되쓴다」 며 믿는 폴더면 저장소의 `.deel/config.json`
     * 에 적었다. 그런데 넘기는 cfg 는 **합친 것**이라, 이 PC 프로필 전부가 잠긴
     * 열쇠까지 저장소 안 파일로 복사됐다. 그 파일은 대개 git 이 따라간다.
     * 저장소가 얹은 것은 save() 가 벗긴다(방벗기기).
     */
    const 적은곳 = save(cfg);
    const 방식 = 쓸수있나().방식 === 'keychain' ? '키체인' : 'DPAPI';
    // 어느 파일에 적었는지를 말한다. 「잠갔습니다」 한 줄로는 어디가 바뀌었는지 모른다.
    소식 = (옮김 === 1
      ? `게이트웨이 열쇠를 이 PC 계정에서만 풀리게 잠갔습니다 (${방식})`
      : `게이트웨이 열쇠 ${옮김}개를 이 PC 계정에서만 풀리게 잠갔습니다 (${방식})`)
      + ` — ${적은곳}`;
  } catch (err) {
    // 못 썼으면 못 썼다고 한다. 메모리에만 잠긴 채로 이번 판은 돌지만,
    // 파일은 평문 그대로다 — 그 말을 안 하면 잠긴 줄 알고 파일을 옮긴다.
    소식 = `열쇠를 잠갔지만 설정 파일에 못 적었습니다 (${err?.message ?? err}) — 파일에는 평문 그대로입니다`;
  }
}

export function load({ root = process.cwd() } = {}) {
  const cfg = 읽기(root);
  잠금옮기기(cfg, root);
  // 프록시는 설정을 읽는 자리에서 정한다. run · acp · setup · diagnose 어느 문으로
  // 들어와도 한 번은 여기를 지나므로, 여기가 빠뜨리지 않는 유일한 자리다.
  프록시정하기({ config: cfg });
  // 명령을 돌릴 셸도 같은 까닭으로 여기서 정한다 (tools/shell.js).
  셸정하기({ config: cfg });
  // Azure 판 번호(api-version)도 같은 자리에서 정한다 (backend/azure.js).
  애저정하기({ config: cfg });
  // 관리 정책이 걸려 있으면 여기서 덮어쓴다 (safety/policy.js).
  정책덮기(cfg);
  return cfg;
}

/*
 * 관리 정책이 정한 것을 설정 위에 덮는다.
 *
 * 정책은 설정을 **이긴다.** 설정 파일은 쓰는 사람 것이라 지우고 고칠 수 있고,
 * 그래서 "이번 배포 동안은 이 게이트웨이만" 같은 것을 적어 둘 자리가 아니다.
 *
 * 그렇다고 정책이 **풀어 주지는 못한다.** offline 을 켤 수는 있어도 끌 수는
 * 없고, 금지를 더할 수는 있어도 사용자가 적어 둔 금지를 지우지는 못한다.
 * 정책 파일 한 줄로 안전장치가 헐거워지는 길을 안 낸다.
 */
/*
 * 정책이 덮기 **전**의 값. 저장할 때 되돌려 놓으려고 들고 있는다.
 *
 * Symbol 로 단 까닭: JSON.stringify 가 Symbol 칸을 안 적는다. 보통 칸으로
 * 두면 이 흔적 자체가 설정 파일에 적혀 나간다.
 */
const 정책흔적 = Symbol('정책이덮은것');

function 정책덮기(cfg) {
  const 정책 = 정책읽기().값;
  if (!정책 || typeof 정책 !== 'object') return cfg;

  const 덮기전 = { 주소: new Map(), offline: cfg.offline, deny: cfg.permissions?.deny };

  if (typeof 정책.baseUrl === 'string' && 정책.baseUrl.trim()) {
    for (const 프로필 of cfg.profiles ?? []) {
      덮기전.주소.set(프로필, 프로필.baseUrl);
      프로필.baseUrl = 정책.baseUrl.trim();
    }
    cfg.정책주소 = 정책.baseUrl.trim();
  }
  // 끄지는 못한다 — 켜기만. 글자 'true' 도 켠 것이다 (safety/runmode.js 의 봉인됐나).
  if (정책.offline === true || 정책.offline === 'true') cfg.offline = true;
  if (Array.isArray(정책.permissions?.deny)) {
    cfg.permissions = cfg.permissions ?? {};
    const 있던것 = Array.isArray(cfg.permissions.deny) ? cfg.permissions.deny : [];
    cfg.permissions.deny = [...new Set([...있던것, ...정책.permissions.deny])];
  }
  cfg[정책흔적] = 덮기전;
  return cfg;
}

/*
 * 저장하기 전에 **정책이 얹은 것을 도로 벗긴다.**
 *
 * 정책은 덮는 것이지 사람 설정을 고쳐 쓰는 것이 아니다. 그런데 load() 가
 * 얹은 값을 그대로 저장하는 자리가 넷이었다(setup · /model · scan · 설정남기기).
 * 그러면 사람이 적어 둔 주소는 사라지고 정책 주소가 제 파일에 박힌다.
 * 관리자가 나중에 정책을 걷어도 그 값은 남고, 그때 `deel config explain` 은
 * 「이 PC 설정 = …」 이라며 **사람 본인을 범인으로 가리킨다.**
 */
function 정책벗기기(cfg) {
  const 덮기전 = cfg?.[정책흔적];
  if (!덮기전) return cfg;
  const 사본 = { ...cfg };
  delete 사본.정책주소;
  사본.profiles = (cfg.profiles ?? []).map((p) => {
    if (!덮기전.주소.has(p)) return p;
    const q = { ...p };
    const 원래 = 덮기전.주소.get(p);
    if (원래 === undefined) delete q.baseUrl; else q.baseUrl = 원래;
    return q;
  });
  if (덮기전.offline === undefined) delete 사본.offline; else 사본.offline = 덮기전.offline;
  if (cfg.permissions) {
    사본.permissions = { ...cfg.permissions };
    if (덮기전.deny === undefined) delete 사본.permissions.deny;
    else 사본.permissions.deny = 덮기전.deny;
    if (!Object.keys(사본.permissions).length) delete 사본.permissions;
  }
  return 사본;
}

/*
 * 한 장을 읽는다. 못 읽으면 **어느 파일이 왜** 인지를 달아서 던진다.
 *
 * BOM 을 먼저 뗀다(safety/trust.js 의 BOM떼기). 윈도우 파워셸 5.1 의
 * `Set-Content -Encoding UTF8` 로 깐 설정은 앞에 U+FEFF 가 붙어 있고, 그 한 글자
 * 때문에 `deel` 의 모든 명령이 「설정 파일을 읽지 못했습니다」 로 종료코드 1 이었다.
 *
 * 던지는 오류에 자리·까닭을 따로 싣는 것은 doctor 때문이다. 거기는 이 오류를
 * `catch {}` 로 삼키고 「✓ 설정 파일」 을 찍었다 — 화면에서 까닭이 사라졌다.
 */
function 한장읽기(p) {
  try { return JSON.parse(BOM떼기(readFileSync(p, 'utf8'))); }
  catch (err) {
    const e = new Error(`설정 파일을 읽지 못했습니다: ${p}\n  ${err.message}`);
    e.설정자리 = p;
    e.까닭 = String(err?.message ?? err);
    throw e;
  }
}

/*
 * ── 두 장을 겹친다 ─────────────────────────────────────────────────────
 *
 * 예전에는 프로젝트 설정이 있으면 이 PC 설정을 **통째로 안 읽었다.** 그래서
 * 저장소에 `.deel/config.json` 한 줄만 들어 있어도 그 폴더에서는 프로필이
 * 하나도 없는 것이 됐다 — 「이 저장소는 code 모드로 연다」 를 적으려던 사람이
 * 제 게이트웨이를 통째로 잃는다. 그러면 사람은 프로젝트 설정을 안 쓴다.
 *
 * 이제 겹친다. 규칙은 하나다 — **좁히는 쪽만 이긴다.** 금지(deny)는 두 장을
 * 합치고, 허락(allow)은 애초에 프로젝트에서 안 읽는다(safety/trust.js).
 */
/*
 * ── 「좁히는 쪽만 이긴다」 가 칸 단위 덮기에서 깨졌다 ─────────────────
 *
 * 최상위 칸은 `{ ...집, ...방 }` 한 줄로 저장소가 다 이겼고, 프로필은 칸 단위로
 * 덮였다. 그래서 믿는 폴더의 저장소가 이 PC 프로필의 `baseUrl` 한 칸만 적으면
 * 이 PC 열쇠가 그 주소로 붙었고, `offline:false` 로 봉인을 풀고, `active` 로
 * 제가 더한 프로필에 연결을 돌렸다. 화면에는 한 줄도 안 나왔다.
 *
 * 값 하나로 가를 수 있는 칸은 safety/trust.js 의 프로젝트거르기가 걷는다.
 * 이 PC 설정을 봐야 가를 수 있는 칸(연결 칸·active)은 여기서 걷고, 걷은 것을
 * 돌려줘서 화면이 말하게 한다.
 */
const 방흔적 = Symbol('저장소가얹은것');

function 겹치기(집, 방) {
  const cfg = { ...집, ...방 };
  const 걸러낸것 = [];
  const 적기 = (칸) => {
    const 것 = 프로젝트금지칸.find((x) => x.칸 === 칸);
    if (것 && !걸러낸것.some((x) => x.칸 === 칸)) 걸러낸것.push(것);
  };

  /*
   * 프로필은 **id 로** 맞춘다. 통째로 갈아치우면 이 PC 프로필이 사라진다.
   *
   * 여기만 `name` 으로 맞췄다. 나머지는 전부 id 로 돈다 — activeProfile 도,
   * upsert 도, 열쇠 푸는 자리도. 그래서 세 가지가 조용히 어긋났다:
   *
   *   · id 만 적은 저장소 프로필은 `continue` 로 **통째로 버려졌다.**
   *   · 이름을 새로 붙이면 id 가 같은 프로필이 **두 개**가 되고 집 것이 이겼다.
   *   · id 없이 이름만 적으면(문서의 예시 모양이 그렇다) 그 프로필은
   *     영영 active 가 못 된다.
   *
   * 셋 다 화면에 한마디도 안 나왔다. 그리고 `deel config explain` 은 저장소
   * 값이 이겼다고 그려 줬다 — 실제로 모델에 붙는 값은 집 것인데.
   *
   * 옛 저장소 설정이 이름으로만 적어 둔 경우가 있어 이름도 받아 준다.
   */
  const 집것 = 집.profiles ?? [];
  const 자리표 = new Map(집것.map((x, i) => [x?.id ?? `#${i}`, i]));
  const 이름자리 = new Map(집것.map((x, i) => [x?.name, i]).filter(([k]) => k));
  const 모음 = [...집것];
  const 이름없는것 = [];
  for (const p of 방.profiles ?? []) {
    const 자리 = p?.id != null && 자리표.has(p.id) ? 자리표.get(p.id)
      : (p?.name != null && 이름자리.has(p.name) ? 이름자리.get(p.name) : null);
    if (자리 != null) {
      /*
       * 연결 칸은 이 PC 값이 남는다. 칸 단위로 덮으면 이 PC 열쇠(apiKey·열쇠받기)는
       * 그대로인 채 주소만 저장소 것이 된다. 같은 값을 적은 것은 걷어도 달라질
       * 것이 없으니 말하지 않는다 — 거짓 경고는 진짜 경고를 죽인다.
       */
      const 덮을것 = { ...p };
      /*
       * 겹치는 프로필의 id 는 **언제나** 이 PC 것이 남는다. 바뀌면 active 와
       * `DEEL_KEY_<id>` 가 다른 것을 가리킨다.
       *
       * 여기가 이 PC 프로필에 id 가 **있을 때만** 그렇게 했다. 그래서 id 를 안 적은
       * 프로필(문서의 예시 모양이 그렇다)에는 저장소가 적은 id 가 그대로 붙었고, 그
       * 순간 그 프로필의 열쇠 이름을 저장소가 고른 것이 된다 — 사람이 넣어 둔 다른
       * 열쇠(`DEEL_KEY_<그이름>`)가 저장소가 고른 주소로 나간다. 저장소가 더한
       * 프로필은 표식으로 막아 뒀는데(출처), 이쪽은 이 PC 프로필이라 그 막음을
       * 통째로 비켜 갔다.
       */
      delete 덮을것.id;
      for (const 칸 of 연결칸) {
        if (덮을것[칸] === undefined) continue;
        if (덮을것[칸] !== 모음[자리]?.[칸]) 적기('profiles[].baseUrl·kind·auth·제공자');
        delete 덮을것[칸];
      }
      모음[자리] = { ...모음[자리], ...덮을것 };
      continue;
    }
    if (p?.id == null && p?.name == null) { 이름없는것.push(p); continue; }
    /*
     * 저장소가 더한 프로필에는 **글자 칸으로** 표식을 단다. 열쇠를 푸는 자
     * (resolveKey)가 이걸 보고 DEEL_API_KEY 로 안 떨어진다. Symbol 로 달면 JSON
     * 왕복·structuredClone 에서 사라지고, 사라지면 **새는 쪽으로** 실패한다.
     * 저장소가 제 손으로 적은 `출처` 는 뒤에 펼쳐서 덮는다.
     */
    모음.push({ ...p, 출처: '저장소' });
  }
  cfg.profiles = 모음;
  if (이름없는것.length) 버린프로필 = 이름없는것.length;

  /*
   * active 는 이 PC 프로필을 고를 때만 받는다. 저장소가 더한 프로필을 가리키면
   * 저장소가 연결을 제 주소로 돌리는 셈이다.
   *
   * 「이 PC 프로필인가」 는 **실제로 고를 것**으로 가른다. activeProfile 은 id 로
   * 고르므로, 이 PC 프로필 이름(work)과 같은 id 로 저장소 프로필을 더하면 이름
   * 목록으로는 통과하는데 붙는 것은 저장소 프로필이었다(2차 리뷰).
   *
   * 그 「실제로 고를 것」 이 반쪽이었다. 이름 쪽은 **집 프로필 중에 그 이름이
   * 있기만 하면** 통과시켰는데, 고르는 자는 이름을 아예 안 본다. 그래서 이름으로
   * 적은 active 는 통과해 놓고 아무 id 와도 안 맞아 **목록 첫 번째**로 떨어졌다 —
   * 저장소가 적은 한 줄이 이 PC 의 엉뚱한 프로필로 연결을 돌리고, 걸러졌다는 말도
   * 안 났다.
   *
   * 그래서 activeProfile 과 **똑같이** 골라 본 다음, 골라진 것이 정말 저장소가
   * 부른 그것인지를 본다. id 가 아예 없는 설정(문서의 예시 모양이 그렇다)에서는
   * 첫 번째가 골라지고, 그 이름이 맞으면 저장소의 뜻대로 된 것이라 받는다.
   */
  if (방.active !== undefined) {
    const 골라질것 = 모음.find((x) => x?.id != null && x.id === 방.active) ?? 모음[0] ?? null;
    const 가리킨것 = 골라질것 && (골라질것.id === 방.active || 골라질것.name === 방.active) ? 골라질것 : null;
    const 이PC것 = 방.active != null && !!가리킨것 && 가리킨것.출처 !== '저장소';
    if (!이PC것) {
      if (집.active === undefined) delete cfg.active; else cfg.active = 집.active;
      if (방.active != null) 적기('active');
    }
  }

  // 금지는 합친다. 어느 쪽이 적었든 금지는 금지다.
  const 금지 = [...(집.permissions?.deny ?? []), ...(방.permissions?.deny ?? [])];
  cfg.permissions = { ...(집.permissions ?? {}), ...(방.permissions ?? {}) };
  if (금지.length) cfg.permissions.deny = [...new Set(금지)];
  // 허락은 이 PC 것만. 프로젝트가 적었어도 위에서 이미 걸러졌지만, 겹치는
  // 자리에서 한 번 더 못 박는다 — 이 한 줄이 없으면 나중에 누가 프로젝트에
  // allow 를 허용하도록 고쳤을 때 아무 데서도 안 걸린다.
  if (Array.isArray(집.permissions?.allow)) cfg.permissions.allow = 집.permissions.allow;
  else delete cfg.permissions.allow;
  return { cfg, 걸러낸것 };
}

let 신뢰소식 = null;   // 프로젝트 설정에 대해 할 말. 한 번 읽으면 지워진다.
// id 도 name 도 없어서 못 붙인 저장소 프로필 수. 조용히 버리면 안 된다.
let 버린프로필 = 0;

/**
 * 프로젝트 설정을 안 읽었거나 일부를 걷어냈으면 그것을 알려 준다.
 *
 * 조용히 무시하면 안 된다 — 적어 둔 사람은 걸린 줄 알고, 실제로는 안 걸린
 * 채로 일이 돈다. 그 어긋남이 설정 전체를 못 믿게 만든다.
 *
 * @returns {{갈래:'안믿음', 자리:string, 폴더:string}
 *          |{갈래:'걸러냄', 자리:string, 걸러낸것:Array<{칸:string,왜:string}>}
 *          |null}
 */
export function 프로젝트설정소식() { const s = 신뢰소식; 신뢰소식 = null; return s; }

function 읽기(root = process.cwd()) {
  const 집파일 = join(userDir(), 'config.json');
  const 방파일 = join(projectDir(root), 'config.json');
  const 집 = existsSync(집파일)
    ? { ...structuredClone(EMPTY), ...한장읽기(집파일) }
    : structuredClone(EMPTY);
  /*
   * profiles 가 목록이 아니면 **프로필이 없는 것**으로 친다.
   *
   * `{"profiles":null}` 은 펼치기가 EMPTY 의 빈 목록을 null 로 덮어, 켜자마자
   * activeProfile 의 `.length` 에서 「Cannot read properties of null」 로 죽었다.
   * 그 말로는 무엇을 고칠지 알 길이 없다. 「저장된 연결이 없습니다 — deel setup」
   * 이 사실에 맞는 말이다. 저장소 쪽은 프로젝트거르기가 이미 같은 것을 한다.
   */
  if (!Array.isArray(집.profiles)) 집.profiles = [];
  // 목록 안의 null·숫자 한 칸도 같다 — 손으로 고치다 남긴 `[null, {…}]` 가 모든 명령을 같은 말로 죽였다 (2.0.0 6회차 · Gemini 설정6).
  집.profiles = 집.profiles.filter((p) => p && typeof p === 'object' && !Array.isArray(p));
  // 집 폴더에서 켜면 방파일이 곧 집파일이다 — 프로젝트 설정이 아니다 (집설정파일인가 머리말).
  if (!existsSync(방파일) || 집설정파일인가(방파일)) return 집;

  /*
   * 안 믿는 폴더의 설정은 **안 읽는다.**
   *
   * 이 파일은 저장소에 딸려 온다. 남의 저장소 하나를 받은 것만으로 오간 말이
   * 다른 주소로 가고, 열쇠받기 명령이 이 계정 권한으로 도는 길이 여기다.
   * 그 명령은 도구 승인 화면보다 **앞**이라 어떤 승인 정책으로도 안 걸린다.
   */
  if (!믿나(root)) {
    신뢰소식 = { 갈래: '안믿음', 자리: 방파일, 폴더: root };
    return 집;
  }

  const { 값: 방, 걸러낸것 } = 프로젝트거르기(한장읽기(방파일));
  버린프로필 = 0;
  const { cfg: 겹친것, 걸러낸것: 겹치며걸러낸것 } = 겹치기(집, 방);
  // 저장할 때 벗기려고 둘 다 들고 있는다(방벗기기). Symbol 이라 JSON 에는 안 적힌다.
  겹친것[방흔적] = { 집: structuredClone(집), 방: structuredClone(방) };
  const 다걸러낸것 = [
    ...걸러낸것,
    ...겹치며걸러낸것,
    // id 도 name 도 없으면 어느 프로필을 고치라는 것인지 알 수 없다. 버리되 말한다.
    ...(버린프로필 ? [{ 칸: 'profiles', 왜: `id 도 name 도 없는 것 ${버린프로필}개는 못 붙였습니다` }] : []),
  ];
  if (다걸러낸것.length) 신뢰소식 = { 갈래: '걸러냄', 자리: 방파일, 걸러낸것: 다걸러낸것 };
  return 겹친것;
}

/*
 * ── 이 PC 파일에는 이 PC 것만 적는다 ────────────────────────────────────
 *
 * setup · /model · /ctx · /max · scan · 에디터의 「앞으로 묻지 않기」 가 모두
 * `load()` 가 준 **합친 것**을 그대로 저장했다. 그래서 믿는 폴더에서 한 번
 * 설정을 만지면 저장소가 더한 프로필·deny·mode 가 이 PC 설정이 되어, 그 뒤로
 * **모든 폴더에서** 걸렸다. 정책벗기기와 같은 부류다 — 덮은 것을 제 것으로 적었다.
 *
 * 가르는 법: 저장소가 적은 칸인데 값이 **저장소 값 그대로**면 이 PC 원래 값으로
 * 되돌린다. 값이 달라졌으면 프로그램이 바꾼 것이니 둔다. 저장소가 더한 프로필은
 * 표식(출처)을 보고 통째로 뺀다 — 이쪽은 흔적이 사라져도 빠진다.
 *
 * 받아들인 틈: 사람이 이 PC 설정을 **일부러 저장소와 같은 값으로** 바꾸면 되돌려
 * 진다. 그 폴더 안에서는 어차피 저장소 값이 이기므로 결과가 같고, 다른 폴더에서는
 * 원래 값이 남는다.
 */
function 방벗기기(cfg) {
  const 사본 = { ...cfg, profiles: (cfg?.profiles ?? []).filter((p) => p?.출처 !== '저장소') };
  const 흔적 = cfg?.[방흔적];
  if (!흔적) return 사본;
  const { 집, 방 } = 흔적;
  const 같다 = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  const 가진칸 = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const 되돌리기 = (대상, 원래, k) => { if (가진칸(원래, k)) 대상[k] = 원래[k]; else delete 대상[k]; };

  for (const k of Object.keys(방)) {
    if (k === 'profiles' || k === 'permissions') continue;
    if (같다(사본[k], 방[k])) 되돌리기(사본, 집, k);
  }

  if (방.permissions && 사본.permissions) {
    const 권한 = { ...사본.permissions };
    for (const k of Object.keys(방.permissions)) {
      if (k === 'deny') continue;
      if (같다(권한[k], 방.permissions[k])) 되돌리기(권한, 집.permissions, k);
    }
    // deny 는 합친 것이라 값으로 못 가른다. 저장소에서 온 항목만 뺀다.
    if (Array.isArray(권한.deny) && Array.isArray(방.permissions.deny)) {
      const 집금지 = new Set(집.permissions?.deny ?? []);
      const 방금지 = new Set(방.permissions.deny);
      권한.deny = 권한.deny.filter((x) => 집금지.has(x) || !방금지.has(x));
      if (!권한.deny.length && !Array.isArray(집.permissions?.deny)) delete 권한.deny;
    }
    if (Object.keys(권한).length || 집.permissions) 사본.permissions = 권한;
    else delete 사본.permissions;
  }

  // 이 PC 프로필에 저장소가 덮은 칸. 겹치기와 같은 차례로 맞춘다 — id 먼저, 없으면 이름.
  const 집프로필 = 집.profiles ?? [];
  const 집id = new Set(집프로필.map((x) => x?.id).filter((v) => v != null));
  사본.profiles = 사본.profiles.map((p) => {
    /*
     * 한 이 PC 프로필에 저장소 프로필이 **여럿** 얹힐 수 있다 — 겹치기가 id 로도
     * 이름으로도 맞춰 주기 때문이다(옛 저장소 설정이 이름만 적어서). 그래서
     * 저장소 하나가 이름으로 한 번 · id 로 한 번, 같은 칸을 두 번 얹는다.
     *
     * 여기가 `find` 로 **처음 걸린 것 하나**만 보고 견줬다. 그러면 뒤엣것이 얹은
     * 값은 「저장소 값과 다르니 프로그램이 바꾼 것」 으로 보여 안 걷히고, 이 PC
     * 파일에 그대로 박힌다. 그 뒤로는 어느 폴더에서 켜도 그 값이 걸린다.
     * 겹치기가 배열 차례로 덮으니, 여기서도 그 차례로 합쳐서 견준다.
     */
    const 얹힌것 = (방.profiles ?? []).filter((x) => x && (
      (x.id != null && x.id === p?.id)
      || (x.name != null && x.name === p?.name && !집id.has(x.id))));
    if (!얹힌것.length) return p;
    const q = Object.assign({}, ...얹힌것);
    // id 로 먼저 찾는다. 한 번에 둘 다 보면 이름이 같은 **앞 프로필**이 먼저 걸려,
    // 뒤 프로필을 앞 프로필의 id·값으로 되돌려 적었다(2차 리뷰).
    const 원래 = (p.id != null && 집프로필.find((x) => x?.id === p.id))
      || 집프로필.find((x) => x?.name != null && x.name === p.name) || {};
    const r = { ...p };
    for (const k of Object.keys(q)) {
      if (같다(r[k], q[k])) 되돌리기(r, 원래, k);
    }
    return r;
  });
  return 사본;
}

/*
 * 저장은 **이 PC 파일 한 곳**뿐이다.
 *
 * 저장소 파일에 적는 갈래(`toProject`)가 있었는데, 부르는 자리는 잠금옮기기
 * 하나였고 그마저 합친 것을 저장소로 옮기는 길이었다. 남겨 두면 다음에 누가
 * 부르는 순간 이 PC 프로필과 잠긴 열쇠가 저장소 파일로 나간다(2차 리뷰).
 * 저장소 설정은 사람이 손으로 적는다.
 */
export function save(cfg) {
  const dir = userDir();
  const p = join(dir, 'config.json');
  mkdirSync(dir, { recursive: true });
  // 평문 열쇠는 여기서 잠근다. 설정을 쓰는 길이 여기 하나뿐이라, 여기만
  // 지키면 평문이 새 파일로 나갈 자리가 없다. 못 잠그면 평문으로 두되
  // (아무것도 못 하는 것보다 낫다) 화면과 심사서에 그렇게 적는다.
  if (process.env.DEEL_KEYSTORE !== 'off') {
    for (const 프로필 of cfg?.profiles ?? []) {
      if (!프로필?.apiKey || 잠긴것인가(프로필.apiKey)) continue;
      const 잠근것 = 잠그기(프로필.apiKey, { 프로필id: 프로필.id });
      if (잠근것) 프로필.apiKey = 잠근것;
    }
  }
  // 정책이 얹은 값은 사람 파일에 안 적는다 (정책벗기기). 이 PC 파일에는 저장소가
  // 얹은 것도 안 적는다 (방벗기기). 정책 쪽이 먼저다 — 그쪽은 프로필 객체로 맞춘다.
  const 적을것 = 방벗기기(정책벗기기(cfg));
  /*
   * 옆 임시 파일에 다 적고 **이름을 바꿔** 갈아 끼운다 (2.0.0 6회차 · Gemini 설정6).
   *
   * 제자리에서 덮어쓰면 적는 도중 끊겼을 때(전원 · 강제 종료 · 디스크 참) 프로필과 열쇠가 든 파일이
   * 0바이트나 반쪽 JSON 으로 남고, 다음에 켜면 「설정 파일을 읽지 못했습니다」 로 모든 명령이 선다.
   * 임시 파일은 처음부터 본인만 읽게 만든다(열쇠가 든다). 윈도우는 누가 그 파일을 읽는 순간 이름
   * 바꾸기를 EPERM 으로 튕기므로 잠깐씩 다시 한다 — safety/trust.js 의 쓰기 와 같은 방식이다.
   */
  const 임시 = `${p}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(임시, JSON.stringify(적을것, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  for (let 번 = 0; ; 번++) {
    try { renameSync(임시, p); break; }
    catch (err) {
      if (번 >= 20) { try { rmSync(임시, { force: true }); } catch { /* 남아도 원래 설정은 멀쩡하다 */ } throw err; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  // 키가 들어 있는 파일이므로 가능한 환경에서는 본인만 읽게 잠근다.
  try { chmodSync(p, 0o600); } catch {}
  return p;
}

/**
 * 설정을 남긴다. 못 남겨도 던지지 않고, **왜 못 남겼는지를 돌려준다.**
 *
 * 부르는 자리가 아홉 군데인데 전부 `try { save(cfg) } catch {}` 였다. 「못
 * 남겨도 이번 세션에는 먹는다」 는 맞는 말이지만, 그 뒤에 화면은 `✓` 를
 * 찍는다 — 사람은 정해진 줄 알고 다음에 창을 열었다가 옛 값을 본다. 그리고
 * 그때는 무엇 때문인지 알 길이 없다(홈이 읽기 전용인지, 디스크가 찼는지).
 *
 * 던지는 것은 안 바꾼다. 설정 하나 못 적었다고 대화가 끊기면 본말이 뒤집힌다.
 *
 * @returns {{ok: true, 자리: string} | {ok: false, 왜: string}}
 */
export function 저장시도(cfg, 옵션 = {}) {
  try { return { ok: true, 자리: save(cfg, 옵션) }; }
  catch (err) { return { ok: false, 왜: err?.message ?? String(err) }; }
}

export function activeProfile(cfg = load()) {
  if (!cfg.profiles.length) return null;
  return cfg.profiles.find((x) => x.id === cfg.active) ?? cfg.profiles[0];
}

// 환경변수가 있으면 파일보다 우선한다 — 사내망에서 키를 파일에 안 남기고 싶을 때 쓴다.
const 푼것 = new Map();     // 잠긴 값 → 푼 글. 한 판에 한 번만 풀면 된다.

/**
 * 잠근 열쇠를 못 푼 까닭. 화면이 한 번 읽어 가면 지워진다.
 *
 * ── 왜 있어야 하나 ──────────────────────────────────────────────────────
 *
 * keystore.js 의 풀기() 는 왜 못 풀었는지를 성실하게 만들어 돌려준다 —
 * 「이 PC 의 이 계정에서 잠근 것만 풀립니다」 같은 말이다. 그 함수 머리말이
 * 그렇게 하는 까닭까지 적어 뒀다: **빈 글자만 돌려주면 사람은 401 만 보고
 * 게이트웨이를 의심한다.**
 *
 * 그런데 부르는 쪽이 그 말을 버리고 있었다. 빈 열쇠가 나가면 http.js 는
 * Authorization 머리말을 아예 안 붙이고, 게이트웨이는 401 을 준다. 사람은
 * 방화벽·주소·계정을 뒤진다. 진짜 까닭은 「설정 파일을 다른 PC 로 옮겼다」 인데.
 */
let 열쇠탈 = null;
export function 열쇠탈소식() { const s = 열쇠탈; 열쇠탈 = null; return s; }

/**
 * 이 이름의 환경변수는 **열쇠를 담나.**
 *
 * ── 왜 이 자가 있어야 하나 ────────────────────────────────────────────
 *
 * 열쇠는 두 이름으로 들어온다 — `DEEL_API_KEY` 하나, 그리고 프로필마다
 * `DEEL_KEY_<프로필>`. 아래 resolveKey 가 그 둘을 다 읽는다.
 *
 * 그런데 **막는 쪽은 하나만 알고 있었다.** 자식에게 넘길 환경을 씻는 자
 * (backend/mcp.js 의 열쇠뺀환경)도, 도구 출력에서 값을 가리는 자
 * (agent/loop.js)도 `DEEL_API_KEY` 만 지웠다. 그래서 프로필 열쇠를 쓰는
 * 사람은 `Bash({command:'env'})` 한 줄로 열쇠가 화면에 찍히고, 그 화면이
 * 대화에 실려 **그 열쇠의 주인인 게이트웨이로** 나가고 `.deel/sessions/*.jsonl`
 * 에 남는다.
 *
 * 하필 그 방법을 우리가 권한다 — pack/sbom.js 와 pack/sheet.en.js 의 사내
 * 심사용 명세가 「환경변수를 쓰면 파일에 아예 안 남습니다」 라고 적어 뒀다.
 * 권한 대로 한 사람만 샌 셈이다.
 *
 * 읽는 자리와 막는 자리가 **같은 자에게 물어야** 이런 일이 안 난다. 이름이
 * 하나 늘면 여기만 고친다.
 *
 * 윈도우는 환경변수 이름의 대소문자를 안 가린다(`deel_api_key` 도 같은 값이다).
 * 그래서 견줄 때 대문자로 올린다.
 */
export function 열쇠환경인가(이름) {
  const n = String(이름 ?? '').toUpperCase();
  return n === 'DEEL_API_KEY' || n.startsWith('DEEL_KEY_');
}

/**
 * 이 프로필의 열쇠를 담을 수 있는 **환경변수 이름.** 없으면 null.
 *
 * ── 왜 한 자리에 있어야 하나 ──────────────────────────────────────────
 *
 * 이 이름을 짓는 자가 셋이었다 — resolveKey(집는 자) · 열쇠출처(화면에 적는 자)
 * · configexplain(어느 층이 이겼나를 그리는 자). 셋이 조금씩 달랐고, 그 차이가
 * 그대로 두 가지 탈이 됐다:
 *
 *   · 숫자 id. `profile.id.toUpperCase` 는 함수가 아니라 모든 명령이 TypeError 로
 *     끝났다. 설정은 사람이 손으로 적는 JSON 이라 `"id": 7` 이 정말 들어온다.
 *   · **저장소가 더한 프로필.** `DEEL_KEY_<id>` 를 받아 준 까닭은 「사람이 그 이름을
 *     골라 넣었다」 였다. 그런데 저장소가 더한 프로필은 그 id 를 **저장소가 적는다.**
 *     사람이 쓰던 열쇠 이름을 맞히기만 하면 그 열쇠가 저장소가 고른 주소로 나갔다.
 *     DEEL_API_KEY 는 같은 까닭으로 이미 막혀 있었는데 이쪽만 열려 있었다.
 */
export function 열쇠환경이름(profile) {
  if (!profile?.id) return null;
  if (profile.출처 === '저장소') return null;
  return `DEEL_KEY_${String(profile.id).toUpperCase()}`;
}

/** 환경에 실제로 들어 있는 **열쇠 값들.** 가릴 때 쓴다. */
export function 환경속열쇠들(env = process.env) {
  const out = [];
  for (const [k, v] of Object.entries(env ?? {})) {
    if (열쇠환경인가(k) && typeof v === 'string' && v) out.push(v);
  }
  return out;
}

/**
 * 이 프로필의 열쇠는 **어디서 오나.** 값은 안 담는다 — 자리 이름만 준다.
 *
 * ── 왜 이 자가 있어야 하나 ────────────────────────────────────────────
 *
 * 열쇠는 네 자리에서 온다. 차례가 있고, 그 차례를 아는 자가 둘이다 —
 * 아래 resolveKey 와 backend/adapter.js 의 머리말짓기. 그런데 **화면에 적는
 * 자(doctor)는 제 차례를 따로 들고 있었다.**
 *
 *   진짜    열쇠받기(명령) → DEEL_KEY_<프로필> → DEEL_API_KEY → 설정 파일
 *   doctor  DEEL_API_KEY → DEEL_KEY_<프로필> → 열쇠받기 → 설정 파일
 *
 * 둘 다 넣어 둔 사람에게 doctor 는 「환경변수 DEEL_API_KEY」 라고 적는데,
 * 실제로 나가는 것은 `DEEL_KEY_<프로필>` 이다. 그 사람은 화면이 가리킨
 * 자리만 백 번 고친다. 잰 값 자체는 맞으므로(열쇠는 있다) 아무도 안 이상해한다.
 *
 * 열쇠받기는 더 어긋나 있었다. 그건 요청 **직전**에 받아서 다른 무엇보다
 * 먼저 실리는데(adapter.js 머리말짓기), doctor 목록에서는 환경변수 뒤였다.
 *
 * 차례를 아는 자를 하나로 둔다. 자리가 하나 늘면 여기만 고친다.
 *
 * @param {object|null} profile
 * @param {object} o
 * @param {boolean} o.받기쓰나  열쇠받기가 이번 자리에서 실제로 도는가.
 *                              (봉인 중이거나 auth:'none' 이면 안 돈다 —
 *                               그 판단은 safety/authcmd.js 의 쓸수있나() 몫이라
 *                               부르는 쪽이 물어보고 넘긴다.)
 * @returns {{갈래: '명령'|'환경변수'|'파일'|null, 이름: string, 말: string}}
 */
export function 열쇠출처(profile, { 받기쓰나 = false } = {}) {
  if (받기쓰나) return { 갈래: '명령', 이름: '', 말: '명령으로 받아 옵니다' };
  const 프로필이름 = 열쇠환경이름(profile);
  if (프로필이름 && process.env[프로필이름]) {
    return { 갈래: '환경변수', 이름: 프로필이름, 말: `환경변수 ${프로필이름}` };
  }
  if (process.env.DEEL_API_KEY && profile?.출처 !== '저장소') {
    return { 갈래: '환경변수', 이름: 'DEEL_API_KEY', 말: '환경변수 DEEL_API_KEY' };
  }
  if (profile?.apiKey) return { 갈래: '파일', 이름: '', 말: '설정 파일' };
  return { 갈래: null, 이름: '', 말: '' };
}

export function resolveKey(profile) {
  const 이름 = 열쇠환경이름(profile);
  const byName = 이름 ? process.env[이름] : null;
  /*
   * 저장소가 더한 프로필은 환경변수 열쇠를 **하나도** 안 집는다. DEEL_API_KEY 는
   * 사람이 제 게이트웨이에 쓰라고 넣은 것이고, `DEEL_KEY_<id>` 도 그 id 를
   * 저장소가 적는 순간 사람이 고른 이름이 아니다 (열쇠환경이름 머리말).
   */
  const 전체열쇠 = profile?.출처 === '저장소' ? '' : process.env.DEEL_API_KEY;
  const 값 = byName || 전체열쇠 || profile?.apiKey || '';
  if (!잠긴것인가(값)) return 값;
  // 푸는 데 파워셸을 한 번 부른다(0.2초쯤). 한마디마다 부르면 그게 다 사람이
  // 기다리는 시간이라, 판에 한 번만 풀고 들고 있는다.
  if (푼것.has(값)) return 푼것.get(값);
  const r = 풀기(값);
  if (!r.ok) {
    /*
     * **실패는 안 담아 둔다.**
     *
     * 담아 두면 그 판 내내 다시 시도조차 안 한다. 사람이 그 사이에
     * `deel setup` 으로 열쇠를 다시 넣어도 이 판에서는 영영 안 풀린다.
     * 푸는 값이 0.2초라, 안 되는 것을 아껴서 얻을 것이 없다.
     */
    열쇠탈 = r.why || '잠근 열쇠를 못 풀었습니다';
    return '';
  }
  푼것.set(값, r.text);
  return r.text;
}

export function upsert(cfg, profile) {
  const i = cfg.profiles.findIndex((x) => x.id === profile.id);
  if (i >= 0) cfg.profiles[i] = { ...cfg.profiles[i], ...profile };
  else cfg.profiles.push(profile);
  if (!cfg.active) cfg.active = profile.id;
  return cfg;
}

export function slug(name) {
  const base = String(name).trim().toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'profile';
}

/**
 * 진입점마다 한 번씩 비워야 하는 **모아 둔 소식** 전부.
 *
 * ── 왜 한 자리에 모아야 하나 ──────────────────────────────────────────
 *
 * 이 프로그램에는 「나중에 화면이 한 번 읽어 가면 지워지는」 소식이 넷
 * 있다. 잠금소식(열쇠를 방금 잠갔다) · 프로젝트설정소식(이 폴더 설정을 안
 * 읽었거나 걷어냈다) · 열쇠탈소식(잠근 열쇠를 못 풀었다) · 정책 탈(관리
 * 정책 파일이 깨졌다).
 *
 * 넷 다 **당겨 가는 꼴**이다. 그래서 안 당기는 문은 아무 표시도 안 난다 —
 * 「알릴 것이 없다」 와 화면에서 똑같이 생긴다. 당기는 문은 둘뿐이었다
 * (대화 화면과 `deel run`). `deel setup` · `deel doctor` · `deel reset` ·
 * 에디터(ACP)는 하나도 안 당겼다.
 *
 * 제일 값이 큰 것이 정책 탈이다. `policy.json` 이 깨지면 관리자가 걸어 둔
 * offline·baseUrl·금지가 **통째로 안 걸린다.** 그런데 그 말을 하던 자
 * (규칙말)는 src 안에 부르는 데가 한 곳도 없었다 — 죽은 코드였다. 관리자는
 * 잠긴 줄 알고, 배치 작업은 아무 제한 없이 돈다.
 *
 * 문이 하나 늘면 이 함수만 부르면 된다.
 *
 * @returns {string[]} 그대로 찍으면 되는 줄들. 없으면 빈 배열.
 */
export function 소식줄들(cfg = null) {
  const 줄 = [];
  const 잠금 = 잠금소식();
  if (잠금) 줄.push(`  ${mark.ok} ${잠금}`);
  줄.push(...프로젝트설정줄들(프로젝트설정소식()));
  const 탈 = 규칙모으기(cfg ?? { permissions: {} }).탈;
  if (탈) 줄.push(`  ${mark.warn} ${탈}`);
  const 열쇠탈 = 열쇠탈소식();
  if (열쇠탈) 줄.push(`  ${mark.warn} ${열쇠탈}`);
  return 줄.filter((x) => x !== '' || 줄.length > 1);
}

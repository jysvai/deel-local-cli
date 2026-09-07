// 게이트웨이가 **우리 인증서**를 요구할 때 (mTLS).
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────
//
// 금융·공공 쪽 사내 게이트웨이는 열쇠 하나로 안 열린다. 서버가 클라이언트에게도
// 인증서를 내라고 한다 — 열쇠는 훔쳐 갈 수 있지만 기기에 발급한 인증서는 그
// 기기를 벗어나지 못한다는 것이 그 요구의 요지다. 그 자리에서 우리가 인증서를
// 못 내면 붙는 방법이 아예 없다. 「사내에서 못 씁니다」 가 되고, 그건 다른
// 어떤 기능으로도 못 메운다.
//
// ── 왜 fetch 를 못 쓰나 ────────────────────────────────────────────────
//
// Node 의 `fetch` 에는 인증서를 실을 자리가 없다. 그 자리는 undici 의
// dispatcher 인데, 그건 가져다 쓸 수 있는 이름이 아니다(그리고 이 프로그램은
// 딸린 것을 안 쓴다). 그래서 인증서를 쓰는 요청은 `node:https` 로 보낸다 —
// 프록시를 거치는 길에서 이미 그렇게 하고 있으므로 길이 하나 더 생기는 것이
// 아니라, 이미 있던 길에 인증서를 얹는 것이다 (backend/http.js 의 노드로).
//
// ── 어디에 적나 ────────────────────────────────────────────────────────
//
// 프로필에 적는다. 파일 **경로**만 적는다 — 알맹이를 설정 파일에 넣으면 그
// 파일이 곧 개인키가 되고, 그건 백업·동기화·화면 공유를 타고 아무 데나 간다.
//
//     "인증서": {
//       "cert": "C:/certs/client.pem",     PEM 인증서
//       "key":  "C:/certs/client.key",     PEM 개인키
//       "ca":   "C:/certs/corp-ca.pem"     (선택) 사내 루트
//     }
//
// PKCS#12 한 덩이(`.pfx`·`.p12`)도 받는다 — 윈도우에서 받아 오는 모양이다.
//
//     "인증서": { "pfx": "C:/certs/client.pfx" }
//
// 암호는 **설정에 안 적는 것을 기본으로** 한다. `DEEL_CERT_PASS` 환경변수를
// 먼저 보고, 없을 때만 설정의 `passphrase` 를 쓴다. 어느 쪽이든 화면·기록에
// 안 나간다 (safety/secrets.js 가 가리는 것과 같은 규칙).
//
// ── 어느 주소에 붙나 ───────────────────────────────────────────────────
//
// **주소(origin)로 기억한다.** 프로필에 적힌 게이트웨이 주소에만 붙고, 다른
// 집으로는 절대 안 나간다. 되돌림(redirect)을 따라 남의 집으로 갈 때 우리
// 인증서가 따라가면 그건 신원을 남에게 보여 주는 것이다 — 열쇠 머리말을 떼는
// 것과 같은 까닭으로 여기서도 안 따라간다.
import { readFileSync, statSync } from 'node:fs';

/** 프로필에 적힌 것을 한 모양으로 편다. 없으면 null. */
export function 인증서설정(prof) {
  const 것 = prof?.인증서 ?? prof?.clientCert ?? null;
  if (!것 || typeof 것 !== 'object') return null;
  const 글 = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const 편것 = {
    cert: 글(것.cert ?? 것.certFile ?? 것.인증서),
    key: 글(것.key ?? 것.keyFile ?? 것.열쇠),
    pfx: 글(것.pfx ?? 것.p12 ?? 것.pfxFile),
    ca: 글(것.ca ?? 것.caFile ?? 것.뿌리),
    // 암호만 값이다. 나머지는 전부 파일 경로다.
    passphrase: 글(것.passphrase ?? 것.암호),
  };
  /*
   * 아무것도 안 적었으면 없는 것으로 친다. 빈 껍데기를 들고 다니면 아래에서
   * 「인증서를 쓴다」 고 판단해 놓고 실제로는 아무것도 안 싣는다.
   *
   * `ca` 만 적은 것도 받는다. 사내 루트만 필요하고 우리 인증서는 안 내는
   * 게이트웨이가 흔한데, 여태 그 자리의 길은 NODE_EXTRA_CA_CERTS 환경변수
   * 하나뿐이었다 — 그건 프로필마다 다르게 못 준다. 사내 게이트웨이와 로컬
   * 모델을 오가는 사람에게는 그게 곧 못 쓰는 것이다.
   */
  if (!편것.cert && !편것.pfx && !편것.ca) return null;
  return 편것;
}

// 주소 → 설정. 프로그램이 사는 동안만 있는다.
const 등록부 = new Map();

/** 주소를 origin 하나로. 못 읽으면 null. */
function 집(주소) {
  try { return new URL(String(주소)).origin; } catch { return null; }
}

/** 이 게이트웨이는 우리 인증서를 요구한다고 적어 둔다. */
export function 인증서등록(주소, 설정) {
  const o = 집(주소);
  if (!o) return;
  if (설정) 등록부.set(o, 설정);
  else 등록부.delete(o);
}

/** 검사와 `/model` 갈아타기가 쓴다. */
export function 인증서잊기() { 등록부.clear(); 읽은것.clear(); }

// 파일 경로 → { 때, 알맹이 }. 요청마다 디스크를 읽지 않으려고 들고 있는다.
// 파일이 바뀌면(인증서를 새로 받으면) 다시 읽는다 — 프로그램을 껐다 켜야
// 새 인증서가 먹는다면 그건 하루짜리 인증서를 쓰는 자리에서 못 쓴다는 뜻이다.
const 읽은것 = new Map();

function 파일읽기(경로, 무엇) {
  let 때;
  try { 때 = statSync(경로).mtimeMs; }
  catch (err) { throw 못읽음(무엇, 경로, err); }
  const 있던것 = 읽은것.get(경로);
  if (있던것 && 있던것.때 === 때) return 있던것.알맹이;
  let 알맹이;
  try { 알맹이 = readFileSync(경로); }
  catch (err) { throw 못읽음(무엇, 경로, err); }
  읽은것.set(경로, { 때, 알맹이 });
  return 알맹이;
}

function 못읽음(무엇, 경로, err) {
  return Object.assign(
    new Error(`${무엇}를 못 읽었습니다: ${경로}\n  ${err?.message ?? err}`),
    { code: 'CERT_READ' },
  );
}

/**
 * 이 주소에 실을 TLS 옵션. 등록된 것이 없으면 null.
 *
 * 파일을 여기서 읽는다 — 켤 때 한 번 읽어 두면 짧게 도는 인증서를 갈아 끼웠을
 * 때 프로그램을 껐다 켜야 한다. 읽은 것은 파일이 그대로면 다시 안 읽는다.
 *
 * @throws 인증서 파일을 못 읽으면 던진다. 조용히 빼고 붙으면 서버가 주는
 *         것은 TLS 악수 실패인데, 그 화면은 「인증서가 없다」 와 「인증서가
 *         틀렸다」 를 구별해 주지 않는다.
 */
export function 인증서찾기(주소) {
  const o = 집(주소);
  const 설정 = o ? 등록부.get(o) : null;
  if (!설정) return null;
  const 옵션 = {};
  if (설정.pfx) 옵션.pfx = 파일읽기(설정.pfx, '클라이언트 인증서(pfx)');
  if (설정.cert) 옵션.cert = 파일읽기(설정.cert, '클라이언트 인증서');
  if (설정.key) 옵션.key = 파일읽기(설정.key, '클라이언트 개인키');
  if (설정.ca) 옵션.ca = 파일읽기(설정.ca, '사내 루트 인증서');
  /*
   * 암호는 환경변수가 먼저다.
   *
   * 설정 파일은 백업·동기화·화면 공유를 타고 아무 데나 간다. 환경변수는 그
   * 프로세스에만 있다. 둘 다 있으면 환경변수를 쓴다 — 파일에 적힌 것을
   * 「임시로 다른 것을 써 보기」 위해 고치지 않아도 되게.
   */
  const 암호 = process.env.DEEL_CERT_PASS || 설정.passphrase;
  if (암호) 옵션.passphrase = 암호;
  return Object.keys(옵션).length ? 옵션 : null;
}

/**
 * 화면에 보여 줄 한 줄. **암호는 절대 안 들어간다.**
 *
 * 무엇을 쓰고 있는지 사람이 볼 수 있어야 한다 — 붙었는지 아닌지만 알고
 * 무엇으로 붙었는지 모르면, 인증서를 두 개 가진 사람은 어느 것이 먹었는지
 * 알 길이 없다.
 */
export function 인증서말(설정) {
  if (!설정) return null;
  const 조각 = [];
  if (설정.pfx) 조각.push(`pfx ${설정.pfx}`);
  if (설정.cert) 조각.push(`cert ${설정.cert}`);
  if (설정.key) 조각.push('key(적힘)');
  if (설정.ca) 조각.push(`ca ${설정.ca}`);
  const 암호 = process.env.DEEL_CERT_PASS ? '환경변수' : (설정.passphrase ? '설정' : null);
  if (암호) 조각.push(`암호 ${암호}에서`);
  return 조각.join(' · ');
}

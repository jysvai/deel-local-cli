// Bash 로 띄우는 자식에게 무엇을 물려주나.
//
// ── 무엇을 막나 ────────────────────────────────────────────────────────
//
// 자식에게 넘기는 환경에서 빼는 것이 우리 열쇠뿐이면(backend/mcp.js 의 열쇠뺀환경 —
// DEEL_API_KEY · DEEL_KEY_*) 이런 것들이 그대로 넘어간다.
//
//     OPENAI_API_KEY   ANTHROPIC_API_KEY   GITHUB_TOKEN
//     AWS_SECRET_ACCESS_KEY   NPM_TOKEN   DB_PASSWORD
//
// 모델이 `env` 나 `printenv`(`env | grep -i proxy` 처럼 아주 정상적인 확인)를 한 번 부르면
// 그 값들이 **도구 결과로 대화에 실려** 게이트웨이로 나가고 `.deel/sessions/*.jsonl` 로
// 디스크에도 남는다. 남의 회사 열쇠를 우리 게이트웨이 운영자에게 보내는 셈이다.
//
// ── 왜 이름 무늬로 거르나 ──────────────────────────────────────────────
//
// 이름 목록은 **언제나 낡는다** — 새 이름이 생기고 사내 이름(`SKT_GW_TOKEN`)은 우리가 알 수
// 없다. 값을 보고 판단하는 길은 열쇠 같은 글자와 그냥 긴 글자를 가를 수 없어서 조용히 새거나
// 조용히 막힌다. 그래서 **이름의 마디**를 본다. `_` 로 나눈 마디 하나가 KEY·TOKEN·SECRET·
// PASSWORD·CREDENTIAL·PASSPHRASE 이면 뺀다.
//
// 마디로 보는 것이 요점이다. `*KEY*` 통무늬면 `MONKEY_PATCH` · `KEYBOARD_LAYOUT` 이 같이
// 걸리고, 그런 오작동은 「내 스크립트가 deel 안에서만 안 돈다」 로 끝나 원인을 못 찾는다.
//
// 일부러 안 넣은 것이 둘 있다.
//
//   PWD    유닉스에서 지금 폴더다. 빼면 거의 모든 셸 스크립트가 부서진다.
//   AUTH   SSH_AUTH_SOCK 이 걸린다. 그건 열쇠가 아니라 통로 이름이고, 빼면 `git push` 가
//          안 된다. 그래서 마디표에는 없고 **마지막 마디**일 때만 건다(아래 끝에만마디 —
//          NPM_CONFIG__AUTH 는 비밀이다).
//
// ── 뺀 것은 말한다 ─────────────────────────────────────────────────────
//
// 이 파일에서 제일 중요한 줄이다. 사내 저장소를 쓰는 사람은 `npm ci` 에 `NPM_TOKEN` 이
// 필요한데, 조용히 빼면 401 만 남아 사람은 토큰이 만료된 줄 알고 새로 발급받으러 간다.
// 그래서 **무엇을 뺐는지 이름을 돌려준다.** 값은 절대 안 돌려준다. 부르는 쪽이 그 이름을
// 도구 결과에 적고 되살리는 법 한 줄을 같이 적는다.
import { 열쇠환경인가 } from '../config.js';
import { 웹훅주소인가 } from './secrets.js';

/**
 * 이 마디가 있으면 뺀다.
 *
 * 마디는 `_` 로 나눈 조각이다. `AWS_SECRET_ACCESS_KEY` → SECRET 과 KEY 가
 * 걸리고, `KEYCLOAK_URL` → KEYCLOAK·URL 이라 안 걸린다.
 */
export const 비밀마디 = Object.freeze([
  'KEY', 'KEYS', 'APIKEY',
  'TOKEN', 'TOKENS',
  'SECRET', 'SECRETS',
  'PASSWORD', 'PASSWD', 'PASSPHRASE',
  'CREDENTIAL', 'CREDENTIALS',
]);

const 마디표 = new Set(비밀마디);

/*
 * ── `_` 로만 가르면 새는 이름들 ─────────────────────────────
 *
 * 위 마디표는 `_` 로 나눈 조각이 **통째로** 같을 때만 걸린다. 실제 이름은 얌전하지 않다 —
 *
 *     PGPASSWORD  AWS_SECRETACCESSKEY  PRIVATEKEY      붙여 씀
 *     GITHUB-TOKEN                                     붙임표
 *     githubToken  npm_config__authToken               낙타 꼴
 *     MYSQL_PWD  GH_PAT  CI_JOB_JWT                    짧은 이름
 *     DATABASE_URL=postgres://u:비밀번호@h/db          값에 든 자격
 *
 * 그래서 셋을 더 본다.
 *
 *   1) 마디를 `_` · `-` · `.` 과 **낙타 꼴 경계**(소문자·숫자 다음 대문자)로 가른다.
 *   2) 한 마디가 아래 끝말로 **끝나면** 건다. KEY 는 끝말에 안 넣고 APIKEY·ACCESSKEY 처럼
 *      붙어 쓰이는 꼴만 넣는다. KEY 로 끝나기만 보면 MONKEY_PATCH · TURKEY_TZ 가 걸린다.
 *   3) PWD · PAT · JWT · AUTH 는 **다른 마디 뒤 마지막 마디**일 때만 건다. `PWD` 혼자는 지금
 *      폴더다. `MYSQL_PWD` 는 비밀번호다. JWT_ISSUER · COMPAT_LAYER 같은 설정 이름은 안 건다.
 *      AUTH 도 같은 갈래다 — npm 의 `NPM_CONFIG__AUTH` 는 base64 사용자:비밀번호인데,
 *      끝 마디만 보므로 `SSH_AUTH_SOCK`(끝이 SOCK)은 그대로 산다.
 */
const 비밀끝말 = Object.freeze([
  'PASSWORD', 'PASSWD', 'PASSPHRASE',
  'TOKEN', 'TOKENS', 'SECRET', 'SECRETS', 'CREDENTIAL', 'CREDENTIALS',
  'APIKEY', 'ACCESSKEY', 'PRIVATEKEY', 'SECRETKEY', 'AUTHKEY', 'MASTERKEY', 'SIGNINGKEY', 'ENCRYPTIONKEY',
]);
const 끝에만마디 = new Set(['PWD', 'PAT', 'JWT', 'AUTH']);

/** 이름을 마디로 — `_` `-` `.` 과 낙타 꼴 경계. 대문자로 맞춰 돌려준다. */
function 이름마디들(이름) {
  return String(이름 ?? '')
    .split(/[_\-.]+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter(Boolean)
    .map((x) => x.toUpperCase());
}

/*
 * 값에 `사용자:비밀번호@` 가 든 주소인가.
 *
 * `://` 바로 뒤 자격 자리만 본다 — 경로에 든 `a:b@c` 나 포트(`host:8443`)는 자격이
 * 아니다. 비밀번호 칸이 빈 것(`http://user@host`)은 안 건다. 사내 프록시에 자격을
 * 넣어 둔 것(`http://id:pw@proxy:8080`)도 빠진다 — 그 비밀번호는 흔히 사내 계정
 * 비밀번호라 대화에 실려 나가면 안 되고, 필요하면 남길것 에 적어 되살린다(아래 뺀것 안내).
 */
const 자격든주소 = /^[a-z][a-z0-9+.-]*:\/\/[^\s/?#@:]*:[^\s/?#@]+@/i;

/**
 * 이 값이 자격이 든 주소인가. 이름으로는 못 거르는 DATABASE_URL 같은 것을 거른다.
 *
 * 웹훅 주소·Sentry DSN 도 본다 — 주소 자체가 열쇠인데 이름(SLACK_WEBHOOK_URL · TEAMS_URL)도
 * 꼴(사람:암호@)도 그렇다고 말하지 않는다. 무늬는 가리기와 한 벌이다(secrets.js 의 웹훅주소인가).
 */
function 비밀값인가(값) {
  return typeof 값 === 'string' && (자격든주소.test(값.trim()) || 웹훅주소인가(값));
}

/**
 * 이 환경변수 이름이 열쇠처럼 생겼나.
 *
 * @param {string} 이름
 * @param {{남길것?: string[]}} [설정]  사람이 되살리라고 적어 둔 이름들
 */
export function 비밀환경인가(이름, { 남길것 = [] } = {}) {
  const n = String(이름 ?? '').toUpperCase();
  if (!n) return false;
  // 사람이 되살리라고 적은 것은 무늬에 걸려도 그대로 넘긴다. 사람이 제
  // 환경을 우리보다 잘 안다 — 우리는 기본값만 정한다.
  if (남길것.some((x) => String(x ?? '').toUpperCase() === n)) return false;
  if (n.split('_').some((조각) => 마디표.has(조각))) return true;
  // 붙여 쓴 이름·낙타 꼴·짧은 끝 마디 (위 「`_` 로만 가르면 새는 이름들」)
  const 마디들 = 이름마디들(이름);
  if (마디들.some((조각) => 마디표.has(조각) || 비밀끝말.some((끝) => 조각.endsWith(끝)))) return true;
  return 마디들.length > 1 && 끝에만마디.has(마디들[마디들.length - 1]);
}

/**
 * 설정에서 「남길 것」 을 꺼낸다.
 *
 *     "셸환경": { "남길것": ["NPM_TOKEN", "GITHUB_TOKEN"] }
 *
 * 이름만 받는다. 무늬를 받으면 `*` 하나로 전부 되살아나는데, 그건 이
 * 안전장치를 끄는 것과 같으면서 껐다는 자각이 없다.
 */
export function 남길것읽기(cfg) {
  const 것 = cfg?.셸환경?.남길것 ?? cfg?.shellEnv?.keep;
  return (Array.isArray(것) ? 것 : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
}

/**
 * 자식에게 물려줄 환경을 만든다.
 *
 * 우리 열쇠(DEEL_API_KEY · DEEL_KEY_*)는 언제나 뺀다 — 그건 되살릴 방법을
 * 주지 않는다. 우리 열쇠를 자식에게 줘야 할 까닭이 없고, 그 하나가 새면
 * 이 프로그램이 지키겠다고 한 것을 이 프로그램이 깬다.
 *
 * @param {object} [env]
 * @param {{남길것?: string[]}} [설정]
 * @returns {{env: object, 뺀것: string[]}}  뺀것은 **이름만**. 값은 안 준다.
 */
export function 셸환경(env = process.env, { 남길것 = [] } = {}) {
  const out = { ...env };
  const 뺀것 = [];
  const 남기라함 = (k) => 남길것.some((x) => String(x ?? '').toUpperCase() === String(k).toUpperCase());
  for (const k of Object.keys(out)) {
    if (열쇠환경인가(k)) { delete out[k]; continue; }   // 우리 것은 말없이 뺀다
    // 이름이 멀쩡해도 값이 자격 든 주소면 뺀다 (비밀값인가 머리말). 되살리는 길은 같다.
    if (비밀환경인가(k, { 남길것 }) || (비밀값인가(out[k]) && !남기라함(k))) { delete out[k]; 뺀것.push(k); }
  }
  뺀것.sort();
  return { env: out, 뺀것 };
}

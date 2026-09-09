// 통신이 깨졌을 때 **무슨 말을 하는가.**
//
// ── 왜 이 검사가 생겼나 ─────────────────────────────────────────────────
//
// `normalizeError` 는 서버·런타임이 준 글을 정규식 사다리로 읽어 사람 말로
// 갈아 끼운다. 갈래가 열두 개인데 검사가 한 줄도 없었다. 이 사다리는
// 「죽은 규칙」 이 제일 잘 자라는 꼴이다.
//
//   갈래가 안 걸려도 아무 일도 안 난다. 마지막 `return m` 이 원문을 그대로
//   돌려주고, 원문도 그럴듯한 영어 문장이라 화면이 멀쩡해 보인다.
//
// 그런데 두 갈래는 안 걸리면 **진짜로 나쁜 일**이 난다.
//
// ── 1. 열쇠가 새는 자리 ─────────────────────────────────────────────────
//
// 헤더 값에 줄바꿈이나 NUL 이 섞이면 런타임이 이렇게 말한다.
//
//     Headers.append: "sk-ant-진짜열쇠…" is an invalid header value.
//
// **열쇠를 통째로 따옴표 안에 넣어서** 말한다. 그 문장은 화면에도 뜨고
// 진단 보고서 파일에도 적히는데, 그 파일은 우리가 「사내망에서 돌렸다면
// 이것만 가져오시면 됩니다」 라고 권하는 파일이다. 열쇠를 안 남기려고
// 잠금장치까지 붙여 놓고 오류 한 줄로 평문으로 흘리는 셈이다.
//
// 그 갈래가 죽으면 아무도 모른다. 사람은 오류를 읽고, 보고서를 남에게
// 보내고, 그 안에 열쇠가 있다. 그래서 이 파일에서 제일 앞에 잰다.
//
// ── 2. 붙지도 못한 것과 답을 안 준 것 ───────────────────────────────────
//
// 이 둘은 사람이 볼 자리가 다르고(망·프록시 대 게이트웨이), **다시 불러도
// 되는지도** 다르다 (backend/retry.js 의 못붙은코드).
//
//   못 붙음   보낸 게 없다 → 다시 불러도 안전하다
//   시간 초과 서버가 받아 놓고 답을 안 했다 → 다시 부르면 두 번 시킨 것이다
//
// 갈래 차례가 한 칸만 어긋나도 못 붙은 것이 「시간 초과」 로 읽힌다. 그러면
// 다시 부르면 될 것을 안 부르거나, 그 반대로 두 번 시킨다.
import { normalizeError, 막힘힌트, 프록시힌트 } from '../src/backend/http.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 오류 = (message, 더 = {}) => Object.assign(new Error(message), 더);

// ── 1. 열쇠를 화면에도 보고서에도 안 남긴다 ─────────────────────────────
trace('1-열쇠');
{
  const 진짜열쇠 = 'sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF';
  /*
   * 런타임이 실제로 내는 두 문장이다. 짐작으로 지어내면 안 된다 — 여태 한
   * 문장만 잡다가 다른 문장에서 새는 것이 이 갈래가 두 무늬를 다 보는 까닭이다.
   */
  const 새는것들 = [
    ['줄바꿈이 섞였을 때', `Headers.append: "${진짜열쇠}\\n" is an invalid header value.`],
    ['NUL 이 섞였을 때', `Headers.append: "${진짜열쇠}" is an invalid header value.`],
    ['헤더 이름이 잘못됐을 때', `Headers.append: "x-key" is an invalid header name.`],
    ['한글이 섞였을 때',
      `Cannot convert argument to a ByteString because the character at index 23 has a value of 54620`],
  ];
  for (const [이름, 글] of 새는것들) {
    const 말 = normalizeError(오류(글));
    check(`★★★ ${이름} — 원문을 그대로 안 내보낸다`, 말 !== 글, 말.slice(0, 50));
    check(`★★★ ${이름} — 열쇠가 한 조각도 안 남는다`,
      !말.includes(진짜열쇠) && !말.includes('sk-ant'), 말.slice(0, 60));
  }
  const 말 = normalizeError(오류(`Headers.append: "${진짜열쇠}" is an invalid header value.`));
  check('★★★ 대신 무엇을 고쳐야 하는지 말해 준다', /열쇠|한글|따옴표/.test(말), 말.slice(0, 60));
}

// ── 2. 못 붙은 것과 답이 없는 것을 가른다 ───────────────────────────────
trace('2-못붙음대시간초과');
{
  /*
   * 못 붙음 갈래는 시간 초과 갈래보다 **먼저** 와야 한다. 못 붙은 오류의 글에도
   * 흔히 "timeout" 이 들어 있어서, 차례가 뒤바뀌면 못 붙은 것이 전부 「응답이
   * 없습니다」 로 읽힌다. 그 순간 이 두 갈래를 가른 일이 통째로 무의미해진다.
   */
  const 못붙음 = normalizeError(오류('Connect Timeout Error', { code: 'CONNECT_TIMEOUT' }));
  check('★★★ 못 붙은 것은 「연결하지 못했습니다」', /연결하지 못했습니다/.test(못붙음), 못붙음);
  check('★★★ 못 붙었을 때 볼 곳은 망·프록시라고 짚어 준다', /망|프록시/.test(못붙음), 못붙음);

  const undici = normalizeError(oops());
  function oops() { return 오류('Connect Timeout Error', { code: 'UND_ERR_CONNECT_TIMEOUT' }); }
  check('★★★ undici 이름으로 와도 같게 읽는다 — 두 길이 같은 말을 해야 한다',
    undici === 못붙음, undici);

  const 시간초과 = normalizeError(오류('The operation timed out', { name: 'TimeoutError' }));
  check('★★★ 답을 안 준 것은 「응답이 없습니다」', /응답이 없습니다/.test(시간초과), 시간초과);
  check('★★★ 그리고 그 둘은 서로 다른 말이다 — 같아지면 가른 뜻이 없다',
    시간초과 !== 못붙음, `${시간초과} / ${못붙음}`);

  /*
   * 여기가 차례를 못 박는 자리다. 글에 "timeout" 이 들어 있는데 코드는 못 붙음이다.
   * 시간 초과 갈래가 먼저 오면 이 줄이 빨개진다.
   */
  const 섞인것 = normalizeError(오류('Connect Timeout Error: timeout after 10000ms', { code: 'CONNECT_TIMEOUT' }));
  check('★★★ 글에 timeout 이 있어도 코드가 못 붙음이면 못 붙음이다',
    /연결하지 못했습니다/.test(섞인것), 섞인것);
}

// ── 3. 나머지 갈래도 다 걸린다 ──────────────────────────────────────────
trace('3-나머지');
{
  /*
   * 하나라도 안 걸리면 그 자리만 영어 원문이 나간다. 화면은 안 깨지니
   * 아무도 신고하지 않고, 그 사람은 무엇을 고쳐야 하는지 모른 채로 남는다.
   */
  const 판 = [
    ['DNS', 오류('getaddrinfo ENOTFOUND gw.example', { code: 'ENOTFOUND' }), /주소를 찾을 수 없습니다/],
    ['DNS 일시 실패', 오류('getaddrinfo EAI_AGAIN gw', { code: 'EAI_AGAIN' }), /주소를 찾을 수 없습니다/],
    ['거부', 오류('connect ECONNREFUSED 127.0.0.1:11434', { code: 'ECONNREFUSED' }), /거부/],
    ['서버가 끊음', 오류('socket hang up', { code: 'ECONNRESET' }), /서버가 연결을 끊었습니다/],
    ['상대가 닫음', 오류('other side closed', { code: 'UND_ERR_SOCKET' }), /서버가 연결을 끊었습니다/],
    ['인증서', 오류('self signed certificate in certificate chain'), /인증서 문제/],
    ['인증서 코드로만', 오류('handshake failed', { code: 'SELF_SIGNED_CERT_IN_CHAIN' }), /인증서 문제/],
    ['맨 fetch 실패', 오류('fetch failed'), /연결 실패/],
    ['흐름이 멎음', 오류('60초 동안 조용합니다', { code: 'STALL' }), /잠잠/],
  ];
  for (const [이름, err, 바라는것] of 판) {
    const 말 = normalizeError(err);
    check(`★★★ ${이름} — 사람 말로 갈아 끼운다`, 바라는것.test(말), 말.slice(0, 70));
  }

  // 서버가 끊은 것과 서버가 꺼진 것은 다른 말이어야 한다. 「주소를 확인하라」 는
  // 서버가 받아 놓고 끊은 자리에서는 틀린 조언이고, 사람을 엉뚱한 데로 보낸다.
  check('★★★ 「끊었다」 와 「거부했다」 는 다른 말이다',
    normalizeError(오류('socket hang up', { code: 'ECONNRESET' }))
    !== normalizeError(오류('x', { code: 'ECONNREFUSED' })), '');
}

// ── 4. 프록시를 탓할 자리와 아닌 자리 ───────────────────────────────────
trace('4-프록시');
{
  /*
   * 프록시까지 못 간 것은 게이트웨이 탓이 아니다. **어느 프록시였는지** 적어야
   * 사람이 고친다 — 사내망에는 프록시가 여러 개다.
   */
  const 말 = normalizeError(오류('connect ECONNREFUSED', { code: 'ECONNREFUSED', 프록시: 'http://proxy.corp:3128' }));
  check('★★★ 프록시를 못 지났으면 그 프록시 주소를 적는다',
    말.includes('proxy.corp:3128'), 말.slice(0, 80));

  // 프록시가 **답을 준** 것은 다르다. 그건 그 답을 그대로 보여 줘야 한다.
  const 답준것 = normalizeError(오류('407 Proxy Authentication Required', { code: 'PROXY_CONNECT', 프록시: 'http://p:1' }));
  check('★★★ 프록시가 답을 준 것은 그 답을 그대로 보여 준다',
    답준것 === '407 Proxy Authentication Required', 답준것);
}

// ── 5. 한도 이야기를 알아본다 ───────────────────────────────────────────
trace('5-막힘힌트');
{
  /*
   * 429 는 까닭이 여럿이고 사람이 할 일이 저마다 다르다. 특히 가드레일은
   * **딴 API 의 딴 한도**라, RPM·TPM 을 아무리 올려도 안 낫는다. 그걸 안 짚어
   * 주면 사람은 콘솔에서 한도를 올리고 또 막힌다.
   */
  const 가드레일 = 막힘힌트('ApplyGuardrail: rate exceeded for text units per second');
  check('★★★ 가드레일 한도를 따로 짚어 준다', !!가드레일, String(가드레일));
  const 분당 = 막힘힌트('Rate limit reached: requests per minute');
  check('★★★ 분당 한도도 짚어 준다', !!분당, String(분당));
  check('★★★ 그 둘은 다른 말이다 — 할 일이 다르다', 가드레일 !== 분당, '');
  check('★★ 모르는 429 에는 억지로 말을 안 붙인다',
    막힘힌트('Too many requests') === null, String(막힘힌트('Too many requests')));
  check('★★ 빈 글에도 안 터진다', 막힘힌트('') === null && 막힘힌트(null) === null, '');

  /*
   * 프록시힌트 는 「프록시가 **바깥 명령을 돌리다** 실패했다」 를 알아보는 것이다.
   * 사내 게이트웨이가 매번 토큰을 받아 오는 그 명령이다. 그 글을 그대로 뱉으면
   * 사람은 모델이나 deel 을 의심하는데, 실제로는 **그 PC 의 로그인이 만료된**
   * 것이다 — 화면만 보고는 알 길이 없다.
   */
  const 로그인만료 = 프록시힌트(
    "[PROXY ERROR] Command '['databricks', 'auth', 'token', '--host',"
    + " 'dbc-1234.cloud.databricks.com', '--profile', 'work', '-o', 'json']'"
    + ' returned non-zero exit status 1.');
  check('★★★ 프록시가 토큰을 못 받은 것을 알아본다', !!로그인만료, String(로그인만료).slice(0, 50));
  check('★★★ 다시 로그인할 명령까지 지어 준다 — 이게 없으면 알아본 뜻이 없다',
    /databricks auth login/.test(로그인만료 ?? ''), String(로그인만료).slice(0, 120));
  check('★★★ 어느 호스트·프로필인지 짚어 준다 (사내엔 여러 개다)',
    /dbc-1234\.cloud\.databricks\.com/.test(로그인만료 ?? '') && /work/.test(로그인만료 ?? ''),
    String(로그인만료).slice(-70));

  // 모르는 도구여도 「프록시 쪽 문제」 라는 것만은 짚어 준다.
  const 모르는것 = 프록시힌트("Command '['kinit', '-k']' returned non-zero exit status 2.");
  check('★★ 모르는 도구여도 프록시 쪽 문제라고는 말해 준다',
    /kinit/.test(모르는것 ?? '') && /프록시/.test(모르는것 ?? ''), String(모르는것).slice(0, 70));

  check('★★★ 아무 글에나 프록시 탓을 안 한다',
    프록시힌트('internal server error') === null
    && 프록시힌트('Proxy Authentication Required') === null, '');
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n오류 말 검사  ${D}(원문을 그대로 내보내는 것이 제일 나쁜 답이다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

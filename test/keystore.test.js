// 게이트웨이 열쇠를 어디에 어떻게 두나.
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────
//
// 여태 열쇠는 `~/.deel/config.json` 에 글자 그대로 있었다. 저장할 때 chmod 600
// 을 걸었지만 NTFS 에서는 아무 일도 안 한다 — 즉 "본인만 읽게 잠갔다" 는 우리
// 말이 윈도우에서 사실이 아니었다. 사내 심사에서 제일 먼저 나오는 질문이
// "열쇠는 어디에 어떻게 보관됩니까" 이고, 그 답이 "홈 폴더에 평문" 이면 끝난다.
//
// 그래서 여기서 재는 것은 네 가지다.
//   1) 진짜 DPAPI 로 잠그고 풀 수 있나 (이 PC 에서 실제로 돌린다)
//   2) 평문으로 있던 설정이 **파일에서** 사라지고, 그래도 열쇠는 쓸 수 있나
//   3) 열쇠가 명령줄에 안 올라가나 (프로세스 목록으로 남이 보면 안 된다)
//   4) 못 풀 때 사람이 읽을 말을 주나 — 401 만 보여 주면 게이트웨이를 의심한다
//
// 검사는 진짜 설정을 안 건드린다. DEEL_HOME 을 임시 폴더로 돌려놓고 시작한다.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from './trace.mjs';

// 진짜 설정을 안 건드리게 **불러오기 전에** 자리부터 옮긴다.
const 집 = mkdtempSync(join(tmpdir(), 'deel-keystore-'));
process.env.DEEL_HOME = 집;
delete process.env.DEEL_API_KEY;
delete process.env.DEEL_KEYSTORE;

/*
 * ── 맥에서 이 검사가 사람의 진짜 열쇠를 덮어썼다 ────────────────────────
 *
 * DEEL_HOME 을 임시 폴더로 돌려놔도 키체인은 안 따라온다 — 키체인 이름이
 * 코드에 박힌 한 개였기 때문이다. 그래서 맥에서 이 파일을 돌리면 아래 잠그기가
 * `deel-gateway-key` 를 **진짜로 덮어썼고**, 잠금지우기 검사가 그걸 **지웠다.**
 * 검사 한 번에 사용자가 쓰던 게이트웨이 열쇠가 없어진다. 다음에 deel 을 켜면
 * 401 만 뜨고, 왜인지는 아무 데도 안 적힌다.
 *
 * 그래서 검사는 제 이름을 주고 쓴다. 기본 이름은 **한 번도 안 건드린다.**
 * (윈도우 DPAPI 는 잠근 덩이가 설정 파일 안에 있어서 이 이름과 상관없다.)
 */
process.env.DEEL_KEYCHAIN_NAME = `deel-검사-${process.pid}-${Date.now()}`;

const { 잠그기, 풀기, 잠긴것인가, 쓸수있나, 보관방식, 마지막명령줄, 잠금지우기, 키체인이름, 기본키체인이름 } = await import('../src/safety/keystore.js');
const { load, save, resolveKey, 잠금소식, 열쇠탈소식, 열쇠보관, configPath } = await import('../src/config.js');
const { 열쇠명세 } = await import('../src/pack/sbom.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 열쇠 = 'sk-비밀열쇠-1234-"따옴표"-$(rm -rf /)-%PATH%';

// ── 0. 이 검사는 사람의 열쇠를 안 건드린다 ─────────────────────────────
trace('0-제이름으로');
check('★ 검사는 기본 키체인 이름을 안 쓴다 (사람의 열쇠를 덮어쓰면 안 된다)',
  키체인이름() !== 기본키체인이름 && 키체인이름().startsWith('deel-검사-'), 키체인이름());
check('기본 이름은 그대로다 (이미 넣어 둔 열쇠를 계속 찾아야 한다)',
  기본키체인이름 === 'deel-gateway-key', 기본키체인이름);

// ── 1. 이 PC 에서 무엇이 되나 ──────────────────────────────────────────
trace('1-쓸수있나');
const 잠금장치 = 쓸수있나();
check('이 PC 에서 무엇으로 잠글 수 있는지 말한다', typeof 잠금장치.되나 === 'boolean' && !!잠금장치.방식,
  JSON.stringify(잠금장치));
check('잠금장치가 있으면 방식 이름이 os 에 맞는다',
  !잠금장치.되나
  || (process.platform === 'win32' && 잠금장치.방식 === 'dpapi')
  || (process.platform === 'darwin' && 잠금장치.방식 === 'keychain'),
  `${process.platform} → ${잠금장치.방식}`);
check('못 쓰면 왜인지 적는다', 잠금장치.되나 || !!잠금장치.왜, 잠금장치.왜);

// ── 2. 잠그고 풀기 ─────────────────────────────────────────────────────
trace('2-왕복');
if (!잠금장치.되나) {
  console.log(`\n  ⚠ 이 PC 에는 잠금장치가 없어(${잠금장치.왜}) 왕복 검사를 건너뜁니다.\n`);
  check('잠금장치가 없으면 파일 권한이라고 말한다', /0600|파일/.test(보관방식(null)), 보관방식(null));
} else {
  const t0 = Date.now();
  const 잠근것 = 잠그기(열쇠);
  const 잠근시간 = Date.now() - t0;
  check('잠근 값이 나온다', typeof 잠근것 === 'string' && 잠근것.length > 20, String(잠근것).slice(0, 30));
  check('꼴이 정해진 대로다 (dpapi: 또는 keychain:)', /^(dpapi|keychain):/.test(잠근것 ?? ''), (잠근것 ?? '').slice(0, 10));
  check('잠긴 것을 잠긴 것으로 알아본다', 잠긴것인가(잠근것) && !잠긴것인가(열쇠) && !잠긴것인가('') && !잠긴것인가(null));
  check('잠근 값에 열쇠 글자가 안 남는다', !String(잠근것).includes('sk-비밀열쇠'), String(잠근것).slice(0, 40));

  const t1 = Date.now();
  const 푼것 = 풀기(잠근것);
  const 푼시간 = Date.now() - t1;
  check('푼 것이 원래 열쇠와 한 글자도 안 다르다', 푼것.ok && 푼것.text === 열쇠, JSON.stringify(푼것.text ?? 푼것.why));
  check(`잠그기 ${잠근시간}ms · 풀기 ${푼시간}ms — 한 판에 한 번이면 참을 만하다`, 잠근시간 < 5000 && 푼시간 < 5000, `${잠근시간}/${푼시간}ms`);

  // 같은 열쇠를 두 번 잠가도 값이 다르다 (DPAPI 가 매번 다른 엔트로피를 쓴다).
  const 또 = 잠그기(열쇠);
  check('두 번 잠근 값이 서로 다르다 (같은 글자여도)', 또 !== 잠근것 && 풀기(또).text === 열쇠);

  const 망친것 = 풀기('dpapi:AAAAnot-a-real-blob');
  check('못 푸는 값에는 사람이 읽을 까닭을 준다', !망친것.ok && /다시 넣으세요|못 풉니다|못 읽/.test(망친것.why), 망친것.why);
  check('잠긴 것이 아니면 그렇게 말한다', 풀기('sk-그냥평문').why === '잠긴 열쇠가 아닙니다');
}

// ── 3. 열쇠는 명령줄에 안 올린다 ──────────────────────────────────────
trace('3-명령줄');
if (잠금장치.되나) {
  잠그기(열쇠);
  const 인자 = 마지막명령줄() ?? [];
  const 통째로 = 인자.join(' ');
  check('실제로 넘긴 명령줄에 열쇠가 없다', !통째로.includes(열쇠) && !통째로.includes('sk-비밀열쇠'), 통째로.slice(0, 60) + '…');
  // -EncodedCommand 안에 숨어 있지도 않은지 풀어서 본다.
  const 인코딩 = 인자[인자.indexOf('-EncodedCommand') + 1];
  const 푼스크립트 = 인코딩 ? Buffer.from(인코딩, 'base64').toString('utf16le') : '';
  check('EncodedCommand 안에도 열쇠가 없다', !푼스크립트.includes('sk-비밀열쇠'), 푼스크립트.split('\n').filter(Boolean)[1] ?? '');
  check('스크립트는 stdin 을 읽는 꼴이다', /Console\]::In\.ReadToEnd/.test(푼스크립트) || process.platform !== 'win32');
  // 열쇠가 base64 로만 오간다는 것도 못 박는다 — 콘솔 인코딩이 무엇이든 안 상한다.
  check('열쇠를 base64 로만 넘긴다', /FromBase64String/.test(푼스크립트) || process.platform !== 'win32');
}

// ── 4. 옮겨 담기 — 평문 설정이 저절로 잠긴다 ──────────────────────────
trace('4-옮기기');
{
  const 설정 = { version: 1, active: 'gw', profiles: [{ id: 'gw', name: '사내 게이트웨이', kind: 'openai', baseUrl: 'https://gw.example.invalid/v1', auth: 'bearer', apiKey: 열쇠, model: 'gpt-x' }] };
  mkdirSync(집, { recursive: true });
  writeFileSync(join(집, 'config.json'), JSON.stringify(설정, null, 2), 'utf8');

  const cfg = load();                      // 여기서 옮겨진다
  const 파일 = readFileSync(join(집, 'config.json'), 'utf8');

  if (잠금장치.되나) {
    check('옮긴 뒤 파일에 열쇠 글자가 없다', !파일.includes('sk-비밀열쇠'), 파일.slice(0, 120).replace(/\n/g, ' '));
    check('파일에는 잠긴 꼴이 들어 있다', /"apiKey":\s*"(dpapi|keychain):/.test(파일), (파일.match(/"apiKey":\s*"[^"]{0,24}/) ?? [''])[0]);
    check('그래도 열쇠는 그대로 나온다', resolveKey(cfg.profiles[0]) === 열쇠, resolveKey(cfg.profiles[0]).slice(0, 12) + '…');
    const 소식 = 잠금소식();
    check('옮겼다고 한 줄로 알린다', /잠갔습니다/.test(String(소식)), String(소식));
    check('한 번 알린 소식은 두 번 안 나온다', 잠금소식() === null);
    check('열쇠 보관 줄이 잠긴 상태를 말한다', /DPAPI|키체인/.test(열쇠보관(cfg)), 열쇠보관(cfg));
  } else {
    check('잠금장치가 없으면 파일을 안 건드린다', 파일.includes('sk-비밀열쇠'));
    check('그래도 열쇠는 그대로 나온다', resolveKey(cfg.profiles[0]) === 열쇠);
  }

  // 저장하는 길이 하나뿐이라, 새로 넣는 열쇠도 여기서 잠긴다.
  const 새것 = { version: 1, active: 'p2', profiles: [{ id: 'p2', apiKey: 'sk-새로넣은열쇠', auth: 'bearer' }] };
  save(새것);
  const 새파일 = readFileSync(join(집, 'config.json'), 'utf8');
  if (잠금장치.되나) {
    check('새로 저장하는 열쇠도 잠겨서 들어간다', !새파일.includes('sk-새로넣은열쇠'), 새파일.slice(0, 100).replace(/\n/g, ' '));
    check('저장한 뒤에도 읽어 쓸 수 있다', resolveKey(새것.profiles[0]) === 'sk-새로넣은열쇠');
  }
}

// ── 5. 환경변수가 파일보다 세다 ────────────────────────────────────────
trace('5-환경변수');
{
  const 잠근것 = 잠금장치.되나 ? 잠그기('sk-파일에있는것') : 'sk-파일에있는것';
  const 프로필 = { id: 'gw', apiKey: 잠근것 };
  process.env.DEEL_API_KEY = 'sk-환경변수것';
  check('DEEL_API_KEY 가 파일을 이긴다', resolveKey(프로필) === 'sk-환경변수것', resolveKey(프로필));
  process.env.DEEL_KEY_GW = 'sk-이연결만';
  check('프로필별 환경변수가 제일 세다', resolveKey(프로필) === 'sk-이연결만', resolveKey(프로필));
  delete process.env.DEEL_KEY_GW;
  delete process.env.DEEL_API_KEY;
  if (잠금장치.되나) check('환경변수를 지우면 다시 파일 것을 푼다', resolveKey(프로필) === 'sk-파일에있는것', resolveKey(프로필));
}

// ── 6. 끄는 길이 있다 ──────────────────────────────────────────────────
trace('6-끄기');
{
  process.env.DEEL_KEYSTORE = 'off';
  const 설정 = { version: 1, active: 'p3', profiles: [{ id: 'p3', apiKey: 'sk-안잠글것' }] };
  save(설정);
  const 파일 = readFileSync(join(집, 'config.json'), 'utf8');
  check('DEEL_KEYSTORE=off 면 안 잠근다', 파일.includes('sk-안잠글것'), 파일.slice(0, 80).replace(/\n/g, ' '));
  check('끈 상태를 그대로 말한다 (잠글 것처럼 말하지 않는다)',
    /꺼 두었습니다/.test(보관방식('sk-안잠글것')) && !/다음 저장 때/.test(보관방식('sk-안잠글것')), 보관방식('sk-안잠글것'));
  delete process.env.DEEL_KEYSTORE;
}

// ── 7. 심사서에 열쇠 보관 항목이 있다 ─────────────────────────────────
trace('7-심사서');
{
  const 명세 = 열쇠명세();
  check('심사서에 어디에 두는지 적힌다', /config\.json/.test(명세.어디), 명세.어디);
  check('운영체제별 방식이 셋 다 적힌다', 명세.방식.length === 3 && 명세.방식.some((x) => /DPAPI/.test(x.방법)) && 명세.방식.some((x) => /키체인/.test(x.방법)) && 명세.방식.some((x) => /0600/.test(x.방법)));
  check('명령줄에 안 올린다고 못 박는다', /stdin/.test(명세.넘길때), 명세.넘길때);
  check('안 쓰는 길(환경변수)도 적는다', /DEEL_API_KEY/.test(명세.안쓰려면));
  check('이 PC 에서 실제로 무엇인지도 적는다', typeof 명세.이PC에서 === 'string' && 명세.이PC에서.length > 3, 명세.이PC에서);
  check('설정 자리를 엉뚱한 데로 옮기지 않았다', configPath().startsWith(집), configPath());
}

trace('잠금지우기');

/*
 * ── 잠금장치에서 지우기 (`deel reset model` 이 부른다) ──────────────────
 *
 * 설정 파일만 지우면 잠금장치에는 열쇠가 그대로 남는다. 화면에는
 * 「초기화했습니다」 가 뜨는데 열쇠는 살아 있는 상태다.
 *
 * 여기서 제일 조심할 것은 **안 한 일을 했다고 말하는 것**이다. 윈도우는
 * 잠근 덩이가 설정 파일 안에 있어서 잠금장치에 따로 지울 것이 없다.
 * 그때 「지웠습니다」 라고 답하면, 파일이 안 지워진 경우에도 사람은
 * 열쇠가 없어진 줄 안다.
 */
{
  const d = 잠금지우기('dpapi:QUFB');
  check('DPAPI 는 따로 지울 것이 없다고 말한다', d.방식 === 'dpapi' && d.지움 === false, JSON.stringify(d));
  check('★ 안 한 일을 했다고 안 한다', d.지움 === false && /설정 파일 안에/.test(d.왜), d.왜);

  const 없음 = 잠금지우기('sk-평문열쇠');
  check('평문 열쇠는 잠금장치에 따로 없다고 말한다',
    없음.지움 === false && /없습니다|설정 파일 안에/.test(없음.왜), JSON.stringify(없음));

  const k = 잠금지우기(`keychain:${키체인이름()}`);
  if (process.platform === 'darwin') {
    check('맥에서는 키체인을 실제로 손댄다', k.방식 === 'keychain', JSON.stringify(k));
    check('없는 것을 지우라 해도 탈로 안 친다', !/실패/.test(k.왜), k.왜);
  } else {
    check('★ 맥 열쇠를 맥이 아닌 데서 지웠다고 하지 않는다',
      k.지움 === false && /맥에서/.test(k.왜), JSON.stringify(k));
  }

  // 지울 때도 열쇠를 명령줄에 안 올린다. 넘기는 것은 이름뿐이다.
  const 줄 = (마지막명령줄() ?? []).join(' ');
  check('★ 지울 때도 명령줄에 열쇠가 없다',
    !줄.includes('QUFB') && !줄.includes('sk-평문열쇠'), 줄.slice(0, 90));
}

/*
 * ── 못 푼 까닭이 사람에게 닿는가 ────────────────────────────────────────
 *
 * 못 풀 때가 진짜 있다 — 설정 파일만 다른 PC 로 옮겼거나, 계정을 바꿨거나,
 * 윈도우 프로필을 다시 만든 경우다. 풀기() 는 그때 왜인지를 성실하게 만들어
 * 돌려주고, 그 머리말에 까닭까지 적어 뒀다: **빈 글자만 돌려주면 사람은 401 만
 * 보고 게이트웨이를 의심한다.**
 *
 * 그런데 유일한 부르는 쪽인 resolveKey 가 그 말을 버리고 있었다. 빈 열쇠가
 * 나가면 http.js 는 Authorization 머리말을 아예 안 붙인다. 사람은 방화벽·주소·
 * 계정을 뒤진다. 진짜 까닭은 우리만 알고 있었다.
 *
 * 게다가 그 실패를 **담아 뒀다.** 그러면 사람이 그 사이에 deel setup 으로 열쇠를
 * 다시 넣어도 그 판에서는 영영 안 풀린다.
 */
trace('9-못푼까닭');
{
  // 이 PC 것이 아닌 잠긴 값. 어느 판에서든 못 푼다.
  const 남의것 = process.platform === 'darwin'
    ? 'dpapi:AQAAANCMnd8BFdERjHoAwE/Cl+sBAAAA남의PC에서잠근것'
    : `keychain:${키체인이름()}`;
  const 프로필 = { id: '남의것', apiKey: 남의것 };

  열쇠탈소식();   // 앞엣것을 비우고 시작한다
  const 푼것 = resolveKey(프로필);
  check('못 푸는 열쇠는 빈 글자로 나간다 (틀린 열쇠를 보내지 않는다)', 푼것 === '', JSON.stringify(푼것));

  const 탈 = 열쇠탈소식();
  check('★ 왜 못 풀었는지가 화면으로 갈 자리에 남는다', typeof 탈 === 'string' && 탈.length > 0, String(탈));
  check('★ 그 말이 무엇을 하라는지까지 담고 있다', /deel setup|PC|키체인|윈도우/.test(탈 ?? ''), String(탈));
  check('한 번 읽으면 지워진다 (두 번 안 알린다)', 열쇠탈소식() === null);

  /*
   * ★ 실패는 담아 두지 않는다.
   *
   * 담아 두면 그 판 내내 다시 시도조차 안 한다. 두 번째로 불러도 똑같이
   * 까닭이 나와야 한다 — 나온다는 것은 실제로 다시 풀어 봤다는 뜻이다.
   */
  resolveKey(프로필);
  check('★ 실패를 담아 두지 않는다 (다시 넣으면 그 판에서 바로 풀리게)',
    typeof 열쇠탈소식() === 'string');

  // 멀쩡한 열쇠는 조용해야 한다 — 없는 탈을 만들어 내면 안 된다.
  열쇠탈소식();
  resolveKey({ id: '평문', apiKey: 'sk-그냥평문' });
  check('멀쩡한 열쇠에는 아무 말도 안 남긴다', 열쇠탈소식() === null);
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n열쇠 보관 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? D + '  ' + p.note + X : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
rmSync(집, { recursive: true, force: true });
// 제가 넣은 것은 제가 거둔다. 안 지우면 검사를 돌릴 때마다 키체인에 찌꺼기가 쌓인다.
if (process.platform === 'darwin') { try { 잠금지우기(`keychain:${키체인이름()}`); } catch { /* 이미 없다 */ } }
process.exitCode = fail.length ? 1 : 0;

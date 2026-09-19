// `deel doctor` 와 `deel config explain` — 붙기 전에 무엇이 막고 있나.
//
// ── 이 둘이 지키는 것 ──────────────────────────────────────────────────
//
// 사내에서 막히는 자리는 대개 모델 앞이다 — 프록시, 사내 루트, 열쇠, 인증서,
// 그리고 「믿지 않는 폴더의 프로젝트 설정」. 그때 사람이 받는 것은 한 줄짜리
// 실패 메시지이고, 그 한 줄로는 여섯 가지 원인 중 어느 것인지 알 수가 없다.
//
// 그래서 이 검사가 특히 못 박는 것은 **가르는 것**이다.
//   · 닿았는데 401 인 것과 아예 못 닿은 것은 다른 말이어야 한다.
//     (앞은 열쇠를 보고, 뒤는 프록시·방화벽을 본다)
//   · 모델 이름이 목록에 없는 것과 서버가 목록을 안 주는 것은 다른 말이어야 한다.
//   · 「적어 놨는데 안 먹는다」 는 대개 **읽지도 않은 파일**이다. 그걸 말해 준다.
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 진찰 } from '../src/doctor.js';
import { 설명, 설명줄들 } from '../src/configexplain.js';
import { 인증서잊기 } from '../src/backend/clientcert.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 찾기 = (줄들, 이름) => 줄들.find((x) => x.이름 === 이름) ?? null;

// ── 스텁 게이트웨이 ────────────────────────────────────────────────────
let 갈래 = 'ok';
const srv = createServer((req, res) => {
  req.resume();
  if (갈래 === '401') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"no"}'); }
  if (갈래 === '목록없음') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{}'); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: [{ id: '스텁모델' }, { id: '스텁모델-mini' }] }));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/v1`;
resetNet();
allowEndpoint(base);

const 일터 = mkdtempSync(join(tmpdir(), 'deel-doctor-'));

// ── 1. 닿는다 ──────────────────────────────────────────────────────────
trace('1-닿음');
{
  갈래 = 'ok';
  const { 줄들 } = await 진찰({
    prof: { name: '검사', baseUrl: base, model: '스텁모델', auth: 'none' },
    root: 일터, 열쇠: '', 바깥가도되나: true,
  });
  check('★ 닿으면 닿았다고 한다', 찾기(줄들, '도달')?.상태 === 'ok', JSON.stringify(찾기(줄들, '도달')));
  check('★★ 모델이 목록에 있는지까지 본다', 찾기(줄들, '모델')?.상태 === 'ok', JSON.stringify(찾기(줄들, '모델')));
  check('프록시를 안 거치면 그렇게 적는다', /직접/.test(찾기(줄들, '프록시')?.값 ?? ''), 찾기(줄들, '프록시')?.값);
}

// ── 2. 모델 이름이 한 글자 틀렸을 때 ───────────────────────────────────
trace('2-모델이름');
{
  /*
   * 붙기는 되는데 모델 이름이 틀린 자리가 아주 흔하다. 그때 서버가 주는 것은
   * 404 나 400 이고, 그 화면은 「주소가 틀렸다」 와 구별이 안 된다. 여기서
   * 갈라 주면 사람은 주소가 아니라 이름을 본다.
   */
  갈래 = 'ok';
  const { 줄들 } = await 진찰({
    prof: { name: '검사', baseUrl: base, model: '스텁모델-turbo', auth: 'none' },
    root: 일터, 열쇠: '', 바깥가도되나: true,
  });
  const 모델 = 찾기(줄들, '모델');
  check('★★ 목록에 없으면 없다고 한다', 모델?.상태 === 'no', JSON.stringify(모델));
  check('★ 비슷한 이름을 같이 보여 준다', /스텁모델/.test(모델?.덧말 ?? ''), 모델?.덧말 ?? '');
}

// ── 2.5 주소가 틀렸을 때 ───────────────────────────────────────────────
trace('2.5-주소틀림');
{
  /*
   * 손으로 고친 프로필의 baseUrl 이 비었거나(`http://`) 빈칸이 들었으면, 부르는 쪽(bin/deel.js)은
   * 자물쇠에 이 주소를 못 올리고 「두드려도 되나」 가 거짓이 된다. 여기는 주소를 안 보고 ✓ 를
   * 찍었고, 도달 줄에는 「자물쇠가 걸려 있거나 --offline」 이라고 적었다 — 둘 다 아니다.
   * ✗ 가 하나도 없으니 종료코드도 0 이었다. 담당자에게 보낼 한 장이 멀쩡하다고 말한 것이다.
   */
  /*
   * 슬래시가 셋인 주소(`http:///v1`)가 여기를 그냥 지나갔다.
   *
   * 「호스트가 없습니다」 줄이 `!u.hostname` 을 봤는데, http/https 는 호스트가 비면 위
   * `new URL` 이 먼저 던진다 — 13,500 조합을 다 재 봐도 그 줄에 걸리는 주소가 하나도
   * 없었다. 정작 진짜 위험한 꼴은 따로 있다: 슬래시가 셋이면 URL 파서가 **경로를
   * 호스트로 끌어올린다** (`http:///v1` → `http://v1/`). 사람은 호스트를 안 적었는데
   * 화면에는 ✓ 주소 가 찍히고, 실제로 두드리는 곳은 `v1` 이라는 엉뚱한 이름이 된다.
   */
  for (const [이름, baseUrl] of [['없음', undefined], ['http:// 만', 'http://'], ['빈칸 든 주소', 'http://local host:1/v1'], ['슬래시 셋', 'http:///v1']]) {
    const { 줄들 } = await 진찰({ prof: { name: '검사', baseUrl, model: 'm', auth: 'none' }, root: 일터, 열쇠: '', 바깥가도되나: false });
    const 주소 = 찾기(줄들, '주소');
    const 도달 = 찾기(줄들, '도달');
    check(`★★ 주소가 틀리면(${이름}) ✗ 로 적는다`, 주소?.상태 === 'no', JSON.stringify(주소));
    check(`★ 주소가 틀리면(${이름}) 자물쇠 탓을 안 한다`, !/자물쇠|offline/.test(`${도달?.값 ?? ''} ${도달?.덧말 ?? ''}`), JSON.stringify(도달));
  }
  const { 줄들 } = await 진찰({ prof: { name: '검사', baseUrl: base, model: 'm', auth: 'none' }, root: 일터, 열쇠: '', 바깥가도되나: false });
  check('맞는 주소는 여태 그대로 ✓ 다', 찾기(줄들, '주소')?.상태 === 'ok', JSON.stringify(찾기(줄들, '주소')));
}

// ── 3. 닿았는데 401 ────────────────────────────────────────────────────
trace('3-401');
{
  /*
   * 이 자리를 「못 닿았습니다」 로 묶으면 사람은 방화벽 담당자에게 간다.
   * 실제로 볼 것은 열쇠다. 도달과 인증은 반드시 따로 적어야 한다.
   */
  갈래 = '401';
  const { 줄들 } = await 진찰({
    prof: { name: '검사', baseUrl: base, model: '스텁모델', auth: 'bearer', apiKey: 'x' },
    root: 일터, 열쇠: 'x', 바깥가도되나: true,
  });
  check('★★ 401 이면 주소는 닿는다고 적는다', 찾기(줄들, '도달')?.상태 === 'ok', JSON.stringify(찾기(줄들, '도달')));
  check('★★ 인증은 따로 실패로 적는다', 찾기(줄들, '인증')?.상태 === 'no', JSON.stringify(찾기(줄들, '인증')));
}

// ── 4. 목록을 안 주는 서버 ─────────────────────────────────────────────
trace('4-목록없음');
{
  // 모르는 것을 '틀렸다' 로 적으면 멀쩡한 자리를 고치러 간다.
  갈래 = '목록없음';
  const { 줄들 } = await 진찰({
    prof: { name: '검사', baseUrl: base, model: '뭐든지', auth: 'none' },
    root: 일터, 열쇠: '', 바깥가도되나: true,
  });
  check('★ 목록을 안 주면 모른다고 적는다', 찾기(줄들, '모델 목록')?.상태 === 'unknown',
    JSON.stringify(찾기(줄들, '모델 목록')));
}

// ── 5. 열쇠와 인증서 ───────────────────────────────────────────────────
trace('5-열쇠-인증서');
{
  갈래 = 'ok';
  인증서잊기();
  const { 줄들 } = await 진찰({
    prof: {
      name: '검사', baseUrl: base, model: '스텁모델', auth: 'bearer',
      인증서: { cert: join(일터, '없는것.pem'), key: join(일터, '없는것.key') },
    },
    root: 일터, 열쇠: '', 바깥가도되나: true,
  });
  check('★★ 열쇠를 못 꺼내면 그렇게 적는다', 찾기(줄들, '열쇠')?.상태 === 'no', JSON.stringify(찾기(줄들, '열쇠')));
  const 인증 = 찾기(줄들, '내 인증서');
  check('★★ 인증서 파일이 없으면 그 자리에서 잡는다', 인증?.상태 === 'no', JSON.stringify(인증));
  check('★ 어느 파일인지 말한다', /없는것\.pem/.test(`${인증?.값} ${인증?.덧말}`), `${인증?.값} · ${인증?.덧말}`);
  /*
   * 인증서 암호가 화면에 새면 안 된다. 이 화면은 그대로 캡처되어 사내
   * 메신저로 간다 — 한 장으로 인증서가 통째로 새는 것과 같다.
   */
  인증서잊기();
  const { 줄들: 줄2 } = await 진찰({
    prof: {
      name: '검사', baseUrl: base, model: '스텁모델', auth: 'none',
      인증서: { cert: join(일터, 'x.pem'), key: join(일터, 'x.key'), passphrase: '진짜암호' },
    },
    root: 일터, 열쇠: '', 바깥가도되나: true,
  });
  check('★★ 인증서 암호는 화면에 안 나온다',
    !JSON.stringify(줄2).includes('진짜암호'), JSON.stringify(찾기(줄2, '내 인증서')));
  인증서잊기();
}

// ── 6. 안 두드려도 되는 자리 ───────────────────────────────────────────
trace('6-안두드림');
{
  // 진단한다고 자물쇠를 넘어가면 안 된다. 못 잰 것은 못 쟀다고 적는다.
  const { 줄들, 붙어봤나 } = await 진찰({
    prof: { name: '검사', baseUrl: base, model: '스텁모델', auth: 'none' },
    root: 일터, 열쇠: '', 바깥가도되나: false,
  });
  check('★★ 나가면 안 되는 자리에서는 안 두드린다', 붙어봤나 === false);
  check('★ 못 쟀다고 적는다 — 초록으로 세지 않는다', 찾기(줄들, '도달')?.상태 === 'unknown',
    JSON.stringify(찾기(줄들, '도달')));
}

trace('9-지어낸-결함을-안-만든다');

// ── 열쇠를 안 돌려 봤으면 401 을 결함이라고 부르지 않는다 ───────────────
//
// doctor.js:145 머리말이 이 이야기를 **이미** 적어 두었다 —
//   ✗ 열쇠   못 꺼냈습니다 …
//   ✗ 인증   401
//   「아무것도 안 망가진 상태다 … 지어낸 결함을 담당자에게 보내게 만들었다.」
// 그런데 고쳐진 것은 위 한 줄뿐이었다. 빈 열쇠로 두드린 401 이 그대로 `✗ 인증`
// 으로 남아 종료코드도 1 이 된다. SSO 프로필은 열쇠가 없는 것이 **정상**이다.
{
  갈래 = '401';
  const { 줄들 } = await 진찰({
    prof: { name: '사내', baseUrl: base, model: '스텁모델', auth: 'bearer', 열쇠받기: { 명령: 'get-key.cmd' } },
    root: 일터, 열쇠: '', 바깥가도되나: true,
  });
  check('열쇠는 안 돌려 봤다고 적는다', 찾기(줄들, '열쇠')?.상태 === 'unknown', JSON.stringify(찾기(줄들, '열쇠')));
  check('★★ 안 돌려 본 열쇠의 401 을 결함으로 안 적는다', 찾기(줄들, '인증')?.상태 === 'unknown',
    JSON.stringify(찾기(줄들, '인증')));
  check('주소는 닿았다고 그대로 적는다', 찾기(줄들, '도달')?.상태 === 'ok', JSON.stringify(찾기(줄들, '도달')));

  // 열쇠를 들고 있는 프로필은 여태처럼 결함이다 — 그건 진짜로 막힌 것이다.
  const { 줄들: 줄2 } = await 진찰({
    prof: { name: '검사', baseUrl: base, model: '스텁모델', auth: 'bearer' },
    root: 일터, 열쇠: 'x', 바깥가도되나: true,
  });
  check('열쇠를 들고 받은 401 은 그대로 결함이다', 찾기(줄2, '인증')?.상태 === 'no', 줄2.map((x)=>x.이름+':'+x.상태).join(' | '));
  갈래 = 'ok';
}

// ── 프록시 설정을 못 읽었으면 「직접 갑니다」 라고 단정하지 않는다 ───────
{
  const { 프록시정하기, 프록시지우기 } = await import('../src/backend/proxy.js');
  프록시정하기({ env: { HTTP_PROXY: 'socks5://안되는것:1080' } });
  const { 줄들 } = await 진찰({
    prof: { name: '검사', baseUrl: base, model: '스텁모델', auth: 'none' },
    root: 일터, 열쇠: '', 바깥가도되나: true,
  });
  const 프록줄들 = 줄들.filter((x) => x.이름 === '프록시');
  check('★ 못 읽었다고 말한다', 프록줄들.some((x) => x.상태 === 'warn'), JSON.stringify(프록줄들));
  check('★★ 못 읽고서 「안 거칩니다」 라고 단정하지 않는다',
    !프록줄들.some((x) => x.상태 === 'ok'), JSON.stringify(프록줄들));
  프록시지우기();

// ── 안 믿는 폴더에서는 「붙일 서버 N개」 가 초록이면 안 된다 ────────────
//
// 아래 한 줄이 「안 믿는 폴더라 하나도 안 띄웁니다」 라고 말해 주는데, 바로 위
// 요약 줄은 ✓ 로 「붙일 서버 1개」 라고 적었다. 한 화면 안에서 ✓ 와 「하나도 안
// 띄웁니다」 가 같이 보인다 — 「✓ 한번됨 … 아직 안 싣습니다」(work.js WK1) 와
// 같은 꼴이다. 진찰은 그 자리에서 판단을 끝내 주는 화면이라 더 그렇다.
{
  const mcp방 = mkdtempSync(join(tmpdir(), 'deel-doctor-mcp-'));
  mkdirSync(join(mcp방, '.deel'), { recursive: true });
  writeFileSync(join(mcp방, '.deel', 'mcp.json'),
    JSON.stringify({ mcpServers: { 하나: { command: 'echo', args: ['hi'] } } }), 'utf8');
  const { 줄들 } = await 진찰({
    prof: { name: '검사', baseUrl: base, model: '스텁모델', auth: 'none' },
    root: mcp방, 열쇠: '', 바깥가도되나: false,
  });
  check('★ 안 믿는 폴더의 MCP 요약은 초록이 아니다', 찾기(줄들, 'MCP')?.상태 === 'warn',
    JSON.stringify(찾기(줄들, 'MCP')));
  check('왜 안 뜨는지도 그대로 말한다',
    줄들.some((x) => /안 믿는 폴더라 하나도 안 띄웁니다/.test(x.값 ?? '')), '');
  rmSync(mcp방, { recursive: true, force: true });
}

// ── 7. 설정 값이 어디서 왔나 ───────────────────────────────────────────
trace('7-설명');
{
  const 집 = mkdtempSync(join(tmpdir(), 'deel-explain-home-'));
  const 방 = mkdtempSync(join(tmpdir(), 'deel-explain-work-'));
  const 옛집 = process.env.DEEL_HOME;
  const 옛정책 = process.env.DEEL_POLICY;
  process.env.DEEL_HOME = 집;
  delete process.env.DEEL_POLICY;

  writeFileSync(join(집, 'config.json'), JSON.stringify({
    offline: false,
    profiles: [{ name: '사내', model: '집에적은모델' }],
  }), 'utf8');
  mkdirSync(join(방, '.deel'), { recursive: true });
  writeFileSync(join(방, '.deel', 'config.json'), JSON.stringify({
    profiles: [{ name: '사내', model: '프로젝트에적은모델' }],
  }), 'utf8');

  {
    const r = 설명('profiles.사내.model', { root: 방, env: process.env });
    /*
     * 여기가 이 명령을 만든 까닭이다.
     *
     * 프로젝트 설정에 적어 뒀는데 그 폴더를 안 믿으면 **읽지도 않는다.**
     * 파일은 분명히 거기 있으므로, 말해 주지 않으면 사람은 그 파일만 고친다.
     */
    const 방층 = r.층들.find((x) => x.층 === '프로젝트 설정');
    check('★★ 안 믿는 폴더의 프로젝트 설정은 안 읽는다고 말한다',
      방층 && 방층.읽나 === false && /믿는 폴더/.test(방층.왜못읽나 ?? ''), JSON.stringify(방층));
    check('★★ 그래서 이긴 것은 이 PC 설정이다',
      r.이긴층?.층 === '이 PC 설정' && r.이긴층?.값 === '집에적은모델', JSON.stringify(r.이긴층));
  }

  {
    // 아무 데도 없는 칸은 없다고 한다. 0 이나 빈 값으로 지어내지 않는다.
    const r = 설명('없는칸', { root: 방, env: process.env });
    check('★ 아무 데도 안 적힌 칸은 이긴 층이 없다', r.이긴층 === null, JSON.stringify(r.이긴층));
  }

  {
    // 관리 정책은 설정을 이긴다. 그 사실이 화면에 보여야 한다.
    const 정책자리 = join(집, 'policy.json');
    writeFileSync(정책자리, JSON.stringify({ offline: true }), 'utf8');
    process.env.DEEL_POLICY = 정책자리;
    const r = 설명('offline', { root: 방, env: process.env });
    check('★★ 관리 정책이 이긴다', r.이긴층?.층 === '관리 정책' && r.이긴층?.값 === true,
      JSON.stringify(r.이긴층));
    check('★ 아래 층도 같이 보여 준다 — 무엇이 덮였는지 알아야 한다',
      r.층들.some((x) => x.층 === '이 PC 설정'), JSON.stringify(r.층들.map((x) => x.층)));

    /*
     * ── 물려받은 이름도 「없는 칸」 이다 ──────────────────────────────
     *
     * 정책이 깔린 채로 물어야 이 검사가 뜻이 있다. 정책 파일은 JSON 이라
     * `정책.값['constructor']` 가 **함수**로 참이 되고, 그러면 정책에 없는
     * 칸이 「관리 정책」 한 줄로 올라온다 — 관리자에게 따지러 갈 근거가
     * 통째로 거짓이 되는 자리다.
     *
     * 환경변수 표 쪽은 그보다 먼저 터졌다. 고치기 전 화면은 이랬다:
     *   deel config explain constructor
     *     오류 볼환경.filter is not a function
     */
    /*
     * 한 칸짜리 이름만 재면 **가운데 표**를 안 본다 (6회차 전수 어긋내기).
     *
     * `permissions.constructor` 는 정책의 allow·deny 만 모아 둔 새 표(`목록만`)에
     * 대고 묻는 길이다. 그 표도 `{}` 라 Object 의 것을 물려받아서, hasOwn 을 빼면
     * `constructor` 가 **함수**로 올라온다 — 정책에 없는 칸이 「관리 정책」 한 줄로
     * 뜬다. 위 한 칸짜리 길은 `끝칸 === 'baseUrl'` 같은 갈래에서 먼저 빠져나가
     * 그 표를 안 거치므로, 그 줄을 지워도 아무도 안 빨개졌다.
     */
    for (const 나쁜 of ['constructor', 'toString', 'valueOf',
      'permissions.constructor', 'permissions.toString', 'permissions.valueOf']) {
      let 터짐 = null;
      let r나쁜 = null;
      try { r나쁜 = 설명(나쁜, { root: 방, env: process.env }); } catch (e) { 터짐 = e; }
      check(`★ config explain ${나쁜} 이 안 터진다`, 터짐 === null,
        터짐 ? String(터짐.message) : '');
      check(`★ ${나쁜} 은 이긴 층이 없다`, !!r나쁜 && r나쁜.이긴층 === null,
        JSON.stringify(r나쁜?.이긴층));
      check(`★ ${나쁜} 에 관리 정책 층을 지어내지 않는다`,
        !!r나쁜 && !(r나쁜.층들 ?? []).some((x) => x.층 === '관리 정책'),
        (r나쁜?.층들 ?? []).map((x) => x.층).join(' · '));
    }

    delete process.env.DEEL_POLICY;
  }

  {
    // 환경변수가 파일을 이기고 있는 것을 모르면 파일만 백 번 고친다.
    process.env.DEEL_SHELL = 'bash';
    const r = 설명('shell', { root: 방, env: process.env });
    check('★★ 환경변수가 이기면 그렇게 보여 준다', r.이긴층?.층 === '환경변수', JSON.stringify(r.이긴층));
    delete process.env.DEEL_SHELL;
  }

  {
    // 열쇠는 값이 아니라 「적혀 있음」 만.
    writeFileSync(join(집, 'config.json'), JSON.stringify({
      profiles: [{ name: '사내', apiKey: 'sk-진짜열쇠-1234' }],
    }), 'utf8');
    const r = 설명('profiles.사내.apiKey', { root: 방, env: process.env });
    /*
     * 돌려주는 덩이 **전체**를 본다.
     *
     * 그리는 자리에서만 가리면 `--json` 이 날것을 그대로 낸다. 그 출력은
     * 파이프를 타고 로그로, 사내 티켓으로 간다.
     */
    check('★★ 열쇠 값은 돌려주는 덩이 어디에도 안 실린다',
      !JSON.stringify(r).includes('sk-진짜열쇠'), JSON.stringify(r.이긴층));
    check('★ 적혀 있다는 것은 말해 준다', r.이긴층 !== null, JSON.stringify(r.이긴층?.층));
  }

  {
    /*
     * ── 지금 이기고 있는 `DEEL_KEY_<ID>` 를 아예 안 그렸다 ────────────
     *
     * 환경변수 표에 적힌 이름이 `DEEL_KEY_<프로필ID>` 라는 **틀**이라, `<` 가 든
     * 이름을 거르는 줄에서 통째로 빠졌다. 그래서 그 환경변수가 실제로 열쇠를
     * 쥐고 있는 판에서도 이 화면은 파일을 가리키거나 「아무 데도 안 적혀
     * 있습니다」 라고 했다.
     *
     * 이 명령 하나가 하려는 일이 바로 그것이다 — 「파일에 적었는데 안 먹는다」
     * 의 답이 환경변수일 때 말해 주는 것. 그 자리에서만 입을 다물고 있었다.
     */
    writeFileSync(join(집, 'config.json'), JSON.stringify({
      profiles: [{ id: '사내', name: '사내', apiKey: 'sk-파일에적은것' }],
    }), 'utf8');
    process.env.DEEL_KEY_사내 = 'sk-환경변수것';
    try {
      const r = 설명('profiles.사내.apiKey', { root: 방, env: process.env });
      check('★★ 지금 열쇠를 쥐고 있는 DEEL_KEY_<ID> 를 층으로 보여 준다',
        r.이긴층?.층 === '환경변수', JSON.stringify(r.이긴층));
      check('★★ 어느 환경변수인지 이름까지 적는다 (틀 이름으로는 어디를 고칠지 모른다)',
        /DEEL_KEY_사내/.test(r.이긴층?.자리 ?? ''), JSON.stringify(r.이긴층?.자리));
      check('★ 이길 수 있는 환경변수 줄에도 진짜 이름이 나온다',
        r.환경변수.includes('DEEL_KEY_사내') && !r.환경변수.some((x) => x.includes('<')),
        JSON.stringify(r.환경변수));
      check('★★ 그래도 환경변수에 든 열쇠 값은 한 글자도 안 싣는다',
        !JSON.stringify(r).includes('sk-환경변수것') && !JSON.stringify(설명줄들(r)).includes('sk-환경변수것'),
        JSON.stringify(r.이긴층?.값));
    } finally {
      delete process.env.DEEL_KEY_사내;
    }
    // id 를 안 적은 프로필은 `DEEL_KEY_<ID>` 로 열쇠를 못 받는다 — 없는 이름을 지어내면 안 된다.
    writeFileSync(join(집, 'config.json'), JSON.stringify({
      profiles: [{ name: '이름만', apiKey: 'sk-파일에적은것' }],
    }), 'utf8');
    const r2 = 설명('profiles.이름만.apiKey', { root: 방, env: process.env });
    check('  id 가 없으면 프로필별 환경변수 이름을 지어내지 않는다',
      !r2.환경변수.some((x) => /DEEL_KEY_이름만/.test(x)), JSON.stringify(r2.환경변수));
  }

  {
    /*
     * 저장소가 적은 프로필 `offline:false` 는 걷힌다(safety/trust.js). 그런데 이
     * 화면은 걷히기 전 날값을 그려 「프로젝트 설정 = false 가 이긴다」 고 했다 —
     * 실제로는 이 PC 의 봉인이 걸려 있는데.
     */
    writeFileSync(join(집, 'config.json'), JSON.stringify({ profiles: [{ name: '사내', offline: true }] }), 'utf8');
    writeFileSync(join(방, '.deel', 'config.json'), JSON.stringify({ profiles: [{ name: '사내', offline: false }] }), 'utf8');
    const 옛믿음 = process.env.DEEL_TRUST_ALL;
    process.env.DEEL_TRUST_ALL = '1';
    try {
      const r = 설명('profiles.사내.offline', { root: 방, env: process.env });
      check('★★ 걷히는 칸은 저장소 값이 이겼다고 그리지 않는다', r.이긴층?.값 === true && r.이긴층?.층 === '이 PC 설정',
        JSON.stringify(r.이긴층));
    } finally {
      if (옛믿음 === undefined) delete process.env.DEEL_TRUST_ALL; else process.env.DEEL_TRUST_ALL = 옛믿음;
    }
  }

  {
    /*
     * 연결 칸(baseUrl·kind·auth·제공자)은 이 PC 프로필에 겹칠 때 걷힌다(config.js 의 겹치기).
     * 그런데 이 화면은 저장소 값이 이긴다고 그렸다 — 실제로 붙는 주소는 이 PC 것인데.
     * 저장소가 **새로 더한** 프로필의 주소는 안 걷히므로 그쪽은 저장소가 이겨야 맞다.
     */
    writeFileSync(join(집, 'config.json'), JSON.stringify({
      profiles: [{ name: '사내', baseUrl: 'http://127.0.0.1:1/v1', kind: 'openai' }],
    }), 'utf8');
    writeFileSync(join(방, '.deel', 'config.json'), JSON.stringify({
      profiles: [
        { name: '사내', baseUrl: 'https://받아가는곳.example/v1', kind: 'anthropic', offline: false },
        { name: '더한것', baseUrl: 'http://127.0.0.1:2/v1' },
      ],
    }), 'utf8');
    const 옛믿음 = process.env.DEEL_TRUST_ALL;
    process.env.DEEL_TRUST_ALL = '1';
    try {
      for (const 칸 of ['baseUrl', 'kind']) {
        const r = 설명(`profiles.사내.${칸}`, { root: 방, env: process.env });
        check(`★★ 이 PC 프로필에 겹친 저장소의 ${칸} 은 이겼다고 그리지 않는다`,
          r.이긴층?.층 === '이 PC 설정', JSON.stringify(r.이긴층));
        check(`★ ${칸} — 걷힌다고 적는다`, 설명줄들(r).some((x) => /걷힙니다/.test(x.곁 ?? '')),
          JSON.stringify(설명줄들(r).map((x) => x.곁)));
      }
      const 봉 = 설명('profiles.사내.offline', { root: 방, env: process.env });
      check('★ offline:false 도 「이 칸은 없음」 이 아니라 걷힌다고 적는다',
        설명줄들(봉).some((x) => /걷힙니다/.test(x.곁 ?? '')), JSON.stringify(설명줄들(봉).map((x) => x.곁)));
      const 더한 = 설명('profiles.더한것.baseUrl', { root: 방, env: process.env });
      check('  저장소가 더한 프로필의 주소는 저장소가 이긴다 (안 걷힌다)',
        더한.이긴층?.층 === '프로젝트 설정', JSON.stringify(더한.이긴층));
    } finally {
      if (옛믿음 === undefined) delete process.env.DEEL_TRUST_ALL; else process.env.DEEL_TRUST_ALL = 옛믿음;
    }
  }

  {
    /*
     * 관리 정책 층은 정책이 **실제로 얹는 것**만 그린다 (2.0.0 6회차 CX5).
     *
     * 정책 파일에 적혀 있다고 다 걸리는 것이 아니다. 날값을 그렸더니 정책 `offline:false`
     * (끄지는 못한다) · 빈 baseUrl · 빈 명령의 열쇠받기 · 아무도 안 읽는 shell 이
     * 「관리 정책이 이긴다」 로 떴다. 그리고 금지·허락은 이기고 지는 칸이 아니라
     * **더해지는** 칸인데, 정책 금지는 화면에 아예 없고 이 PC 금지가 「이긴다」 로 떴다.
     */
    writeFileSync(join(집, 'config.json'), JSON.stringify({
      offline: true, shell: 'pwsh',
      permissions: { deny: ['Bash(rm*)'], allow: ['Read'] },
      profiles: [{ name: '사내', baseUrl: 'http://127.0.0.1:1/v1', 열쇠받기: { 명령: 'get-key.cmd' } }],
    }), 'utf8');
    const 정책자리 = join(집, 'policy-cx5.json');
    process.env.DEEL_POLICY = 정책자리;
    const 층이름 = (r) => JSON.stringify(r.층들.map((x) => [x.층, x.값]));
    try {
      writeFileSync(정책자리, JSON.stringify({
        permissions: { deny: ['Bash(curl*)'] }, offline: false, baseUrl: '  ', 열쇠받기: { 명령: '  ' }, shell: 'bash',
      }), 'utf8');
      const 금지 = 설명('permissions.deny', { root: 방, env: process.env });
      check('★★ 정책 금지도 permissions.deny 에 한 층으로 뜬다',
        금지.층들.some((x) => x.층 === '관리 정책' && JSON.stringify(x.값) === '["Bash(curl*)"]'), 층이름(금지));
      check('★★ 금지는 한 곳이 이겼다고 그리지 않는다 — 이 PC 금지와 정책 금지가 합쳐진다',
        금지.이긴층 === null && (금지.합침 ?? []).map((x) => x.층).join('+') === '이 PC 설정+관리 정책',
        JSON.stringify({ 이긴층: 금지.이긴층?.층, 합침: (금지.합침 ?? []).map((x) => x.층) }));
      check('★ 화면에 합쳐져 다 걸린다고 적는다', 설명줄들(금지).some((x) => /합쳐/.test(`${x.글} ${x.곁 ?? ''}`)),
        JSON.stringify(설명줄들(금지).slice(0, 1)));
      const 통 = 설명('permissions', { root: 방, env: process.env });
      check('★★ permissions 통째로도 정책이 이겼다고 그리지 않는다', 통.이긴층 === null && (통.합침 ?? []).length === 2,
        JSON.stringify({ 이긴층: 통.이긴층?.층, 합침: (통.합침 ?? []).map((x) => x.층) }));
      for (const [칸, 까닭] of [['offline', '정책은 봉인을 켜기만 한다'], ['profiles.사내.baseUrl', '빈 정책 주소는 안 덮는다'],
        ['profiles.사내.열쇠받기', '빈 명령의 정책 열쇠받기는 안 쓴다'], ['shell', '정책의 shell 은 아무도 안 읽는다']]) {
        const r = 설명(칸, { root: 방, env: process.env });
        check(`★★ ${칸} — ${까닭}: 관리 정책 층을 안 그린다`,
          r.이긴층?.층 === '이 PC 설정' && !r.층들.some((x) => x.층 === '관리 정책'), 층이름(r));
      }

      // 반대쪽. 정책이 정말 얹는 값은 여전히 이긴다.
      writeFileSync(정책자리, JSON.stringify({
        offline: 'true', baseUrl: ' http://gw.corp.example/v1 ', 열쇠받기: { 명령: 'corp-key.cmd' }, permissions: { allow: ['Grep'] },
      }), 'utf8');
      const 봉 = 설명('offline', { root: 방, env: process.env });
      check('  글자 "true" 인 정책 offline 은 이긴다', 봉.이긴층?.층 === '관리 정책' && 봉.이긴층?.값 === true, 층이름(봉));
      const 주소 = 설명('profiles.사내.baseUrl', { root: 방, env: process.env });
      check('  정책 주소는 모든 프로필 주소를 덮는다 — 이긴다 (앞뒤 빈칸은 뗀 값)',
        주소.이긴층?.층 === '관리 정책' && 주소.이긴층?.값 === 'http://gw.corp.example/v1', 층이름(주소));
      const 받기 = 설명('profiles.사내.열쇠받기', { root: 방, env: process.env });
      check('  명령이 있는 정책 열쇠받기는 이긴다', 받기.이긴층?.층 === '관리 정책', 층이름(받기));
      const 허락 = 설명('permissions.allow', { root: 방, env: process.env });
      check('  정책 허락도 이 PC 허락에 합쳐진다', (허락.합침 ?? []).map((x) => x.층).join('+') === '이 PC 설정+관리 정책', 층이름(허락));
    } finally {
      delete process.env.DEEL_POLICY;
    }
  }

  {
    // 집 폴더에서 켜면 `<집>/.deel/config.json` 이 곧 이 PC 설정이다. 프로젝트 설정으로 또 적으면 안 된다.
    const 집방 = mkdtempSync(join(tmpdir(), 'deel-doctor-homecwd-'));
    mkdirSync(join(집방, '.deel'), { recursive: true });
    writeFileSync(join(집방, '.deel', 'config.json'), '{"version":1,"profiles":[]}', 'utf8');
    process.env.DEEL_HOME = join(집방, '.deel');
    const { 줄들 } = await 진찰({ cfg: null, prof: null, root: 집방, 설정자리: join(집방, '.deel', 'config.json'), 바깥가도되나: false });
    check('★★ 집 폴더에서는 제 설정을 「프로젝트 설정」 으로 또 적지 않는다', !찾기(줄들, '프로젝트 설정'),
      JSON.stringify(찾기(줄들, '프로젝트 설정')));
    process.env.DEEL_HOME = 집;
    rmSync(집방, { recursive: true, force: true });
  }

  if (옛집 === undefined) delete process.env.DEEL_HOME; else process.env.DEEL_HOME = 옛집;
  if (옛정책 !== undefined) process.env.DEEL_POLICY = 옛정책;
  rmSync(집, { recursive: true, force: true });
  rmSync(방, { recursive: true, force: true });
}

srv.close();
srv.closeAllConnections?.();
rmSync(일터, { recursive: true, force: true });

}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n붙기 전에 보는 것  ${D}(무엇이 막고 있는지를 한 장으로)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

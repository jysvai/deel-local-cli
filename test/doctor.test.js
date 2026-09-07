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
import { 설명 } from '../src/configexplain.js';
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

  if (옛집 === undefined) delete process.env.DEEL_HOME; else process.env.DEEL_HOME = 옛집;
  if (옛정책 !== undefined) process.env.DEEL_POLICY = 옛정책;
  rmSync(집, { recursive: true, force: true });
  rmSync(방, { recursive: true, force: true });
}

srv.close();
srv.closeAllConnections?.();
rmSync(일터, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n붙기 전에 보는 것  ${D}(무엇이 막고 있는지를 한 장으로)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

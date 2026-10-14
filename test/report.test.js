// 세션 보고서 (/report · 끝낼 때) 와 토큰 어림.
//
// ── 왜 이 검사가 있나 ───────────────────────────────────────────────────
//
//   「exit 하거나 /report 라는 그런 기능 넣어서 세션 동안 도구가 호출한 기록들이랑 비용 컨텍스트
//    정리해서 볼 수 있는 기능」
//   「모델도 명확한 모델명이 뜨는데 out / in 토큰값을 못 받는다고 확인 못하는건 좀 문제가 있어보여」
//
// 여기서 재는 것은 넷이다.
//   1) 도구 기록이 이름별로 제대로 모이나 — 횟수 · 실패 · 걸린 시간
//   2) 창구가 토큰 수를 안 줘도 0 이 아니라 「≈ 어림」 으로 보이나 — 그리고 실측과 안 섞이나
//   3) 파일로 남는 보고서가 표를 안 깨고, 열쇠를 가리고, 한 세션에 한 파일인가
//   4) 진짜 대화 화면에서 /report 가 뜨고, 끝낼 때 보고서 경로가 찍히나
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 도구적기, 세션보고서모으기, 세션보고서줄들, 세션보고서md, 세션보고서적기, 기록상한, _칸글 } from '../src/ui/report.js';
import { 토큰셈, 토큰글 } from '../src/ui/tokcount.js';
import { COMMANDS } from '../src/commands/common.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 벗기기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const 뿌리 = dirname(dirname(fileURLToPath(import.meta.url)));

// 화면 없이 쓰는 가짜 세션 — 보고서가 읽는 것만 갖춘다.
const 가짜세션 = (덧 = {}) => ({
  startedAt: new Date(2026, 9, 14, 9, 5, 7).getTime(),
  conn: { model: 'gw-model', base: 'https://user:pw@gw.example.com/v1?key=abc', kind: 'openai' },
  usage: { in: 0, out: 0, prompt: 0, calls: 3, ms: 4200, retries: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, 못잰것: 3, 추정in: 9000, 추정out: 300 },
  changes: new Map([['/w/a.js', { added: 5, removed: 2, times: 2 }]]),
  breakdown: () => ({ used: 3000, total: 32000, left: 29000, rows: [{ label: '대화 이력', n: 2000 }, { label: '도구 정의', n: 1000 }, { label: '빈 칸', n: 0 }], 보정잰것: 0 }),
  ...덧,
});

trace('1-도구-기록이-모인다');
{
  const s = 가짜세션();
  도구적기(s, { 이름: 'Read', 대상: 'a.js', ok: true, ms: 100 });
  도구적기(s, { 이름: 'Bash', 대상: 'npm test', ok: false, ms: 3000, 오류: '종료 코드 1' });
  도구적기(s, { 이름: 'Read', 대상: 'b.js', ok: true, ms: 50 });
  const 자 = 세션보고서모으기({ session: s, root: '/w' });
  const 읽기 = 자.도구.이름별.find((k) => k.이름 === 'Read');
  const 배시 = 자.도구.이름별.find((k) => k.이름 === 'Bash');
  check('★ 도구를 이름별로 센다', 읽기?.수 === 2 && 배시?.수 === 1, JSON.stringify(자.도구.이름별));
  check('★ 실패를 따로 센다', 자.도구.실패 === 1 && 배시?.실패 === 1 && 읽기?.실패 === 0);
  check('걸린 시간을 이름별로 더한다', 읽기?.ms === 150 && 배시?.ms === 3000);
  check('많이 부른 것이 먼저 온다', 자.도구.이름별[0].이름 === 'Read');
  check('호출 차례가 그대로 남는다', 자.도구.기록.map((r) => r.대상).join(',') === 'a.js,npm test,b.js');
  check('주소에서 아이디·비밀번호·물음표 뒤는 뗀다', 자.주소 === 'gw.example.com/v1', 자.주소);

  const 많은 = 가짜세션();
  for (let i = 0; i < 기록상한 + 7; i++) 도구적기(많은, { 이름: 'Glob', ok: true, ms: 1 });
  check('상한을 넘으면 오래된 것부터 버리고 버린 수를 센다', 많은.도구기록.length === 기록상한 && 많은.도구기록버림 === 7,
    `${많은.도구기록.length} · ${많은.도구기록버림}`);
}

trace('2-토큰-어림은-≈-로');
{
  const 잰것만 = 토큰셈({ prompt: 1000, out: 50 });
  check('실측만 있으면 ≈ 가 안 붙는다', !잰것만.추정 && 토큰글(잰것만.입력, 잰것만.추정) === (1000).toLocaleString());
  const 어림만 = 토큰셈({ 추정in: 9000, 추정out: 300 });
  check('★★ 창구가 안 알려 줘도 0 이 아니다 — 어림에 ≈ 를 붙인다',
    어림만.추정 && 토큰글(어림만.입력, 어림만.추정) === `≈${(9000).toLocaleString()}`, 토큰글(어림만.입력, 어림만.추정));
  const 섞임 = 토큰셈({ prompt: 1000, out: 10, 추정in: 500, 추정out: 5 });
  check('섞이면 합에 ≈ 를 붙이고, 실측 몫은 따로 남는다', 섞임.입력 === 1500 && 섞임.잰입력 === 1000 && 섞임.추정);
  const 자 = 세션보고서모으기({ session: 가짜세션(), root: '/w' });
  const 화면 = 벗기기(세션보고서줄들(자).join('\n'));
  check('★ 보고서 화면도 ≈ 를 붙인다', /≈9,000/.test(화면), 화면.split('\n').find((l) => /9,000/.test(l)) ?? '');
  check('못 잰 횟수를 적는다', /3번은 창구가 안 알려 줘서/.test(화면));
  check('요금표가 없으면 금액은 「모름」 — 지어내지 않는다', /모름/.test(화면));
}

trace('3-파일');
{
  check('표 칸의 세로줄·줄바꿈이 표를 안 깬다', _칸글('a|b\nc') === 'a\\|b c', _칸글('a|b\nc'));
  const s = 가짜세션();
  도구적기(s, { 이름: 'Bash', 대상: 'curl -H "Authorization: Bearer sk-live-SECRET123456789"', ok: true, ms: 10 });
  const 자 = 세션보고서모으기({ session: s, root: '/w' });
  const md = 세션보고서md(자, { 가리개: (t) => t.replaceAll('sk-live-SECRET123456789', '«가림»') });
  check('★★ 디스크에 남는 도구 대상은 가린다', !md.includes('sk-live-SECRET123456789') && md.includes('«가림»'));
  check('Markdown 제목과 표가 있다', /^# 세션 보고서/m.test(md) && /\| 도구 \| 횟수 \| 실패 \| 시간 \|/.test(md));
  check('실측 몫을 따로 적는다 (어림과 안 섞는다)', /창구가 알려 준 몫 \| ↑0 ↓0/.test(md));
  check('바뀐 파일을 싣는다', /a\.js/.test(md) && /\| 5 \| 2 \| 2 \|/.test(md));

  const 방 = mkdtempSync(join(tmpdir(), 'deel-report-'));
  const 첫 = 세션보고서적기(방, md, 자.시작);
  const 둘 = 세션보고서적기(방, `${md}\n다시`, 자.시작);
  check('★ .deel/reports 에 남긴다', 첫.replace(/\\/g, '/').includes('/.deel/reports/') && existsSync(첫), 첫);
  check('★ 한 세션에 한 파일 — 다시 남기면 같은 파일을 최신 것으로 덮는다',
    첫 === 둘 && readdirSync(join(방, '.deel', 'reports')).length === 1 && readFileSync(둘, 'utf8').endsWith('다시'));
  check('이름은 세션이 시작한 때다', /deel-report-20261014-090507\.md$/.test(첫), 첫);
  rmSync(방, { recursive: true, force: true });
  check('/report 가 명령 표에 있다', !!COMMANDS.report && !!COMMANDS.report.desc);

  /*
   * GFM 표는 역빗금 짝(\x)을 하나로 읽고 남은 세로줄에서 칸을 나눈다. 명령에 이미 `\|` 가 있으면(grep "a\|b")
   * 우리가 붙인 역빗금이 그 역빗금과 짝이 돼 세로줄이 살아난다 — 칸이 하나 늘어 표가 어긋난다.
   */
  const 칸나누기 = (줄) => {
    const 칸 = [''];
    for (let i = 0; i < 줄.length; i += 1) {
      if (줄[i] === '\\' && i + 1 < 줄.length) { 칸[칸.length - 1] += 줄[i] + 줄[i + 1]; i += 1; continue; }
      if (줄[i] === '|') { 칸.push(''); continue; }
      칸[칸.length - 1] += 줄[i];
    }
    return 칸.length;
  };
  for (const 글 of ['grep "a\\|b" x.txt', 'a\\\\|b', 'C:\\Users\\', '끝에 역빗금 \\']) {
    check(`★ 역빗금이 붙은 글도 표 칸 하나다 — ${JSON.stringify(글)}`, 칸나누기(`| ${_칸글(글)} | 1 |`) === 4, _칸글(글));
  }

  // 모델 이름 · 주소도 디스크에 가기 전에 가린다.
  const 열쇠길 = 가짜세션();
  열쇠길.conn = { model: 'gw-sk-live-SECRET123456789', base: 'https://gw.example/keys/sk-live-SECRET123456789/v1' };
  const 열쇠md = 세션보고서md(세션보고서모으기({ session: 열쇠길, root: '/w' }), { 가리개: (t) => t.replaceAll('sk-live-SECRET123456789', '«가림»') });
  check('★ 모델 이름 · 주소에 실린 열쇠도 가린다', !열쇠md.includes('SECRET123456789') && /«가림»/.test(열쇠md),
    열쇠md.split('\n').find((l) => /gw/.test(l)) ?? '');
  const 틀없음 = 가짜세션();
  틀없음.conn = { model: 'm', base: 'admin:pw123@10.0.0.1:8080/v1?key=abc#x' };
  const 주소 = 세션보고서모으기({ session: 틀없음, root: '/w' }).주소;
  check('★ 틀(http://) 없는 주소도 아이디:비밀번호 · 물음 · # 을 뗀다', 주소 === '10.0.0.1:8080/v1', 주소);

  // 상한을 넘겨도 셈은 다 센다 — 버린 기록의 횟수 · 실패도 안 사라진다.
  const 많이 = 가짜세션();
  for (let i = 0; i < 기록상한 + 7; i += 1) 도구적기(많이, { 이름: i % 2 ? 'Read' : 'Bash', ok: i >= 3, ms: 1 });
  const 많이자 = 세션보고서모으기({ session: 많이, root: '/w' });
  check('★ 기록이 상한에서 잘려도 도구 호출 수는 전부다', 많이자.도구.수 === 기록상한 + 7 && 많이자.도구.기록.length === 기록상한,
    `${많이자.도구.수} · ${많이자.도구.기록.length}`);
  check('★ 버린 기록의 실패도 센다', 많이자.도구.실패 === 3, String(많이자.도구.실패));
  check('이름별 합이 전체와 같다', 많이자.도구.이름별.reduce((n, k) => n + k.수, 0) === 기록상한 + 7,
    JSON.stringify(많이자.도구.이름별.map((k) => [k.이름, k.수])));
}

trace('4-진짜-대화-화면');
{
  /*
   * 창구는 stream_options 를 받고도 usage 를 안 준다(무시하는 창구). 도구를 한 번 부르고, /report 와 /exit 을 친다.
   */
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'fake-7b' }] })); }
      if (!req.url.includes('chat/completions')) { res.writeHead(404); return res.end(); }
      const j = JSON.parse(body);
      const 끝 = j.messages[j.messages.length - 1];
      const 보내기 = (delta, fin = null) => res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: fin }] })}\n\n`);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (끝?.role === 'tool') { 보내기({ content: '읽어 봤습니다. 두 줄입니다.' }); 보내기({}, 'stop'); } else {
        보내기({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: '안녕.txt' }) } }] });
        보내기({}, 'tool_calls');
      }
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const 주소 = `http://127.0.0.1:${srv.address().port}/v1`;
  const home = mkdtempSync(join(tmpdir(), 'deel-report-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 'gw', level: '개발자',
    profiles: [{ id: 'gw', name: '가짜', kind: 'openai', baseUrl: 주소, auth: 'none', apiKey: '', model: 'fake-7b', ctx: 32000, streaming: true, tools: true }],
  }), 'utf8');
  const root = mkdtempSync(join(tmpdir(), 'deel-report-root-'));
  writeFileSync(join(root, '안녕.txt'), '첫 줄\n둘째 줄\n');
  const kid = spawn(process.execPath, [join(뿌리, 'bin', 'deel.js'), '--root', root, '--no-tui'],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DEEL_HOME: home, DEEL_NET_ALLOW: 주소, DEEL_NO_OPEN: '1' } });
  let out = '';
  kid.stdout.setEncoding('utf8');
  kid.stderr.setEncoding('utf8');
  kid.stdout.on('data', (d) => { out += d; });
  kid.stderr.on('data', (d) => { out += d; });
  const 닫힘 = new Promise((r) => kid.on('close', r));
  const 자기 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 기다리기 = async (f, 최대 = 20000) => { const e = Date.now() + 최대; while (Date.now() < e) { if (f()) return true; await 자기(50); } return false; };
  await 자기(1200);
  kid.stdin.write('안녕.txt 읽어줘\n');
  await 기다리기(() => 벗기기(out).includes('두 줄입니다'));
  await 자기(300);
  kid.stdin.write('/report\n');
  await 기다리기(() => /보고서를 남겼습니다/.test(벗기기(out)), 8000);
  kid.stdin.write('/exit\n');
  await Promise.race([닫힘, 자기(8000).then(() => kid.kill())]);
  srv.close();

  const 화면 = 벗기기(out);
  check('★ /report 가 도구 호출을 보여 준다', /Read\s+1회/.test(화면), 화면.split('\n').find((l) => /Read/.test(l))?.trim() ?? '못 찾음');
  check('★★ usage 를 안 주는 창구에서도 입력 토큰이 0 이 아니라 ≈ 어림이다', /입력 토큰\s+≈[1-9]/.test(화면),
    화면.split('\n').find((l) => /입력 토큰/.test(l))?.trim() ?? '못 찾음');
  check('★ 끝맺음 줄도 ≈ 를 붙인다', /끝냅니다\..*↑≈[1-9]/.test(화면), 화면.split('\n').find((l) => /끝냅니다/.test(l))?.trim() ?? '');
  check('★ 끝낼 때 보고서 경로를 적는다', /보고서: \.deel[\\/]reports[\\/]deel-report-\d{8}-\d{6}\.md/.test(화면),
    화면.split('\n').find((l) => /보고서:/.test(l))?.trim() ?? '못 찾음');
  const 방 = join(root, '.deel', 'reports');
  const 파일들 = existsSync(방) ? readdirSync(방) : [];
  check('★ /report 와 끝낼 때가 같은 파일 하나다', 파일들.length === 1, JSON.stringify(파일들));
  const md = 파일들[0] ? readFileSync(join(방, 파일들[0]), 'utf8') : '';
  check('파일에 도구 차례가 있다', /\| 1 \| \d\d:\d\d:\d\d \| Read \| `안녕\.txt` \| ✓ \|/.test(md), md.split('\n').find((l) => /Read/.test(l)) ?? '');
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n세션 보고서 검사  ${D}(도구 기록 · 토큰 어림 · 파일 · 진짜 화면)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

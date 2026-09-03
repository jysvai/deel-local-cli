// 붙잡아 둔 반 줄이 사라지지 않는가.
//
// ── 무슨 일이 났었나 ────────────────────────────────────────────────────
//
// 답을 그리는 쪽(ui/md.js)은 표를 **모아서** 그린다. 칸 너비는 그 열에서
// 제일 긴 칸이 정하는데, 그건 표가 끝나야 안다. 그래서 표가 도는 동안 그
// 줄들은 화면에 안 나가고 손에 쥐어져 있다. 마지막 줄이 개행 없이 끝나도
// 마찬가지다 — 줄이 끝나야 꾸밀 수 있다.
//
// 그 손에 쥔 것을 비우는 자리가 `답비우기()` 다. `done` 은 그것을 부르는데
// **capped·cutoff·error 는 안 불렀다.** 그래서 이렇게 됐다.
//
//   · 오류로 끝나면 → 붙잡힌 표가 **통째로 사라진다.** 화면에는 오류 한 줄만
//     남는다. 모델이 표까지 다 만들어 놓고 죽은 것인데 사람 눈에는 아무것도
//     안 한 것으로 보인다.
//   · 잘렸다고 말할 때는 → 경고가 표보다 **먼저** 찍힌다. 무엇이 잘렸는지
//     보라고 띄우는 경고인데, 정작 그 답의 마지막이 경고 아래에 온다.
//
// ── 어떻게 재나 ─────────────────────────────────────────────────────────
//
// 진짜 deel 을 띄운다. 값이 아니라 **화면에 무엇이 어느 순서로 찍혔나** 가
// 이 파일이 재려는 것이라, 그건 띄워 봐야만 안다.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 벗기기 = (s) => String(s).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
const 뿌리 = dirname(dirname(fileURLToPath(import.meta.url)));

/*
 * 답 안에 표를 하나 실어 보낸다. 표는 끝날 때까지 화면에 안 나가고
 * 붙잡혀 있으므로, 붙잡힌 것이 어떻게 되는지를 재기에 딱 맞다.
 */
const 표줄들 = [
  '고친 자리는 아래와 같습니다.\n',
  '\n',
  '| 파일 | 무엇을 |\n',
  '|---|---|\n',
  '| src/일번.js | 로그를 고침 |\n',
  '| src/이번.js | 이름을 바꿈 |\n',
];

let 모드 = 'cutoff';
const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', async () => {
    if (String(req.url).endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: '스텁모델', object: 'model' }] }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const 조각 of 표줄들) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 조각 } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 5));
    }
    if (모드 === 'die') {
      // 게이트웨이가 몸통 중간에서 연결을 놓는 모양. 오류로 끝난다.
      await new Promise((r) => setTimeout(r, 20));
      return res.destroy();
    }
    // 끝났다는 말을 한 번도 안 주고 곱게 닫는다 — 「말없이 끊김」(cutoff).
    res.end();
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const 주소 = `http://127.0.0.1:${srv.address().port}/v1`;

/** deel 을 한 번 띄워서 한 마디 시키고, 화면 글을 통째로 돌려준다. */
async function 띄우기() {
  const root = mkdtempSync(join(tmpdir(), 'deel-held-'));
  const home = mkdtempSync(join(tmpdir(), 'deel-held-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [{
      id: 'stub', name: '스텁', kind: 'openai', baseUrl: 주소,
      auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: true, tools: false,
    }],
  }), 'utf8');

  const kid = spawn(process.execPath,
    [join(뿌리, 'bin', 'deel.js'), '--root', root, '--offline', '--ctx', '32768', '--no-tui'],
    { cwd: 뿌리, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DEEL_HOME: home } });

  let out = '';
  kid.stdout.setEncoding('utf8');
  kid.stderr.setEncoding('utf8');
  kid.stdout.on('data', (b) => { out += b; });
  kid.stderr.on('data', (b) => { out += b; });
  let 끝남 = false;
  const 닫힘 = new Promise((r) => kid.on('close', () => { 끝남 = true; r(); }));
  const 자기 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 기다리기 = async (될때까지, 최대 = 20000) => {
    const 끝 = Date.now() + 최대;
    while (Date.now() < 끝 && !끝남) {
      if (될때까지()) return true;
      await 자기(40);
    }
    return false;
  };

  await 기다리기(() => 벗기기(out).includes('❯'));
  kid.stdin.write('고친 것 표로 정리해줘\n');
  // 턴이 끝난 표시(꼬리말의 '초 ·')가 보일 때까지 기다린다.
  await 기다리기(() => /\d+\.\d초/.test(벗기기(out)), 15000);
  if (!끝남) { try { kid.stdin.write('/exit\n'); } catch { /* 이미 닫혔다 */ } }
  await Promise.race([닫힘, 자기(6000).then(() => kid.kill())]);

  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  return 벗기기(out);
}

trace('1-오류로끝나면');

/*
 * ── 오류로 끝나도 붙잡힌 표가 남는가 ────────────────────────────────────
 *
 * 여기가 제일 나빴다. 붙잡힌 것을 안 비우고 끝내면 그 표는 **화면에서
 * 영영 사라진다.** 뒤에 오는 done 이 없기 때문이다.
 */
{
  모드 = 'die';
  const 화면 = await 띄우기();
  check('중간에 끊기면 그렇다고 말한다', /✗/.test(화면),
    화면.split('\n').find((l) => /✗/.test(l))?.trim().slice(0, 120) ?? '오류 줄을 못 찾았다');
  check('★ 오류로 끝나도 붙잡힌 표가 화면에 남는다', /src\/일번\.js/.test(화면),
    /src\/일번\.js/.test(화면) ? '' : '표가 통째로 사라졌다');
  check('★ 표의 마지막 줄까지 남는다', /src\/이번\.js/.test(화면));
  check('★ 반쪽이라도 남겼다고 알려 준다', /여기까지 받은 것은 대화에 남겼습니다/.test(화면),
    화면.split('\n').find((l) => /남겼습니다/.test(l))?.trim().slice(0, 70) ?? '못 찾음');
}

trace('2-말없이끊기면');

/*
 * ── 경고보다 답이 먼저 나오는가 ─────────────────────────────────────────
 *
 * 말없이 끊긴 것은 뒤에 done 이 따라오므로 표가 아주 사라지지는 않는다.
 * 다만 **순서**가 뒤집힌다 — 무엇이 잘렸는지 보라고 띄우는 경고가 정작
 * 그 답의 마지막 줄보다 위에 찍힌다. 사람은 경고를 읽고 위를 보는데,
 * 봐야 할 줄은 아래에 있다.
 */
{
  모드 = 'cutoff';
  const 화면 = await 띄우기();
  const 경고자리 = 화면.indexOf('끝났다는 말 없이');
  const 표자리 = 화면.indexOf('src/이번.js');
  check('말없이 끊긴 것을 그냥 안 넘긴다', 경고자리 >= 0,
    화면.split('\n').filter((l) => l.trim()).slice(-4).join(' / ').slice(0, 140));
  check('표가 화면에 남는다', 표자리 >= 0);
  check('★ 붙잡힌 표가 경고보다 먼저 찍힌다', 표자리 >= 0 && 경고자리 >= 0 && 표자리 < 경고자리,
    `표 ${표자리}자리 · 경고 ${경고자리}자리`);
}

trace('3-끝');

srv.close();

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n붙잡아 둔 반 줄  ${D}(끝나는 길이 달라도 안 사라지는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

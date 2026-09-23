/**
 * 자율(auto) 모드는 사람 답을 끝없이 기다리지 않는가 (2.1.0 · ui/approve.js 의 자율대기).
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 *
 * 「AI 에게 다 맡기고 싶은데 답을 안 하면 진행이 안 되는 것은 치명적이다」. 승인 모드는 이미
 * 갈려 있었다 — auto 는 도구 승인을 안 묻는다. 그런데 auto 안에서도 끝없이 기다리는 자리가 둘
 * 남아 있었다. 모델이 되묻는 것(Ask)과, 「설계하고 만들어줘」 에 뜨는 계획 승인. 맡겨 두고 자리를
 * 뜬 사람에게는 그게 멈춘 것이다.
 *
 * 진짜 대화 화면을 띄우고 **아무 답도 안 넣은 채** 기다려 본다. 표준입력은 열어 둔다 — 닫으면
 * 「입력이 끝났다」 로 읽혀 시한과 상관없이 넘어간다. 그건 이 검사가 재려는 것이 아니다.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const { 자율대기, 자율대기기본 } = await import('../src/ui/approve.js');

const here = dirname(fileURLToPath(import.meta.url));
const 진입점 = join(here, '..', 'bin', 'deel.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 1. 설정 읽기 ───────────────────────────────────────────────────────
trace('1-설정');
check('★ askWait 가 없으면 60초', 자율대기({}) === 자율대기기본 && 자율대기기본 === 60);
check('★ 0 이면 0 (묻지 않고 간다)', 자율대기({ askWait: 0 }) === 0);
check('  음수·숫자 아님은 기본값', 자율대기({ askWait: -3 }) === 60 && 자율대기({ askWait: 'x' }) === 60);
check('  한 시간이 상한 · 소수는 버림', 자율대기({ askWait: 99999 }) === 3600 && 자율대기({ askWait: 2.7 }) === 2);
// 2차 눈(Gemini) 판정: Number(true) 는 1, Number(false) 는 0 이라 `"askWait": true` 가 1초, false 가 「안 묻고 간다」 였다.
check('★ 참·거짓은 숫자로 안 읽는다 (true 가 1초가 되면 안 된다)', 자율대기({ askWait: true }) === 60 && 자율대기({ askWait: false }) === 60);
check('  숫자 글은 받는다', 자율대기({ askWait: '30' }) === 30 && 자율대기({ askWait: ' ' }) === 60);

// ── 2. 스텁 ────────────────────────────────────────────────────────────
trace('2-스텁');
let 받은도구결과 = [];
const 서버 = createServer((q, res) => {
  let body = '';
  q.on('data', (d) => (body += d));
  q.on('end', () => {
    let json = null;
    try { json = JSON.parse(body); } catch { /* 목록 */ }
    const 보냄 = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (!json?.messages) return 보냄({ data: [{ id: 'fake', object: 'model' }] });
    const 말들 = json.messages;
    const 끝말 = 말들[말들.length - 1];
    const 끝 = (글) => 보냄({ choices: [{ message: { role: 'assistant', content: 글 }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
    if (끝말.role === 'tool') { 받은도구결과.push(String(끝말.content ?? '')); return 끝('알겠습니다. 그렇게 진행했습니다.'); }
    const 사람말 = String(끝말.content ?? '');
    if (/일부러_되물음/.test(사람말)) {
      return 보냄({
        choices: [{
          message: {
            role: 'assistant', content: null,
            tool_calls: [{ id: 'q1', type: 'function', function: { name: 'Ask', arguments: JSON.stringify({
              understanding: '로그인 화면에 소셜 로그인을 붙이는 일로 알아들었습니다',
              question: '어느 제공자부터 붙일까요?', options: ['구글', '카카오'],
            }) } }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      });
    }
    if (/사람이 승인했다/.test(사람말)) { 받은도구결과.push(`계획진행:${사람말.slice(0, 40)}`); return 끝('계획대로 만들었습니다.'); }
    return 끝('1. 화면을 나눈다\n2. 로그인 폼을 만든다');
  });
});
await new Promise((r) => 서버.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${서버.address().port}/v1`;
const home = mkdtempSync(join(tmpdir(), 'deel-autowait-home-'));
const work = mkdtempSync(join(tmpdir(), 'deel-autowait-work-'));
const 설정쓰기 = (덧) => writeFileSync(join(home, 'config.json'), JSON.stringify({
  version: 1, active: 'stub', level: '개발자', ...덧,
  profiles: [{ id: 'stub', name: '스텁', kind: 'openai', baseUrl: base, auth: 'none', apiKey: '', model: 'fake', ctx: 32768, streaming: false, tools: true, json: true, think: false }],
}, null, 2));

/**
 * 대화 화면을 띄운다. 앞줄들을 넣고, `기다릴것` 이 화면에 뜨거나 `최대ms` 가 지날 때까지 **아무것도 안 넣고**
 * 기다린 뒤 뒷줄들을 넣는다. 표준입력은 끝까지 열어 둔다.
 */
function 대화(앞줄들, { 기다릴것 = null, 최대ms = 8000, 뒷줄들 = ['/exit'] } = {}) {
  return new Promise((done) => {
    const kid = spawn(process.execPath, [진입점, '--no-tui'], {
      cwd: work, env: { ...process.env, DEEL_HOME: home, NO_COLOR: '1', COLUMNS: '100', DEEL_LANG: 'ko' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    kid.stdout.on('data', (b) => { out += b; });
    kid.stderr.on('data', (b) => { out += b; });
    const 시계 = setTimeout(() => kid.kill('SIGKILL'), 60_000);
    kid.on('close', (code) => { clearTimeout(시계); done({ code, out }); });
    (async () => {
      const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
      await 잠깐(700);
      for (const 줄 of 앞줄들) { kid.stdin.write(줄 + '\n'); await 잠깐(300); }
      const t0 = Date.now();
      while (Date.now() - t0 < 최대ms && !(기다릴것 && 기다릴것.test(out))) await 잠깐(100);
      await 잠깐(500);
      for (const 줄 of 뒷줄들) { kid.stdin.write(줄 + '\n'); await 잠깐(300); }
      kid.stdin.end();
    })();
  });
}

// ── 3. 되묻기 ──────────────────────────────────────────────────────────
trace('3-되묻기');
{
  설정쓰기({ askWait: 1 });
  받은도구결과 = [];
  const t0 = Date.now();
  const r = await 대화(['일부러_되물음 로그인 붙여 줘'], { 기다릴것: /알겠습니다/ });
  check('★★★ auto 에서 되물음에 답이 없으면 시한 뒤 알아서 진행한다', /1초 동안 답이 없어 알아서 진행합니다/.test(r.out), r.out.slice(-500));
  check('★★ 모델에게는 「답하지 않았다 — 스스로 판단하라」 가 간다', 받은도구결과.some((x) => /사람이 답하지 않았습니다/.test(x)), JSON.stringify(받은도구결과));
  check('★ 물음 줄에 몇 초 기다리는지 적는다', /1초 안에 답이 없으면 알아서 진행합니다/.test(r.out));
  check('  그 턴이 끝나고 대화가 이어진다', /알겠습니다/.test(r.out) && r.code === 0 && Date.now() - t0 < 30_000, `code=${r.code}`);
}
{
  설정쓰기({ askWait: 0 });
  받은도구결과 = [];
  const r = await 대화(['일부러_되물음 로그인 붙여 줘'], { 기다릴것: /알겠습니다/ });
  check('★★ askWait 0 이면 아예 안 묻고 넘긴다', /자율 모드라 묻지 않고 진행합니다/.test(r.out) && !/1초 안에 답이/.test(r.out), r.out.slice(-400));
  check('  그때도 모델에게 스스로 판단하라고 간다', 받은도구결과.some((x) => /사람이 답하지 않았습니다/.test(x)));
}
{
  설정쓰기({ askWait: 1 });
  받은도구결과 = [];
  const r = await 대화(['/mode strict', '일부러_되물음 로그인 붙여 줘'], { 최대ms: 3500, 뒷줄들: ['2', '/exit'] });
  check('★★★ auto 가 아니면 시한이 없다 — 3초 넘게 기다려도 알아서 안 간다', !/동안 답이 없어/.test(r.out), r.out.slice(-400));
  check('★★ 사람이 답하면 그 답이 모델에게 간다', 받은도구결과.some((x) => /사람의 답: 카카오/.test(x)), JSON.stringify(받은도구결과));
}

// ── 4. 계획 승인 ───────────────────────────────────────────────────────
trace('4-계획');
{
  설정쓰기({ askWait: 1 });
  받은도구결과 = [];
  const r = await 대화(['로그인 기능 설계하고 구현해줘'], { 기다릴것: /계획대로 만들었습니다/ });
  check('★★★ auto 에서 계획 승인에 답이 없으면 시한 뒤 계획대로 진행한다', /1초 동안 답이 없어 계획대로 진행합니다/.test(r.out), r.out.slice(-500));
  check('★★ 진행하라는 말이 모델에게 실제로 간다', 받은도구결과.some((x) => /^계획진행:/.test(x)) && /계획대로 만들었습니다/.test(r.out), JSON.stringify(받은도구결과));
}
{
  설정쓰기({ askWait: 0 });
  받은도구결과 = [];
  const r = await 대화(['로그인 기능 설계하고 구현해줘'], { 기다릴것: /계획대로 만들었습니다/ });
  check('★★ askWait 0 이면 계획도 안 묻고 진행한다', /자율 모드라 묻지 않고 계획대로 진행합니다/.test(r.out) && 받은도구결과.some((x) => /^계획진행:/.test(x)), r.out.slice(-400));
}

서버.close();
rmSync(home, { recursive: true, force: true, maxRetries: 3 });
rmSync(work, { recursive: true, force: true, maxRetries: 3 });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n자율 모드는 멈춰 서지 않는다  ${D}(맡긴 사람은 자리에 없다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

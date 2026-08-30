// 허락·금지 규칙과 관리 정책.
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────
//
// 규칙이 "적혀 있다" 는 것은 아무 뜻이 없다. 재야 하는 것은 **적어 둔 대로
// 도구가 실제로 안 돌았는가** 다. 그래서 여기서는 가짜 게이트웨이가 모델
// 노릇을 하며 Bash 를 부르게 하고, 그 명령이 진짜로 안 돌았다는 것을
// **파일이 안 생긴 것**으로 잰다. 화면에 무슨 말이 떴는지가 아니라.
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  규칙읽기, 걸리나, 어떻게할까, 규칙모으기, 늘허락, 정책자리, 정책읽기, 정책잊기, 규칙말,
} from '../src/safety/policy.js';
import { run } from '../src/agent/loop.js';
import { Session } from '../src/agent/session.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { allowEndpoint, resetNet, isOffline, setOffline } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-policy-'));

// ── 1. 규칙 한 줄 읽기 ─────────────────────────────────────────────────
trace('1-읽기');
{
  check('도구만 적으면 그 도구 전부', JSON.stringify(규칙읽기('Bash')) === JSON.stringify({ 도구: 'Bash', 무늬: null, 원문: 'Bash' }),
    JSON.stringify(규칙읽기('Bash')));
  const r = 규칙읽기('Bash(npm test*)');
  check('괄호 안은 무늬', r.도구 === 'Bash' && r.무늬 === 'npm test*', JSON.stringify(r));
  check('빈 줄은 규칙이 아니다', 규칙읽기('   ') === null);
  check('공백은 다듬는다', 규칙읽기('  Read  ')?.도구 === 'Read');

  // 무늬는 별표만 뜻을 갖는다. 정규식을 받으면 적는 사람이 실수하고,
  // 실수한 금지 규칙은 조용히 안 걸린다.
  const 표 = [
    ['Bash(npm test*)', { command: 'npm test -- --watch' }, true],
    ['Bash(npm test*)', { command: 'npm run test' }, false],
    ['Bash(*rm -rf*)', { command: 'sudo rm -rf /tmp/x' }, true],
    ['Bash(curl*)', { command: 'curl http://x' }, true],
    ['Bash(curl*)', { command: 'echo curl' }, false],
    ['Bash', { command: '무엇이든' }, true],
    ['Read(src/*)', { file_path: 'src/a.js' }, true],
    ['Read(src/*)', { file_path: 'test/a.js' }, false],
    // 점은 글자 그대로여야 한다. 정규식으로 읽으면 아무 글자나 맞는다.
    ['Bash(a.c)', { command: 'abc' }, false],
    ['Bash(a.c)', { command: 'a.c' }, true],
  ];
  for (const [줄, 인자, 답] of 표) {
    check(`${줄} × ${JSON.stringify(Object.values(인자)[0])} → ${답 ? '걸림' : '안 걸림'}`,
      걸리나(규칙읽기(줄), 규칙읽기(줄).도구, 인자) === 답);
  }
  check('도구가 다르면 안 걸린다', 걸리나(규칙읽기('Bash(x)'), 'Read', { command: 'x' }) === false);
}

// ── 2. 금지 > 허락 > 모드 ──────────────────────────────────────────────
trace('2-순서');
{
  const 규칙들 = {
    allow: [{ ...규칙읽기('Bash(npm*)'), 출처: '설정' }],
    deny: [{ ...규칙읽기('Bash(npm publish*)'), 출처: '관리 정책' }],
  };
  const a = 어떻게할까(규칙들, 'Bash', { command: 'npm test' });
  check('허락에만 걸리면 허락', a.답 === 'allow' && a.출처 === '설정', JSON.stringify(a));
  const d = 어떻게할까(규칙들, 'Bash', { command: 'npm publish' });
  check('둘 다 걸리면 금지가 이긴다', d.답 === 'deny' && d.출처 === '관리 정책', JSON.stringify(d));
  check('어느 규칙 때문인지 말해 준다', d.규칙 === 'Bash(npm publish*)', d.규칙);
  const m = 어떻게할까(규칙들, 'Bash', { command: 'git push' });
  check('아무 데도 안 걸리면 모드에 맡긴다', m.답 === '모름', JSON.stringify(m));
  check('규칙이 아예 없어도 안 터진다', 어떻게할까(null, 'Bash', { command: 'x' }).답 === '모름');
}

// ── 3. 관리 정책 파일 ──────────────────────────────────────────────────
trace('3-정책파일');
{
  const 정책폴더 = join(root, 'policy');
  mkdirSync(정책폴더, { recursive: true });
  const 정책파일 = join(정책폴더, 'policy.json');
  writeFileSync(정책파일, JSON.stringify({
    baseUrl: 'https://gw.사내.example/v1',
    offline: true,
    permissions: { deny: ['Bash(curl*)'], allow: ['Bash(npm test*)'] },
  }), 'utf8');

  정책잊기();
  const 것 = 정책읽기({ env: { DEEL_POLICY: 정책파일 }, 다시: true });
  check('DEEL_POLICY 로 준 자리를 읽는다', 것.곳 === 정책파일 && 것.값.offline === true, JSON.stringify(것.곳));

  정책잊기();
  const 규칙들 = 규칙모으기({ permissions: { deny: ['WebFetch'] } }, { env: { DEEL_POLICY: 정책파일 } });
  check('설정과 정책의 금지를 같이 본다', 규칙들.deny.length === 2, JSON.stringify(규칙들.deny.map((x) => x.원문)));
  check('어느 것이 정책에서 왔는지 표시된다',
    규칙들.deny.some((x) => x.원문 === 'Bash(curl*)' && x.출처 === '관리 정책'), JSON.stringify(규칙들.deny));
  check('정책이 못박은 주소를 들고 있다', 규칙들.baseUrl === 'https://gw.사내.example/v1', 규칙들.baseUrl);
  check('정책의 오프라인을 들고 있다', 규칙들.offline === true);
  check('정책 자리를 사람에게 말해 줄 수 있다', 규칙말(규칙들).includes(정책파일), 규칙말(규칙들));

  // 정책 파일이 망가져 있어도 프로그램이 안 죽어야 한다. 다만 조용하면 안 된다 —
  // 관리자는 걸린 줄 알고 사용자는 안 걸린 채로 쓴다.
  writeFileSync(정책파일, '{ 이건 JSON 이 아니다', 'utf8');
  정책잊기();
  const 깨진것 = 규칙모으기({}, { env: { DEEL_POLICY: 정책파일 } });
  check('망가진 정책 파일에도 안 죽는다', Array.isArray(깨진것.deny));
  check('못 읽었다고 말한다', /못 읽었습니다/.test(깨진것.탈 ?? ''), 깨진것.탈);
  check('그 말이 화면 줄에도 실린다', 규칙말(깨진것).includes('못 읽었습니다'), 규칙말(깨진것));

  // 자리 찾는 순서 — DEEL_POLICY 가 먼저, 없으면 OS 자리.
  정책잊기();
  const 자리들 = 정책자리({ ProgramData: 'C:\\PD' }, 'win32');
  check('윈도우는 ProgramData 밑을 본다', 자리들[0] === join('C:\\PD', 'deel', 'policy.json'), 자리들.join(' '));
  check('리눅스는 /etc/deel 을 본다', 정책자리({}, 'linux')[0] === '/etc/deel/policy.json');
  check('DEEL_POLICY 가 제일 먼저다', 정책자리({ DEEL_POLICY: '/x.json' }, 'linux')[0] === '/x.json');
  정책잊기();
}

// ── 4. 늘 허락에 더하기 (ACP 의 '앞으로 묻지 않기') ────────────────────
trace('4-늘허락');
{
  const cfg = {};
  const r = 늘허락(cfg, 'Read');
  check('설정에 적힌다', r.ok && cfg.permissions.allow.includes('Read'), JSON.stringify(cfg));
  늘허락(cfg, 'Read');
  check('두 번 적지 않는다', cfg.permissions.allow.filter((x) => x === 'Read').length === 1, JSON.stringify(cfg.permissions.allow));

  // 금지에 걸리는 것은 안 적는다 — 적어 봐야 금지가 이기는데,
  // 목록에는 허락으로 보여서 사람이 풀린 줄 안다.
  const 규칙들 = { deny: [{ ...규칙읽기('Bash'), 출처: '관리 정책' }], allow: [] };
  const bad = 늘허락(cfg, 'Bash', 규칙들);
  check('금지된 것은 허락에 안 넣는다', bad.ok === false, JSON.stringify(bad));
  check('왜 안 되는지 말해 준다', /금지가 이깁니다/.test(bad.왜 ?? ''), bad.왜);
  check('설정도 안 건드린다', !cfg.permissions.allow.includes('Bash'), JSON.stringify(cfg.permissions.allow));
}

// ── 5. 진짜로 안 도는가 ────────────────────────────────────────────────
//
// 여기가 이 검사의 알맹이다. "막았다" 는 화면 글이 아니라 **명령이 안 돈 것**
// 으로 잰다. 금지된 명령이 파일을 만들게 해 두고, 그 파일이 없는 것을 본다.
trace('5-진짜막힘');
{
  const 흔적 = join(root, '돌았다.txt');
  const 만드는명령 = `echo x > "${흔적}"`;

  let 불린것 = 0;
  const server = createServer((q, res) => {
    let body = '';
    q.on('data', (d) => (body += d));
    q.on('end', () => {
      불린것 += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(불린것 === 1
        ? {
          choices: [{
            message: {
              content: null,
              tool_calls: [{ id: 'b1', type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command: 만드는명령 }) } }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        }
        : { choices: [{ message: { content: '알겠습니다.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5 } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  resetNet();
  allowEndpoint(base);

  const 돌리기 = async (규칙들) => {
    불린것 = 0;
    const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 32768, tools: true };
    const s = new Session(conn, { root });
    const ctx = {
      scope: makeScope(root), history: new History(root), audit: new Audit(root),
      seen: new Set(), 규칙들,
      // 물어보면 늘 예라고 답하는 사람. 금지는 이 사람도 못 뚫어야 한다.
      confirm: async () => true,
    };
    ctx.history.nextTurn();
    const 것들 = [];
    for await (const ev of run(s, ctx, '파일 하나 만들어줘')) 것들.push(ev);
    return { s, 것들 };
  };

  // (1) 규칙이 없으면 예전 그대로 돈다 — 이게 있어야 (2)의 뜻이 생긴다.
  const 없을때 = await 돌리기(null);
  check('규칙이 없으면 예전처럼 돈다', existsSync(흔적), '명령이 안 돌았습니다');
  check('도구 결과도 정상', 없을때.것들.some((e) => e.type === 'tool' && !e.result?.error));

  // (2) 금지되면 진짜로 안 돈다.
  const { rmSync } = await import('node:fs');
  rmSync(흔적, { force: true });
  const 막힐때 = await 돌리기({
    allow: [],
    deny: [{ ...규칙읽기('Bash(*echo*)'), 출처: '관리 정책' }],
  });
  check('금지된 명령은 진짜로 안 돈다', !existsSync(흔적), '파일이 생겼습니다 — 명령이 돌았습니다');
  const 막힌결과 = 막힐때.것들.find((e) => e.type === 'tool' && e.result?.error);
  check('막혔다고 화면에 알린다', !!막힌결과, JSON.stringify(막힐때.것들.map((e) => e.type)));
  check('어디에 적힌 규칙인지 말해 준다', /관리 정책/.test(막힌결과?.result?.error ?? ''), 막힌결과?.result?.error);
  check('어느 규칙인지도 말해 준다', /Bash\(\*echo\*\)/.test(막힌결과?.result?.error ?? ''), 막힌결과?.result?.error);
  // 모델에게 돌려준 말도 같아야 한다. 여기가 다르면 모델은 왜 실패했는지 모르고 다시 부른다.
  const 도구말 = 막힐때.s.messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');
  check('모델에게도 이유를 그대로 말한다', /규칙 Bash\(\*echo\*\) 으로 막혀/.test(도구말), 도구말.slice(0, 80));

  // (3) 허락되면 strict 에서도 안 묻는다.
  rmSync(흔적, { force: true });
  let 물어본횟수 = 0;
  {
    const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 32768, tools: true };
    const s = new Session(conn, { root });
    s.mode = 'strict';
    불린것 = 0;
    const ctx = {
      scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set(),
      규칙들: { allow: [{ ...규칙읽기('Bash(*echo*)'), 출처: '설정' }], deny: [] },
      confirm: async () => { 물어본횟수 += 1; return true; },
    };
    ctx.history.nextTurn();
    for await (const ev of run(s, ctx, '파일 하나 만들어줘')) { void ev; }
  }
  check('허락된 것은 strict 에서도 안 묻는다', 물어본횟수 === 0, `${물어본횟수}번 물음`);
  check('허락된 것은 실제로 돈다', existsSync(흔적), '명령이 안 돌았습니다');

  // (4) 금지는 '예' 라고 답하는 사람도 못 뚫는다. 물어보는 것은 막는 것이 아니다.
  rmSync(흔적, { force: true });
  물어본횟수 = 0;
  {
    const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 32768, tools: true };
    const s = new Session(conn, { root });
    s.mode = 'strict';
    불린것 = 0;
    const ctx = {
      scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set(),
      규칙들: { allow: [{ ...규칙읽기('Bash'), 출처: '설정' }], deny: [{ ...규칙읽기('Bash(*echo*)'), 출처: '설정' }] },
      confirm: async () => { 물어본횟수 += 1; return true; },
    };
    ctx.history.nextTurn();
    for await (const ev of run(s, ctx, '파일 하나 만들어줘')) { void ev; }
  }
  check('금지는 물어보지도 않는다', 물어본횟수 === 0, `${물어본횟수}번 물음`);
  check('금지는 예라고 해도 안 돈다', !existsSync(흔적), '파일이 생겼습니다');

  server.close();
}

// ── 6. 정책이 설정을 이긴다 (load 를 거쳐서) ──────────────────────────
trace('6-덮기');
{
  const 집 = mkdtempSync(join(tmpdir(), 'deel-pol-home-'));
  const 정책파일 = join(집, 'policy.json');
  writeFileSync(정책파일, JSON.stringify({
    baseUrl: 'https://정책이정한곳.example/v1',
    offline: true,
    permissions: { deny: ['Bash(curl*)'] },
  }), 'utf8');
  writeFileSync(join(집, 'config.json'), JSON.stringify({
    profiles: [{ id: 'a', name: 'a', kind: 'openai', baseUrl: 'https://사용자가적은곳.example/v1', auth: 'none', model: 'm' }],
    active: 'a',
    offline: false,
    permissions: { deny: ['WebFetch'] },
  }), 'utf8');

  const 앞집 = process.env.DEEL_HOME;
  const 앞정책 = process.env.DEEL_POLICY;
  process.env.DEEL_HOME = 집;
  process.env.DEEL_POLICY = 정책파일;
  정책잊기();
  const { load } = await import('../src/config.js');
  const cfg = load();

  check('정책이 주소를 못박는다', cfg.profiles[0].baseUrl === 'https://정책이정한곳.example/v1', cfg.profiles[0].baseUrl);
  check('무엇이 못박았는지 남겨 둔다', cfg.정책주소 === 'https://정책이정한곳.example/v1', cfg.정책주소);
  check('정책은 오프라인을 켤 수 있다', cfg.offline === true, String(cfg.offline));
  check('사용자 금지는 그대로 살아 있다', cfg.permissions.deny.includes('WebFetch'), JSON.stringify(cfg.permissions.deny));
  check('정책 금지가 더해진다', cfg.permissions.deny.includes('Bash(curl*)'), JSON.stringify(cfg.permissions.deny));

  // 정책은 넓히지 못한다 — offline 을 끄지도, 사용자 금지를 지우지도 못한다.
  writeFileSync(정책파일, JSON.stringify({ offline: false }), 'utf8');
  writeFileSync(join(집, 'config.json'), JSON.stringify({
    profiles: [], active: null, offline: true, permissions: { deny: ['WebFetch'] },
  }), 'utf8');
  정책잊기();
  const cfg2 = load();
  check('정책이 오프라인을 끄지는 못한다', cfg2.offline === true, String(cfg2.offline));
  check('정책이 사용자 금지를 지우지 못한다', cfg2.permissions.deny.includes('WebFetch'), JSON.stringify(cfg2.permissions.deny));

  if (앞집 === undefined) delete process.env.DEEL_HOME; else process.env.DEEL_HOME = 앞집;
  if (앞정책 === undefined) delete process.env.DEEL_POLICY; else process.env.DEEL_POLICY = 앞정책;
  정책잊기();
  setOffline(false);
  check('검사가 오프라인을 끄고 나간다', isOffline() === false);
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n규칙·정책 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;

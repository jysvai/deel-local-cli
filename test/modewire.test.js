/**
 * 모드가 **전선까지** 가는가 — 진짜 프로세스로.
 *
 * ── 왜 따로 재나 ────────────────────────────────────────────────────────
 *
 * 조각은 저마다 이미 재고 있다. route.test.js 는 「이 말이 이 모드로 간다」
 * 를 재고, modes.test.js 는 「그 모드에 이 도구가 없다」 를 재고, wire.test.js
 * 는 「몸통에 이 칸이 실린다」 를 잰다. 셋 다 파랬다.
 *
 * 그런데 사람이 겪은 고장은 그 사이에 있었다 —
 *
 *   「분석해서 … 찾아줘」 라고 쳤더니 묻기 모드로 갔고, 묻기는 짧게 답하고
 *     얕게 생각하고 열두 걸음에서 멈추는 모드라, 파일 열 개를 훑어야 하는
 *     일이 절반쯤 보고 끝났다. 화면에는 아무 표시도 없었다.
 *
 * 조각마다 맞는데 이어 붙인 것이 틀리는 자리다. 그래서 여기서는 **진짜
 * deel 을 자식으로 띄우고** 스텁 게이트웨이 앞에 세워, 한 번 친 말이
 * 시킴말·생각 강도·도구 목록·머리말까지 어떻게 도착하는지 그대로 본다.
 *
 * ── 여기서만 잡히는 것 ──────────────────────────────────────────────────
 *
 *   · 대화 이름이 **모든 요청**에 같은 값으로 나가나 (안 나가면 게이트웨이가
 *     요청마다 새 대화를 열고, 창구가 여럿이면 그때마다 캐시가 식는다)
 *   · 읽기만 하는 모드에 고치는 도구가 정말 안 실리나 (프롬프트가 아니라 몸통)
 *   · `--work 점검` 처럼 사람이 직접 고른 것이 그대로 나가나
 *
 * 바깥으로 나가는 연결은 없다. 전부 127.0.0.1 이다.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 진입점 = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'deel.js');

trace('1-스텁');

// ── 스텁 게이트웨이 ─────────────────────────────────────────────────────
const 받은요청 = [];
const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let 몸 = null;
    try { 몸 = JSON.parse(body); } catch { /* GET 은 몸이 없다 */ }
    const url = req.url.split('?')[0];
    const 보냄 = (o, code = 200) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    if (url === '/v1/models') return 보냄({ data: [{ id: '스텁모델', object: 'model' }] });
    if (url.endsWith('/chat/completions')) {
      받은요청.push({ 머리: req.headers, 몸 });
      // 도구를 안 부르고 한 번에 끝낸다. 여기서 재는 것은 「무엇이 나갔나」 지
      // 「몇 걸음 도나」 가 아니다 — 걸음 수는 budget.js 가 따로 잰다.
      return 보냄({
        id: 'x',
        object: 'chat.completion',
        model: '스텁모델',
        choices: [{ index: 0, message: { role: 'assistant', content: '확인했습니다.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      });
    }
    return 보냄({ error: { message: `모르는 문: ${url}` } }, 404);
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/v1`;

// ── 임시 살림 ───────────────────────────────────────────────────────────
//
// DEEL_HOME 은 설정 '폴더' 그 자체다 (oneshot.test.js 와 같은 규칙).
const home = mkdtempSync(join(tmpdir(), 'deel-modewire-home-'));
const work = mkdtempSync(join(tmpdir(), 'deel-modewire-work-'));
mkdirSync(join(work, 'src'), { recursive: true });
writeFileSync(join(work, 'src', 'collab.js'), '// 공동작업 상태\nlet 판 = 0;\n', 'utf8');
writeFileSync(join(home, 'config.json'), JSON.stringify({
  version: 1,
  active: 'stub',
  level: '개발자',
  profiles: [{
    id: 'stub', name: '스텁 연결', kind: 'openai',
    baseUrl: base, auth: 'none', apiKey: '', model: '스텁모델',
    // 창을 크게 잡는다 — 좁으면 모드 글이 짧은 판으로 갈려서 무엇을 재는지 흐려진다.
    ctx: 200000, streaming: false, tools: true, json: true, think: 'medium',
  }],
}, null, 2), 'utf8');

/**
 * deel 을 띄우고 끝날 때까지 기다린다.
 *
 * 시간 제한을 반드시 둔다. 여기서 안 끝난다는 것은 어딘가에서 사람을
 * 기다린다는 뜻이고, 그게 바로 이 검사가 잡아야 할 결함이다.
 */
function 띄우기(인자, { 제한 = 40000 } = {}) {
  return new Promise((done) => {
    const kid = spawn(process.execPath, [진입점, ...인자], {
      cwd: work,
      env: { ...process.env, DEEL_HOME: home, NO_COLOR: '1', COLUMNS: '110', DEEL_TRACE: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    kid.stdout.on('data', (d) => (out += d));
    kid.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => kid.kill('SIGKILL'), 제한);
    kid.on('close', (code) => { clearTimeout(t); done({ out, err, code }); });
    kid.stdin.end();
  });
}

/** 이번에 나간 시킴말. 모드 글이 여기 실린다. */
const 시킴말 = () => 받은요청[0]?.몸?.messages?.find((m) => m.role === 'system')?.content ?? '';
const 도구이름 = () => (받은요청[0]?.몸?.tools ?? []).map((t) => t.function?.name ?? t.name);

// ══ 1. 한 번 친 말이 어느 모드로 도착하나 ═══════════════════════════════
trace('2-모드도착');
{
  const 볼것 = [
    // 이 첫 줄이 이 검사가 생긴 까닭이다. 여태 묻기로 갔다.
    ['공동작업 기능을 분석해서 동시 편집 시 데이터 손실이 날 자리를 찾아줘.\n각 문제마다 파일과 함수를 설명해줘.\n코드는 수정하지 마.\n최대 5개까지만 찾아줘.', '점검'],
    ['보안 취약점 점검해줘', '점검'],
    ['src/collab.js 가 뭐 하는 파일이야?', '설명'],
    ['로그인이 왜 안 되는지 원인 찾아줘', '원인 찾기'],
    ['이 폴더 구조를 어떻게 나누면 좋을지 설계해줘', '설계'],
  ];
  for (const [글, 실릴말] of 볼것) {
    받은요청.length = 0;
    await 띄우기(['run', 글]);
    const 한줄 = 글.split('\n')[0].slice(0, 26);
    check(`★ "${한줄}…" → **${실릴말}** 이 전선에 실린다`,
      시킴말().includes(`지금 하는 일은 **${실릴말}**`),
      (시킴말().match(/지금 모드: (\S+)/) ?? [])[1] ?? '(모드 줄 없음)');
  }
}

// ══ 2. 점검 모드가 실제로 깊게 · 읽기만 ═════════════════════════════════
//
// ★★ 모드를 바꿔 봐야 실제로 달라지지 않으면 아무 의미가 없다.
trace('3-점검실체');
{
  받은요청.length = 0;
  await 띄우기(['run', '공동작업 쪽에 경합 조건 있는지 훑어봐줘. 근거 있는 것만 찾아줘.']);
  check('★★ 점검은 얕게 안 본다', 받은요청[0]?.몸?.reasoning_effort === 'high',
    String(받은요청[0]?.몸?.reasoning_effort));
  const 바꾸는것 = 도구이름().filter((n) => ['Write', 'Edit', 'Bash', 'Move', 'Append'].includes(n));
  check('★★ 점검에는 파일 바꾸는 도구가 몸통에 아예 안 실린다', 바꾸는것.length === 0,
    바꾸는것.join(',') || `실린 것 ${도구이름().length}개`);
  check('읽는 도구는 그대로 실린다', 도구이름().includes('Read') && 도구이름().includes('Grep'),
    도구이름().join(','));
}

// ══ 3. 묻기가 낮추는 자리는 그대로 두고, 무거운 말만 안 낮춘다 ══════════
//
// ★★ 여기가 조용히 제일 비쌌던 자리다. 묻기의 low 자체는 옳다 — 틀린 것은
//     「시킨 것이 넷인 말」 까지 그 값으로 돌던 것이다.
trace('4-강도');
{
  받은요청.length = 0;
  await 띄우기(['run', 'src/collab.js 가 뭐 하는 파일이야?']);
  check('★ 한 줄 물음은 여전히 얕게 본다', 받은요청[0]?.몸?.reasoning_effort === 'low',
    String(받은요청[0]?.몸?.reasoning_effort));

  받은요청.length = 0;
  await 띄우기(['run', '이 프로젝트 상태 관리가 뭐 하는 코드인지 설명해줘.\n어디서 어긋날 수 있는지도 같이 짚어줘.\n고치지는 마.']);
  const 강도 = 받은요청[0]?.몸?.reasoning_effort;
  check('★★ 시킨 것이 여럿이면 묻기라도 안 낮춘다', 강도 && 강도 !== 'low', String(강도));
}

// ══ 4. 대화 이름이 머리로, 모든 요청에 같은 값으로 ══════════════════════
trace('5-대화이름');
{
  받은요청.length = 0;
  await 띄우기(['run', '한 줄로만 답해줘']);
  const 이름들 = 받은요청.map((x) => x.머리['x-litellm-session-id']);
  check('★★ 대화 이름이 머리로 나간다', 이름들.length > 0 && !!이름들[0], JSON.stringify(이름들[0]));
  check('대화 번호만 담는다 (경로·이름·열쇠 없음)', /^deel-[A-Za-z0-9_-]+$/.test(이름들[0] ?? ''),
    String(이름들[0]));
  check('★ 요청이 여럿이어도 한 가지 이름', new Set(이름들).size === 1,
    `${이름들.length}번 · ${new Set(이름들).size}가지`);
  check('우리 이름표로도 같이 나간다', 받은요청[0]?.머리['x-deel-session-id'] === 이름들[0],
    String(받은요청[0]?.머리['x-deel-session-id']));
  /*
   * ★★ 그러면서 몸통은 그대로다.
   *
   * 이름을 몸통에 실으면 모르는 칸에 엄격한 게이트웨이에서 그 턴이 400 이다.
   * 머리로 보내는 까닭이 그것이고, 그 약속을 여기서 지킨다.
   */
  const 몸칸 = Object.keys(받은요청[0]?.몸 ?? {});
  check('★★ 몸통에는 이름을 안 싣는다', !몸칸.includes('user') && !몸칸.includes('prompt_cache_key'),
    몸칸.sort().join(','));
}

// ══ 5. 사람이 직접 고른 것은 그대로 나간다 ══════════════════════════════
trace('6-직접고르기');
{
  for (const 이름 of ['inspect', '점검']) {
    받은요청.length = 0;
    const r = await 띄우기(['run', '--work', 이름, '이 폴더 훑어봐']);
    check(`★ --work ${이름} 이 그대로 전선까지 간다`,
      시킴말().includes('지금 하는 일은 **점검**'),
      r.code === 0 ? ((시킴말().match(/지금 모드: (\S+)/) ?? [])[1] ?? '(모드 줄 없음)') : `종료코드 ${r.code}`);
  }
}

// ══ 6. doc2md 가 터미널에서 도나 ════════════════════════════════════════
trace('7-doc2md');
{
  const pdf = join(dirname(fileURLToPath(import.meta.url)), '자료', '진짜-크롬.pdf');
  const r = await 띄우기(['doc2md', pdf]);
  check('★ doc2md 가 마크다운을 낸다',
    /^# 진짜-크롬\.pdf$/m.test(r.out) && /^## 1쪽$/m.test(r.out),
    r.out.split('\n')[0]);
  // 글은 표준출력, 말은 표준오류. `> 보고서.md` 로 받아도 안 섞여야 한다.
  check('마크다운만 표준출력으로 나간다', !/잘랐습니다/.test(r.out), r.out.slice(-40).trim());

  const 나쁨 = await 띄우기(['doc2md', join(work, 'src', 'collab.js')]);
  check('★ 못 바꾸는 갈래는 그렇게 말하고 1 로 끝난다',
    나쁨.code === 1 && /갈래가 아닙니다/.test(`${나쁨.out}${나쁨.err}`),
    `${나쁨.code} · ${`${나쁨.out}${나쁨.err}`.trim().split('\n')[0]}`);
}

// ── 마무리 ──────────────────────────────────────────────────────────────
trace('8-치움');
srv.close();
rmSync(home, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n모드→전선 검사  ${D}(한 번 친 말이 시킴말·강도·도구·머리말까지 어떻게 도착하는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

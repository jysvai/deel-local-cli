// 감사기록이 **무엇을** 적나.
//
// 이 파일이 파는 문장은 「무엇을 언제 어떻게 했는지 전부 남는다」 이고,
// /mcp 화면은 대놓고 `.deel/audit.jsonl 에 남습니다` 라고 적어 준다.
// 그런데 그 '전부' 에 열쇠까지 들어가면, 지키려던 것을 우리 손으로 적어
// 두는 셈이 된다. 도구 결과는 loop.js 가 가려서 대화에 싣는데, 감사기록에
// 적히는 `target` 은 그 길을 안 지나간다 — Bash 명령줄이 **적힌 그대로**
// 들어갔다. `curl -H "Authorization: Bearer …"` 한 줄이면 그 헤더가
// audit.jsonl 에 평문으로 남는다.
//
// 여기서 재는 것:
//   1) 적히는 글에서 비밀이 가려지나 (명령줄·요약·사람이 친 말)
//   2) 그래도 무엇을 했는지는 읽히나 — 다 지워 버리면 기록이 쓸모없어진다
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from './trace.mjs';

// 진짜 설정을 안 건드리게 **불러오기 전에** 자리부터 옮긴다.
const 집 = mkdtempSync(join(tmpdir(), 'deel-audit-'));
process.env.DEEL_HOME = 집;

const { Audit } = await import('../src/safety/audit.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 새기록 = (opts) => new Audit(mkdtempSync(join(tmpdir(), 'deel-audit-방-')), opts);
const 적힌글 = (a) => readFileSync(a.file, 'utf8');

trace('1-명령줄');

/*
 * ── 명령줄이 그대로 적히던 자리 ─────────────────────────────────────────
 *
 * 모델이 부르는 Bash 는 열쇠를 달고 다닌다 — 헤더에 붙이거나, 환경변수로
 * 넘기거나, 주소 안에 박아서. 그 명령줄이 target 으로 통째로 적혔다.
 */
{
  const a = 새기록();
  const 진짜열쇠 = 'sk-FAKEfake0123456789abcdefghij';
  a.tool('Bash', { command: `curl -H "Authorization: Bearer ${진짜열쇠}" https://x/api` }, {});
  const 글 = 적힌글(a);

  check('★ 명령줄의 열쇠가 감사기록에 안 남는다', !글.includes(진짜열쇠), 글.trim().slice(0, 160));
  check('★ 가렸다는 표는 남는다 (조용히 지우지 않는다)', 글.includes('«가림:'), 글.trim().slice(0, 160));
  check('무엇을 했는지는 그대로 읽힌다', /curl/.test(글) && /"tool":"Bash"/.test(글), 글.trim().slice(0, 120));
}

{
  // 주소에 박힌 것, 환경변수 꼴, 깃 원격 꼴 — 새는 자리는 명령마다 다르다.
  const a = 새기록();
  a.tool('Bash', { command: 'git remote add origin https://사람:ghp_0123456789abcdefghij@github.com/x/y.git' }, {});
  a.tool('Bash', { command: 'DEEL_API_KEY=sk-FAKEfake0123456789abcdefghij node x.js' }, {});
  const 글 = 적힌글(a);
  check('★ 주소 안에 박힌 것도 가린다', !글.includes('ghp_0123456789abcdefghij'), 글.split('\n')[0].slice(0, 160));
  check('★ 환경변수 꼴도 가린다', !글.includes('sk-FAKEfake0123456789abcdefghij'), 글.split('\n')[1]?.slice(0, 160) ?? '');
  check('누구 계정인지는 남는다 (모르면 사람이 손을 못 쓴다)', /사람/.test(글), 글.split('\n')[0].slice(0, 160));
}

trace('2-설정에든열쇠');

/*
 * 짐작으로 잡는 규칙은 사내 게이트웨이가 주는 이상한 꼴을 못 알아본다.
 * 그런데 우리는 그 값을 **알고 있다** — 설정에 적힌 그 열쇠다.
 * 대화 쪽(loop.js)은 그 아는 값을 먼저 지운다. 감사기록도 같은 것을 봐야 한다.
 */
{
  const 아는열쇠 = 'DEELGW-사내-9f8e7d6c5b4a';
  const a = 새기록({ 열쇠들: [아는열쇠] });
  a.tool('Bash', { command: `deel-probe --key ${아는열쇠}` }, {});
  const 글 = 적힌글(a);
  check('★ 설정에 든 열쇠는 꼴을 몰라도 지운다', !글.includes(아는열쇠), 글.trim().slice(0, 160));

  // 열쇠는 판 도중에 바뀐다(/model 로 갈아타면 conn 이 통째로 바뀐다).
  // 그래서 값이 아니라 **묻는 길**을 받아 둔다.
  let 지금열쇠 = '첫열쇠-aaaa1111bbbb2222';
  const b = 새기록({ 열쇠들: () => [지금열쇠] });
  지금열쇠 = '바뀐열쇠-cccc3333dddd4444';
  b.tool('Bash', { command: `curl -u ${지금열쇠} https://x` }, {});
  check('★ 판 도중에 바뀐 열쇠도 지운다', !적힌글(b).includes(지금열쇠), 적힌글(b).trim().slice(0, 160));
}

trace('3-다른자리');

{
  // 결과 요약·사람이 친 말·막힌 명령. 자유롭게 적히는 글은 전부 같은 길을 지난다.
  const a = 새기록();
  const 열쇠 = 'sk-FAKEfake0123456789abcdefghij';
  a.tool('Bash', { command: 'npm test' }, { error: `401 — Authorization: Bearer ${열쇠} 로 거절됐습니다` });
  a.turn(`이 열쇠로 붙여줘: ${열쇠}`);
  a.blocked('되돌릴 수 없는 명령입니다', `curl -H "X-Api-Key: ${열쇠}" https://x`);
  const 글 = 적힌글(a);
  check('★ 실패 요약에서도 가린다', !글.split('\n')[0].includes(열쇠), 글.split('\n')[0].slice(0, 160));
  check('★ 사람이 친 말에서도 가린다', !글.split('\n')[1].includes(열쇠), 글.split('\n')[1].slice(0, 160));
  check('★ 막힌 명령에서도 가린다', !글.split('\n')[2].includes(열쇠), 글.split('\n')[2].slice(0, 160));
  check('막힌 까닭은 그대로 읽힌다', /되돌릴 수 없는/.test(글), '');
}

{
  // 반대쪽. 가릴 것이 없는 평범한 기록은 한 글자도 안 달라져야 한다 —
  // 여기서 넓게 잡으면 「무엇을 했는지」 가 «가림» 으로 뭉개진다.
  const a = 새기록();
  a.tool('Read', { file_path: 'C:/일/보고서.md' }, { summary: '120줄' });
  a.tool('Bash', { command: 'git log --oneline -5' }, { summary: '5줄' });
  const 글 = 적힌글(a);
  check('★ 평범한 기록은 안 건드린다', !글.includes('«가림'), 글.trim().slice(0, 160));
  check('경로가 그대로 남는다', 글.includes('C:/일/보고서.md'), 글.split('\n')[0].slice(0, 120));
  check('돌린 명령이 그대로 남는다', 글.includes('git log --oneline -5'), 글.split('\n')[1].slice(0, 120));
}

trace('4-파일권한');

/*
 * ── 이 파일을 아무나 읽으면 안 된다 ─────────────────────────────────────
 *
 * 가리기를 지나도 여기에는 무엇을 언제 어디서 했는지가 남는다 — 파일 경로,
 * 돌린 명령, 사람이 친 말. 설정 파일은 config.js 가 만들 때 0600 을 걸어 두는데
 * 감사기록에는 그게 없었다. 같은 PC 를 여럿이 쓰거나 홈이 공유 폴더에 있으면
 * 그대로 읽힌다.
 *
 * 윈도우(NTFS)에서는 chmod 가 아무 일도 안 한다 — 권한이 ACL 로 정해지기
 * 때문이다. 그래서 거기서는 모드를 재지 않는다. **재는 척도 하지 않는다** —
 * 이 프로그램이 열쇠 보관에 대해 정해 둔 규칙과 같다.
 */
{
  const a = 새기록();
  a.tool('Bash', { command: 'npm test' }, { summary: '다 통과' });
  // 건 결과는 어느 판에서든 밖에서 보여야 한다. 윈도우는 chmod 가 아무 일도 안 하고
  // 성공하므로 거기서 「걸었다」 가 나오면 잠근 척이다 — 안 걸었다고 적혀야 맞다.
  check(process.platform === 'win32' ? '★ 윈도우에서는 감사기록을 잠갔다고 적지 않는다' : '★ 감사기록에 0600 을 건다',
    process.platform === 'win32' ? a.잠금?.못함 === 'windows' && a.잠금?.모드 === undefined : a.잠금?.모드 === 0o600,
    JSON.stringify(a.잠금));
  check('파일이 실제로 있다 (건 자리가 허공이 아니다)', existsSync(a.file), a.file);
  if (process.platform === 'win32') {
    check('윈도우에서는 모드를 안 잰다 (NTFS 는 ACL 이라 chmod 가 아무 일도 안 한다)',
      a.못쓴것() === null, JSON.stringify(a.못쓴것()));
  } else {
    const 모드 = statSync(a.file).mode & 0o777;
    check('★ 감사기록이 정말 0600 이다', 모드 === 0o600, '0' + 모드.toString(8));
  }
  // 어느 판에서든 잠그느라 기록을 잃으면 안 된다.
  a.tool('Bash', { command: 'git status' }, {});
  check('잠근 뒤에도 계속 적힌다', readFileSync(a.file, 'utf8').trim().split('\n').length === 2,
    readFileSync(a.file, 'utf8').trim().split('\n').length + '줄');
}

trace('5-반쪽줄');

/*
 * ── 반쪽 줄 뒤에 이어 적으면 다음 기록이 통째로 사라졌다 ─────────────────
 *
 * 적는 도중에 죽으면 마지막 줄이 개행 없이 반만 남는다. 다음 판이 그 뒤에
 * 그대로 이어 적으면 새 기록이 반쪽에 **붙어** 한 줄이 되고, 그 줄은 JSON 이
 * 아니라 읽을 때 통째로 버려진다 — 다음 판이 한 첫 일이 기록에서 없어진다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-audit-반쪽-'));
  const a = new Audit(방);
  a.tool('Bash', { command: 'echo 하나' }, {});
  const { appendFileSync } = await import('node:fs');
  appendFileSync(a.file, '{"at":"2026-09-', 'utf8');          // 적다가 죽은 자리
  const b = new Audit(방);                                     // 다음 판
  b.tool('Bash', { command: 'echo 둘' }, {});
  b.tool('Bash', { command: 'echo 셋' }, {});
  const 본것 = b.recent(10).map((x) => x.target);
  check('★★ 반쪽 줄 뒤의 첫 기록이 안 사라진다', JSON.stringify(본것) === JSON.stringify(['echo 하나', 'echo 둘', 'echo 셋']),
    JSON.stringify(본것));
  // 멀쩡한 파일에는 빈 줄을 끼우지 않는다 — 줄마다 파일 끝을 재지도 않는다.
  const c = new Audit(방);
  c.tool('Bash', { command: 'echo 넷' }, {});
  check('  멀쩡하게 끝난 파일에는 빈 줄을 안 끼운다', !/\n\n/.test(readFileSync(c.file, 'utf8')),
    JSON.stringify(readFileSync(c.file, 'utf8').slice(-80)));
}

/*
 * ── 적기가 한 번 막힌 뒤 반쪽 줄 뒤에 붙였다 (6회차 Gemini 감사6aa C2) ─────
 *
 * 끝을 본 표시를 적기 **전에** 세워서, 다음 판의 첫 적기가 막히면(읽기 전용 ·
 * 잠김 · 디스크 가득) 그다음 기록이 개행 없이 반쪽 줄 뒤에 붙었다. 못쓴수 에는
 * 막힌 한 건만 오르고, 붙은 기록은 적었다고 친 채 읽을 때 통째로 버려진다.
 * agent/store.js 의 같은 자리(저장6w X1)와 같은 까닭이다.
 */
{
  const { appendFileSync: 붙이기, chmodSync: 모드 } = await import('node:fs');
  const 방 = mkdtempSync(join(tmpdir(), 'deel-audit-막힘-'));
  const a = new Audit(방);
  a.tool('Bash', { command: 'echo 하나' }, {});
  붙이기(a.file, '{"at":"2026-09-', 'utf8');
  const b = new Audit(방);
  모드(b.file, 0o444);
  b.tool('Bash', { command: 'echo 막힘' }, {});
  모드(b.file, 0o644);
  const 막혔나 = b.못쓴수 === 1;
  b.tool('Bash', { command: 'echo 둘' }, {});
  const 본것 = b.recent(10).map((x) => x.target);
  if (막혔나) {
    check('★ (6회차 감사6aa C2) 적기가 한 번 막힌 뒤에도 다음 기록을 반쪽 줄 뒤에 붙이지 않는다',
      본것.includes('echo 하나') && 본것.includes('echo 둘'), JSON.stringify(본것));
  } else {
    console.log('  (C2 판은 읽기 전용이 적기를 안 막는 환경이라 건너뜀 — 관리자 권한 등)');
  }
}

trace('6-막힌까닭-가리기');

/*
 * ── 막힌 까닭에 명령줄이 통째로 들어 있었다 ─────────────────────────────
 *
 * guard 가 던지는 말은 막은 명령의 앞 120자를 그대로 담는다. what 은 가렸는데
 * why 는 안 가려서, `Authorization: Bearer ghp_…` 가 까닭 칸에 평문으로 남았다.
 */
{
  const a = 새기록();
  const 토큰 = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  a.blocked(`되돌릴 수 없는 명령입니다: curl -H "Authorization: Bearer ${토큰}" https://x && rm -rf /`, 'rm -rf /');
  const 글 = 적힌글(a);
  check('★★ 막힌 까닭 칸에서도 열쇠를 가린다', !글.includes(토큰), 글.trim().slice(0, 200));
  check('  막힌 까닭 자체는 읽힌다', /되돌릴 수 없는/.test(글), '');
  const b = 새기록({ 열쇠들: ['DEELGW-사내-0f9e8d7c6b5a'] });
  b.blocked('게이트웨이 열쇠 DEELGW-사내-0f9e8d7c6b5a 가 든 명령', 'x');
  check('★ 설정에 든 열쇠도 까닭 칸에서 가린다', !적힌글(b).includes('DEELGW-사내-0f9e8d7c6b5a'), 적힌글(b).trim().slice(0, 160));
}

trace('7-자르기전에-가리기');

/*
 * ── 자른 뒤에 가리면 잘린 꼬리가 새었다 ─────────────────────────────────
 *
 * 사람 말은 500자, 막힌 명령은 300자로 자른다. 자르기가 먼저면 열쇠가 그 선에
 * 걸쳤을 때 앞 조각만 남는다 — 정확히 아는 열쇠라도 **통째가 아니면** 못 알아본다.
 */
{
  const 아는열쇠 = 'gw-live-0123456789abcdef0123456789abcdef';
  const a = 새기록({ 열쇠들: [아는열쇠] });
  a.turn('가'.repeat(480) + ' ' + 아는열쇠);
  a.blocked('규칙', 'y'.repeat(280) + ' ' + 아는열쇠);
  const 글 = 적힌글(a);
  const 앞조각 = 아는열쇠.slice(0, 12);
  check('★★ 사람 말의 자르는 선에 걸친 열쇠도 조각이 안 남는다', !글.split('\n')[0].includes(앞조각), 글.split('\n')[0].slice(-60));
  check('★★ 막힌 명령의 자르는 선에 걸친 열쇠도 조각이 안 남는다', !글.split('\n')[1].includes(앞조각), 글.split('\n')[1].slice(-60));
  const 긴말 = JSON.parse(글.split('\n')[0]).text;
  check('  그래도 500자 선은 지킨다', 긴말.length <= 500, String(긴말.length));
}

trace('8-세션이름');

/*
 * 같은 초에 만든 두 기록이 세션 이름을 나눠 가졌다. `deel stats` 는 세션을
 * 이름으로 세므로, 창 두 개를 한꺼번에 띄우면 한 세션으로 뭉쳐 보였다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-audit-세션-'));
  const 이름들 = Array.from({ length: 5 }, () => new Audit(방).session);
  check('★ 같은 순간에 만든 기록끼리 세션 이름이 안 겹친다', new Set(이름들).size === 5, 이름들.join(' · '));
  check('  세션 이름은 여전히 시각으로 시작한다 (사람이 읽는다)', /^\d{4}-\d{2}-\d{2}\d{6}/.test(이름들[0]), 이름들[0]);
}

trace('8b-최근0줄');

/*
 * ★ `recent(0)` 이 **전부** 돌려줬다 (8회차 판정 audit.js:235).
 *
 * `slice(-0)` 은 `slice(0)` 이라 통째로 나온다. 0 을 넘기는 호출부는 지금 없지만,
 * 이 함수가 내주는 줄은 `deel audit` 화면·증거모으기·`deel stats` 로 곧장 간다 —
 * 「최근 0줄만 보자」 가 32MB 를 통째로 읽어 오는 것은 부르는 쪽이 못 알아챈다.
 * 음수도 같은 말로 친다. 「몇 줄」 이 0 이하면 내줄 줄이 없다.
 */
{
  const a = 새기록();
  for (let i = 0; i < 5; i++) a.write('tool', { tool: `t${i}` });
  check('★★ recent(0) 은 한 줄도 안 돌려준다', a.recent(0).length === 0, `${a.recent(0).length}줄`);
  check('  음수도 마찬가지다', a.recent(-3).length === 0, `${a.recent(-3).length}줄`);
  check('  적은 수는 그대로 뒤에서 센다', a.recent(2).map((x) => x.tool).join(',') === 't3,t4', a.recent(2).map((x) => x.tool).join(','));
  check('  기본값은 그대로 최근 20줄까지다', a.recent().length === 5, `${a.recent().length}줄`);
}

trace('9-살림폴더못만듦');

/*
 * ★ (6회차 C3) 작업 폴더에 .deel 을 못 만들면 원시 오류 한 줄만 보였다.
 *
 * 같은 이름의 파일이 있거나 읽기 전용 폴더면 감사기록·되돌리기 이력이 생성자에서
 * 막힌다. 대화 화면·deel -p·에디터 셋 다 안 죽기는 했지만 「EEXIST: file already
 * exists, mkdir '…\.deel'」 만 떴다 — 무엇이 막혔고 어떻게 하면 되는지가 없었다.
 * 기록 없이 조용히 켜지면 안 되니 **던지는 것은 그대로** 두고 말만 사람 말로.
 */
{
  const { writeFileSync } = await import('node:fs');
  const { History } = await import('../src/safety/undo.js');
  const 방 = mkdtempSync(join(tmpdir(), 'deel-audit-살림파일-'));
  writeFileSync(join(방, '.deel'), '폴더가 아니라 파일\n', 'utf8');
  const 던진말 = (만들기) => { try { 만들기(); return '(안 던짐)'; } catch (err) { return String(err?.message ?? err); } };
  const 감사말 = 던진말(() => new Audit(방));
  const 이력말 = 던진말(() => new History(방));
  check('★ (6회차 C3) .deel 을 못 만들면 감사기록이 까닭과 길을 말한다',
    /살림 폴더를 만들지 못했습니다/.test(감사말) && /같은 이름의 파일/.test(감사말), 감사말);
  check('★ (6회차 C3) 되돌리기 이력도 같은 말을 한다',
    /살림 폴더를 만들지 못했습니다/.test(이력말) && /같은 이름의 파일/.test(이력말), 이력말);
  check('(C3 짝) 여전히 던진다 — 기록 없이 조용히 켜지지 않는다', 감사말 !== '(안 던짐)' && 이력말 !== '(안 던짐)', `${감사말} | ${이력말}`);
  rmSync(방, { recursive: true, force: true });
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n감사기록 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? D + '  ' + p.note + X : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
rmSync(집, { recursive: true, force: true });
process.exitCode = fail.length ? 1 : 0;

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
  // 이 한 줄은 어느 판에서든 잰다 — 걸었다는 사실 자체는 밖에서 보여야 한다.
  check('★ 감사기록에 0600 을 건다', a.잠금?.모드 === 0o600, JSON.stringify(a.잠금));
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

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n감사기록 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? D + '  ' + p.note + X : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
rmSync(집, { recursive: true, force: true });
process.exitCode = fail.length ? 1 : 0;

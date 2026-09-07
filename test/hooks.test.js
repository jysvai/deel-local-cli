/**
 * 훅 검사 — 사람이 적어 둔 명령이 정말 그 자리에서, 그 규칙대로 도는가.
 *
 * ── 흉내로 안 되는 것과 되는 것 ─────────────────────────────────────────
 *
 * 무늬 짓기·설정 펴기·막힘 판단은 순수한 셈이라 흉내로 다 잰다. 그런데
 * **정말 도는가**는 아니다. 셸을 거치는지, stdin 으로 넣은 JSON 이 자식에게
 * 닿는지, 시한이 걸리는지, 죽은 명령이 어떻게 오는지 — 여기는 진짜 자식
 * 프로세스를 띄워야 잰다. MCP 검사가 진짜 서버를 띄우는 것과 같은 이유다.
 *
 * ── 여기서 제일 중요한 검사 ─────────────────────────────────────────────
 *
 *   · 안 믿는 폴더의 hooks.json 은 **안 읽는다** — clone 한 번이 곧 남의
 *     명령이 내 PC 에서 도는 것이 되면 안 된다.
 *   · 고장난 훅은 **막는다** — 문지기가 쓰러져 있으면 문은 잠긴 게 아니다.
 *   · 모델이 만든 글은 **명령줄에 안 들어간다** — 전부 stdin 이다.
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  훅읽기, 훅펴기, 훅돌리기, 자리돌리기, 고를것, 걸리나, 무늬짓기, 막힘말, 훅줄들,
  자리들, 막는자리, 제한기본, 프로젝트자리, 이PC자리,
} from '../src/safety/hooks.js';
import { 믿기, 안믿기 } from '../src/safety/trust.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-hooks-'));
const 집 = mkdtempSync(join(tmpdir(), 'deel-hooks-home-'));
mkdirSync(join(root, '.deel'), { recursive: true });
mkdirSync(join(집, '.deel'), { recursive: true });

const 적기 = (자리, o) => writeFileSync(자리, JSON.stringify(o, null, 2), 'utf8');
const 지우기 = (자리) => { try { rmSync(자리); } catch { /* 없으면 됐다 */ } };
/*
 * 믿는 폴더 목록은 이 PC 의 진짜 자리에 적힌다. 검사가 그걸 건드리면 사람의
 * 설정을 망친다. 그래서 신뢰 자리도 임시 폴더로 옮겨 놓고 잰다.
 */
const 환경 = { ...process.env, DEEL_HOME: 집, DEEL_TRUST_ALL: '0' };

// ══ 1. 설정 펴기 — 두 가지 모양을 다 받는다 ════════════════════════════
trace('1-설정펴기');
{
  const 납작 = 훅펴기({
    hooks: [
      { 때: '도구전', 도구: 'Bash', 명령: 'gate.py' },
      { 때: 'PostToolUse', matcher: 'Write|Edit', command: 'fmt', timeout: 5 },
    ],
  }, '검사');
  check('납작한 모양을 읽는다', 납작.훅들.length === 2, String(납작.훅들.length));
  check('영문 자리 이름도 알아듣는다', 납작.훅들[1]?.자리 === '도구후', 납작.훅들[1]?.자리);
  check('제한초를 밀리초로 옮긴다', 납작.훅들[1]?.제한 === 5000, String(납작.훅들[1]?.제한));
  check('안 적으면 기본 제한', 납작.훅들[0]?.제한 === 제한기본, String(납작.훅들[0]?.제한));

  /*
   * Claude Code 설정을 **그대로 복사해 붙일 수 있어야** 한다.
   *
   * MCP 에서 mcpServers 를 그대로 받는 것과 같은 판단이다. 이미 그 파일을
   * 가진 사람에게 "우리 말로 다시 적어라" 고 하면 그 사람은 훅을 안 쓴다.
   */
  const 남의것 = 훅펴기({
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'gate', timeout: 3 }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'notify' }] }],
    },
  }, '검사');
  check('★★ Claude Code 모양을 그대로 읽는다', 남의것.훅들.length === 2, String(남의것.훅들.length));
  check('  PreToolUse → 도구전', 남의것.훅들[0]?.자리 === '도구전', 남의것.훅들[0]?.자리);
  check('  Stop → 턴끝', 남의것.훅들[1]?.자리 === '턴끝', 남의것.훅들[1]?.자리);
  check('  matcher 를 안 적으면 모든 도구', 남의것.훅들[1]?.무늬글 === '*', 남의것.훅들[1]?.무늬글);

  // 못 알아들은 것은 **말한다.** 조용히 버리면 사람은 제가 적은 훅이 왜 안
  // 도는지 영영 모른다.
  const 이상한것 = 훅펴기({ hooks: [{ 때: '없는자리', 명령: 'x' }, { 때: '도구전' }] }, '검사');
  check('★ 못 알아들은 것은 버렸다고 말한다', 이상한것.버린것.length === 2, String(이상한것.버린것.length));
  check('  그리고 안 싣는다', 이상한것.훅들.length === 0, String(이상한것.훅들.length));

  // 갈래가 command 가 아닌 것은 아직 없다. 조용히 받아 두면 안 도는 훅이 화면에 세어진다.
  const 딴갈래 = 훅펴기({ hooks: { PreToolUse: [{ hooks: [{ type: 'http', url: 'x' }] }] } }, '검사');
  check('★ 모르는 갈래는 안 받는다', 딴갈래.훅들.length === 0 && 딴갈래.버린것.length === 1, '');
}

// ══ 2. 무늬는 양끝이 묶여야 한다 ═══════════════════════════════════════
trace('2-무늬');
{
  /*
   * 여기가 안 묶여 있으면 `Read` 무늬가 `TodoWrite` 에 걸린다. 막는 쪽이면
   * 안 막을 것을 막고, 고치는 쪽이면 엉뚱한 것을 고친다.
   */
  const h = { 무늬: 무늬짓기('Read') };
  check('★★ 무늬는 양끝이 묶인다', 걸리나(h, 'Read') && !걸리나(h, 'TodoWrite'), '');
  const 여럿 = { 무늬: 무늬짓기('Write|Edit') };
  check('여럿을 적으면 그 셋만', 걸리나(여럿, 'Write') && 걸리나(여럿, 'Edit') && !걸리나(여럿, 'Read'), '');
  check('* 는 다 걸린다', 걸리나({ 무늬: 무늬짓기('*') }, '아무거나'), '');
  check('안 적어도 다 걸린다', 걸리나({ 무늬: null }, '아무거나'), '');
  // 무늬가 잘못 적혀 있으면 null 이다. 아무것도 안 걸리는 무늬로 삼키면
  // 그 훅은 있으나 마나가 되는데 화면에는 세어져 있다.
  check('★ 못 만드는 무늬는 null', 무늬짓기('Read(') === null, '');
}

// ══ 3. 안 믿는 폴더의 파일은 안 읽는다 ═════════════════════════════════
trace('3-믿는폴더');
{
  적기(프로젝트자리(root), { hooks: [{ 때: '도구전', 명령: '남의명령' }] });
  안믿기(root, { env: 환경 });
  const 안믿을때 = 훅읽기(root, { env: 환경, 집 });
  /*
   * 이게 이 파일에서 제일 중요한 검사다.
   *
   * 없으면 `git clone` 한 번이 곧 남이 적어 둔 명령을 내 PC 에서 도는 것이
   * 된다 — 사람이 아무것도 안 쳐도 첫 도구 호출에서 돈다.
   */
  check('★★ 안 믿는 폴더의 hooks.json 은 안 읽는다', 안믿을때.훅들.length === 0, String(안믿을때.훅들.length));
  check('★★ 그리고 안 읽었다고 말한다', 안믿을때.안믿음 === true, '');

  믿기(root, { env: 환경 });
  const 믿을때 = 훅읽기(root, { env: 환경, 집 });
  check('믿는 폴더면 읽는다', 믿을때.훅들.length === 1, String(믿을때.훅들.length));
  check('  출처를 적어 둔다', 믿을때.훅들[0]?.출처 === '프로젝트', 믿을때.훅들[0]?.출처);

  // 이 PC 것은 폴더를 안 가린다 — 사람이 제 홈에 적은 것이다.
  적기(이PC자리(집, 환경), { hooks: [{ 때: '턴끝', 명령: '내명령' }] });
  const 둘다 = 훅읽기(root, { env: 환경, 집 });
  check('이 PC 것도 같이 읽는다', 둘다.훅들.length === 2, String(둘다.훅들.length));
  check('★ 이 PC 것이 먼저 돈다', 둘다.훅들[0]?.출처 === '이 PC', 둘다.훅들[0]?.출처);

  // 끌 수 있어야 한다. 훅이 망가졌을 때 고칠 길이 파일을 지우는 것뿐이면 안 된다.
  const 껐을때 = 훅읽기(root, { env: { ...환경, DEEL_HOOKS: 'off' }, 집 });
  check('★★ DEEL_HOOKS=off 면 하나도 안 돈다', 껐을때.훅들.length === 0 && 껐을때.켜짐 === false, '');
  check('  왜 꺼졌는지 말한다', 껐을때.왜꺼짐 === 'DEEL_HOOKS=off', String(껐을때.왜꺼짐));
  const 깃발로 = 훅읽기(root, { env: 환경, 집, 켜짐: false });
  check('--no-hooks 로도 끈다', 깃발로.훅들.length === 0 && 깃발로.왜꺼짐 === '--no-hooks', '');

  지우기(이PC자리(집, 환경));
}

// ══ 4. 진짜로 돌려 본다 ════════════════════════════════════════════════
trace('4-진짜로돌리기');
{
  /*
   * 여기서부터는 진짜 자식 프로세스다. 흉내로는 셸을 거치는지, stdin 이
   * 닿는지, 시한이 걸리는지를 못 잰다.
   *
   * 명령은 `node -e` 하나로 통일한다. 이 검사가 도는 자리에는 node 가 반드시
   * 있고(우리가 그 위에서 돈다), python 이나 sh 는 그렇지 않다.
   */
  const 노드 = (글) => `node -e "${글.replace(/"/g, '\\"')}"`;
  const 훅 = (o) => 훅펴기({ hooks: [{ 때: '도구전', 명령: o.명령, ...o }] }, '검사').훅들[0];

  const 통과 = await 훅돌리기(훅({ 명령: 노드('process.stdout.write(\'괜찮습니다\')') }), { 도구: 'Bash' });
  check('★★ 0 으로 끝나면 안 막는다', 통과.막나 === false && 통과.코드 === 0, `${통과.코드} ${통과.왜 ?? ''}`);
  check('  뱉은 글을 들고 온다', 통과.말 === '괜찮습니다', 통과.말);

  const 막음 = await 훅돌리기(훅({ 명령: 노드('process.stdout.write(\'사내 규칙 위반\');process.exit(2)') }), {});
  check('★★ 2 로 끝나면 막는다', 막음.막나 === true && 막음.코드 === 2, `${막음.코드}`);
  check('  까닭을 그대로 들고 온다', 막음.말.includes('사내 규칙 위반'), 막음.말);

  /*
   * ── 고장 나면 막는다 ────────────────────────────────────────────────
   *
   * 흔한 규격은 「2번만 막고 나머지 실패는 지나간다」 다. 그러면 훅 파일의
   * 오타 하나가 그 문을 조용히 열어 둔다 — 화면에는 여전히 「훅 3개」 라고
   * 떠 있는 채로. 못 잰 것을 초록으로 안 세는 것과 같은 판단이다.
   */
  const 고장 = await 훅돌리기(훅({ 명령: 노드('process.exit(1)') }), {});
  check('★★ 다른 실패도 막는다 (문지기가 쓰러졌다)', 고장.막나 === true, `${고장.코드}`);
  check('  왜 막았는지 적는다', /1 로 끝났습니다/.test(고장.왜 ?? ''), String(고장.왜));

  const 없는것 = await 훅돌리기(훅({ 명령: 'deel-이런건-없습니다-12345' }), {});
  check('★★ 아예 못 돌려도 막는다', 없는것.막나 === true, `${없는것.코드} ${없는것.왜}`);

  // 지나가게 하려면 **적어야** 한다. 적힌 것만 지나간다.
  const 적어둠 = await 훅돌리기(훅({ 명령: 노드('process.exit(1)'), 고장나면: '지나가기' }), {});
  check('★★ 적어 두면 그때만 지나간다', 적어둠.막나 === false, `${적어둠.코드}`);

  // 못 막는 자리는 무슨 소리를 해도 못 막는다. 이미 일은 끝났다.
  const 뒤 = 훅펴기({ hooks: [{ 때: '도구후', 명령: 노드('process.exit(2)') }] }, '검사').훅들[0];
  const 뒤결과 = await 훅돌리기(뒤, {});
  check('★★ 도구후는 2 로 끝나도 못 막는다', 뒤결과.막나 === false, '');

  // 시한. 안 걸리면 멎은 훅 하나가 대화를 통째로 세운다.
  const 늦음 = await 훅돌리기(훅({ 명령: 노드('setTimeout(()=>{},5000)'), 제한초: 1 }), {});
  check('★★ 시한을 넘기면 죽이고 막는다', 늦음.막나 === true && 늦음.ms < 4000, `${늦음.ms}ms ${늦음.왜 ?? ''}`);
}

// ══ 5. 모델이 만든 글은 stdin 으로만 간다 ══════════════════════════════
trace('5-stdin');
{
  /*
   * 넘길 것을 명령줄에 끼우면 그 자리가 곧 주입 구멍이다. 도구 인자는
   * 모델이 만든 글이고, 거기에는 따옴표도 세미콜론도 백틱도 들어온다.
   *
   * 그래서 자식이 **stdin 에서 읽어** 그대로 되뱉게 하고, 우리가 넘긴 것과
   * 같은지 본다. 명령줄로 갔다면 이 값은 절대 안 맞는다.
   */
  const 되뱉기 = 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(s.trim()))';
  const h = 훅펴기({ hooks: [{ 때: '도구전', 명령: `node -e "${되뱉기.replace(/"/g, '\\"')}"` }] }, '검사').훅들[0];

  const 짓궂은인자 = { command: 'echo "; rm -rf /" `whoami` $(id)' };
  const r = await 훅돌리기(h, { 도구: 'Bash', 인자: 짓궂은인자 });
  let 받은것 = null;
  try { 받은것 = JSON.parse(r.말); } catch { /* 아래 검사가 잡는다 */ }
  check('★★ 넘긴 것이 stdin 으로 그대로 닿는다',
    받은것?.인자?.command === 짓궂은인자.command, String(r.말).slice(0, 80));
  check('  자리와 도구 이름도 같이 간다',
    받은것?.자리 === '도구전' && 받은것?.도구 === 'Bash', `${받은것?.자리} ${받은것?.도구}`);
  check('★★ 그리고 셸이 그 글을 안 돌렸다 (0 으로 끝났다)', r.코드 === 0 && !r.막나, String(r.코드));
}

// ══ 6. 한 자리를 통째로 돌린다 ═════════════════════════════════════════
trace('6-자리돌리기');
{
  const 노드 = (글) => `node -e "${글.replace(/"/g, '\\"')}"`;
  const 훅들 = 훅펴기({
    hooks: [
      { 때: '도구전', 도구: 'Bash', 명령: 노드('process.stdout.write("첫째")') },
      { 때: '도구전', 도구: 'Bash', 명령: 노드('process.stdout.write("둘째");process.exit(2)') },
      { 때: '도구전', 도구: 'Bash', 명령: 노드('process.stdout.write("셋째")') },
      { 때: '도구전', 도구: 'Write', 명령: 노드('process.stdout.write("딴도구")') },
      { 때: '턴끝', 명령: 노드('process.stdout.write("끝")') },
    ],
  }, '검사').훅들;

  check('자리와 도구로 고른다', 고를것(훅들, '도구전', 'Bash').length === 3, '');
  check('  다른 도구는 안 고른다', 고를것(훅들, '도구전', 'Write').length === 1, '');
  check('  도구를 안 보는 자리는 다 고른다', 고를것(훅들, '턴끝').length === 1, '');

  const 적힌것 = [];
  const r = await 자리돌리기(훅들, '도구전', {
    도구: 'Bash',
    audit: { write: (갈래, o) => 적힌것.push({ 갈래, ...o }) },
  });
  /*
   * 막힌 데서 멈춘다. 이미 막힌 것에 남은 훅을 더 돌리는 것은 시간만 쓰는
   * 일이고, 사람에게 보여 줄 까닭도 첫 것이 맞다.
   */
  check('★★ 첫 막힘에서 멈춘다', r.결과들.length === 2 && !!r.막힘, String(r.결과들.length));
  check('  막은 것의 까닭을 들고 있다', r.막힘.말.includes('둘째'), r.막힘.말);
  check('★★ 차례로 돈다', r.말들[0] === '첫째' && r.말들[1] === '둘째', r.말들.join('/'));

  /*
   * 감사기록에는 **돈 것 전부**가 남아야 한다. 막은 것만 남기면 「훅이 안
   * 돌았다」 와 「돌았는데 통과시켰다」 를 나중에 구별할 수 없다 — 사내
   * 심사에서 묻는 것이 정확히 그 둘의 차이다.
   */
  check('★★ 통과시킨 것도 감사기록에 남는다', 적힌것.length === 2, String(적힌것.length));
  check('  갈래는 hook', 적힌것.every((x) => x.갈래 === 'hook'), '');
  check('  막았는지를 적는다', 적힌것[0]?.막음 === false && 적힌것[1]?.막음 === true, '');

  const 말 = 막힘말(r.막힘);
  check('막힘말이 자리와 출처를 적는다', 말.includes('도구전') && 말.includes('검사'), 말.slice(0, 60));
  check('★ 그리고 다시 부르지 말라고 적는다', 말.includes('다시 부르지 마세요'), '');
}

// ══ 7. 화면 한 장 ══════════════════════════════════════════════════════
trace('7-화면');
{
  적기(프로젝트자리(root), {
    hooks: [
      { 때: '도구전', 도구: 'Bash', 명령: 'gate' },
      { 때: '턴끝', 명령: 'notify' },
      { 때: '없는자리', 명령: 'x' },
    ],
  });
  믿기(root, { env: 환경 });
  const 줄들 = 훅줄들(훅읽기(root, { env: 환경, 집 }));
  const 글 = JSON.stringify(줄들);
  check('훅 수를 적는다', 글.includes('2개'), 글.slice(0, 120));
  check('자리별로 나눠 적는다', 글.includes('도구전 1') && 글.includes('턴끝 1'), 글.slice(0, 200));
  check('★ 못 알아들은 것도 화면에 적는다', 줄들.some((x) => x.이름?.includes('못 알아들음')), '');

  안믿기(root, { env: 환경 });
  const 안믿음줄 = 훅줄들(훅읽기(root, { env: 환경, 집 }));
  check('★★ 안 읽은 까닭을 화면이 말한다',
    안믿음줄.some((x) => x.덧말?.includes('deel trust')), JSON.stringify(안믿음줄).slice(0, 160));

  // 깨진 파일도 조용히 넘기지 않는다.
  writeFileSync(프로젝트자리(root), '{ 이건 JSON 이 아닙니다', 'utf8');
  믿기(root, { env: 환경 });
  const 깨진것 = 훅줄들(훅읽기(root, { env: 환경, 집 }));
  check('★ 못 읽은 파일을 말한다', 깨진것.some((x) => x.상태 === 'no'), JSON.stringify(깨진것).slice(0, 160));
}

// ══ 8. 자리 목록은 한 벌이다 ═══════════════════════════════════════════
trace('8-자리목록');
{
  /*
   * 막는 자리가 자리 목록 밖에 있으면 그건 오타다. 그리고 그 오타는
   * 「막는다고 적혀 있는데 안 막히는」 모양으로만 드러난다 — 제일 늦게
   * 알아차리는 종류다.
   */
  check('★ 막는 자리는 전부 아는 자리다', 막는자리.every((z) => 자리들.includes(z)), 막는자리.join(' '));
  check('막는 자리는 도구전·말전 둘', 막는자리.length === 2, String(막는자리.length));
  check('자리는 넷', 자리들.length === 4, 자리들.join(' '));
}

안믿기(root, { env: 환경 });
rmSync(root, { recursive: true, force: true });
rmSync(집, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n훅  ${D}(사람이 적어 둔 명령을 정해진 자리에서 돌린다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

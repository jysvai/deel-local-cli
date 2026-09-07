/**
 * 이름 붙인 하위 작업 검사 — `.deel/agents/*.json`.
 *
 * ── 여기서 제일 중요한 검사 ─────────────────────────────────────────────
 *
 * **도구는 줄이기만 한다.** 정의에 `Write` 를 적어 넣는 것으로 설계 모드의
 * 「파일을 안 바꾼다」 가 깨지면 안 된다. 그 구멍은 화면에 안 나타난다 —
 * 여전히 설계 모드라고 떠 있는 채로 파일이 바뀐다.
 *
 * 나머지는 「조용히 안 되는 것」 을 막는 검사다. 설명이 없는 정의, 오타 난
 * 도구 이름, 못 찾는 이름 — 셋 다 조용히 넘어가면 사람은 제가 만든 정의가
 * 왜 안 도는지 영영 모른다.
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  에이전트읽기, 한정의, 찾기, 고를말, 할일합치기, 도구줄이기, 에이전트줄들, 자리들, 최대, 설명길이,
} from '../src/agent/agents.js';
import { toolSchemas, TOOLS } from '../src/tools/index.js';
import { allow as 모드허락 } from '../src/agent/modes.js';
import { trace } from './trace.mjs';

/** 그 모드가 주는 도구 이름들. 루프가 자식도구 를 만드는 것과 같은 길이다. */
const 모드도구 = (id) => 모드허락(id, Object.keys(TOOLS));

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-agents-'));
const 집 = mkdtempSync(join(tmpdir(), 'deel-agents-home-'));
const 정의폴더 = join(root, '.deel', 'agents');
mkdirSync(정의폴더, { recursive: true });
mkdirSync(join(집, '.deel', 'agents'), { recursive: true });

const 적기 = (폴더, 파일, 것) => writeFileSync(join(폴더, 파일),
  typeof 것 === 'string' ? 것 : JSON.stringify(것, null, 2), 'utf8');

// ══ 1. 정의 하나 펴기 ══════════════════════════════════════════════════
trace('1-정의펴기');
{
  const a = 한정의('리뷰어', {
    설명: '고친 코드를 훑고 위험한 데만 짚는다',
    모드: 'inspect',
    도구: ['Read', 'Grep'],
    지침: '되돌릴 수 없는 것부터 본다.',
    걸음: 12,
  }, '프로젝트');
  check('한글 칸을 읽는다', a?.이름 === '리뷰어' && a?.모드 === 'inspect', JSON.stringify(a?.모드));
  check('도구는 배열 그대로', JSON.stringify(a?.도구) === '["Read","Grep"]', JSON.stringify(a?.도구));
  check('걸음 수를 읽는다', a?.걸음 === 12, String(a?.걸음));

  // 영문 칸도 받는다 — 이미 쓰던 파일을 다시 적으라고 하면 아무도 안 쓴다.
  const b = 한정의('reviewer', {
    description: 'review the diff', mode: 'inspect', tools: 'Read, Grep  Glob', maxSteps: 8,
  }, '이 PC');
  check('★ 영문 칸도 읽는다', b?.설명 === 'review the diff' && b?.모드 === 'inspect', JSON.stringify(b?.설명));
  check('★ 도구를 쉼표·빈칸 글로 적어도 읽는다',
    JSON.stringify(b?.도구) === '["Read","Grep","Glob"]', JSON.stringify(b?.도구));

  /*
   * 설명이 없으면 안 받는다. 부모 모델이 고를 근거가 그 한 줄뿐이라,
   * 설명 없는 정의는 목록에 이름만 서 있고 아무도 안 고르는 것이 된다.
   */
  check('★★ 설명이 없으면 안 받는다', 한정의('x', { 모드: 'code' }, '검사') === null, '');

  // 설명이 길면 자른다. 이 글은 매 요청에 실린다.
  const 긴것 = 한정의('길다', { 설명: '가'.repeat(설명길이 + 50) }, '검사');
  check('★ 긴 설명은 자른다', 긴것.설명.length <= 설명길이 + 1, String(긴것.설명.length));

  // 걸음 수에 상한을 건다. 정의 파일 하나가 걸음 수를 무한정 열면 안 된다.
  check('★ 걸음 수에 상한이 있다', 한정의('많다', { 설명: 'x', 걸음: 9999 }, '검사').걸음 === 200, '');
  check('0 이나 음수는 안 받는다', 한정의('0', { 설명: 'x', 걸음: 0 }, '검사').걸음 === null, '');
}

// ══ 2. 폴더에서 읽기 ═══════════════════════════════════════════════════
trace('2-폴더읽기');
{
  적기(정의폴더, '리뷰어.json', { 설명: '고친 데만 본다', 모드: 'inspect', 도구: ['Read', 'Grep'] });
  적기(정의폴더, '문서쓰기.json', { 설명: '바뀐 것을 문서에 반영한다', 모드: 'code' });
  적기(정의폴더, '설명없음.json', { 모드: 'code' });
  적기(정의폴더, '깨진것.json', '{ 이건 JSON 이 아닙니다');
  적기(정의폴더, '읽지마.txt', 'x');

  const r = 에이전트읽기(root, { 집 });
  const 이름들 = r.에이전트들.map((a) => a.이름).sort();
  check('폴더에서 읽는다', 이름들.join(' ') === '리뷰어 문서쓰기', 이름들.join(' '));
  check('파일 이름이 곧 이름이다', !!찾기(r.에이전트들, '리뷰어'), '');
  check('대소문자는 안 가린다', !!찾기(r.에이전트들, '리뷰어 '.trim()), '');
  check('json·md 아닌 것은 안 본다', !이름들.includes('읽지마'), '');

  /*
   * 못 읽은 것은 **말한다.** 조용히 버리면 사람은 제가 만든 정의가 왜 목록에
   * 없는지 영영 모른다 — 그리고 그때 의심하는 것은 파일이 아니라 프로그램이다.
   */
  check('★★ 설명이 없는 것을 말한다', r.버린것.some((x) => x.includes('설명없음')), r.버린것.join(' / '));
  check('★★ 깨진 파일도 말한다', r.버린것.some((x) => x.includes('깨진것')), r.버린것.join(' / '));

  // `.md` 도 받는다 — Claude Code 의 에이전트 파일이 그 모양이다.
  적기(정의폴더, '남의것.md', '---\nname: 남의것\ndescription: 앞머리로 적은 것\n---\n\n본문이 지침이 된다.\n');
  const r2 = 에이전트읽기(root, { 집 });
  const md = 찾기(r2.에이전트들, '남의것');
  check('★★ Claude Code 의 .md 모양도 읽는다', !!md, '');
  check('  본문이 지침이 된다', /본문이 지침이 된다/.test(md?.지침 ?? ''), md?.지침 ?? '');

  // 이 PC 것과 프로젝트 것이 겹치면 가까운 쪽이 이긴다 (스킬과 같은 규칙).
  적기(join(집, '.deel', 'agents'), '리뷰어.json', { 설명: '이 PC 것', 모드: 'ask' });
  적기(join(집, '.deel', 'agents'), '내것.json', { 설명: '이 PC 에만 있는 것' });
  const r3 = 에이전트읽기(root, { 집 });
  check('★ 이 PC 것도 읽는다', !!찾기(r3.에이전트들, '내것'), '');
  check('★★ 이름이 겹치면 프로젝트가 이긴다', 찾기(r3.에이전트들, '리뷰어')?.출처 === '프로젝트',
    찾기(r3.에이전트들, '리뷰어')?.출처);

  const 껐을때 = 에이전트읽기(root, { 집, env: { DEEL_AGENTS: 'off' } });
  check('DEEL_AGENTS=off 로 끈다', 껐을때.에이전트들.length === 0 && 껐을때.켜짐 === false, '');
}

// ══ 3. 도구는 줄이기만 한다 ════════════════════════════════════════════
trace('3-도구줄이기');
{
  /*
   * ── 이 파일에서 제일 중요한 검사 ──────────────────────────────────
   *
   * 설계 모드는 「파일을 안 바꾼다」 는 약속이다. 사람은 그 약속을 믿고
   * /architect 를 켠다. 정의 파일에 `Write` 한 줄을 적는 것으로 그 약속이
   * 깨지면, 화면에는 여전히 설계 모드라고 떠 있는 채로 파일이 바뀐다.
   */
  const 설계도구 = 모드도구('architect');
  const r = 도구줄이기({ 도구: ['Read', 'Write', 'Bash'] }, 설계도구);
  check('★★ 모드가 안 주는 도구는 정의에 적어도 안 준다',
    !r.도구.includes('Write') && !r.도구.includes('Bash'), r.도구.join(' '));
  check('★★ 그리고 뺐다고 말한다', r.못준것.includes('Write') && r.못준것.includes('Bash'), r.못준것.join(' '));
  check('  모드가 주는 것은 남는다', r.도구.includes('Read'), r.도구.join(' '));

  const 코드도구 = 모드도구('code');
  const r2 = 도구줄이기({ 도구: ['Read', 'Edit'] }, 코드도구);
  check('★ 적은 것만 남긴다', r2.도구.length === 2 && r2.도구.includes('Edit'), r2.도구.join(' '));
  check('  안 적은 것은 뺀다', !r2.도구.includes('Bash'), r2.도구.join(' '));

  /*
   * 하나도 안 남으면 줄이지 않는다.
   *
   * 도구가 0개인 하위는 아무것도 못 하고 걸음만 태우는데, 그 까닭이 화면
   * 어디에도 안 나타난다. 오타 하나가 조용한 실패가 되는 자리다.
   */
  const r3 = 도구줄이기({ 도구: ['Raed', 'Gerp'] }, 코드도구);
  check('★★ 다 오타면 줄이지 않는다 (0개짜리 하위를 안 만든다)',
    r3.도구.length === 코드도구.length, String(r3.도구.length));
  check('  대신 오타를 다 말한다', r3.못준것.length === 2, r3.못준것.join(' '));

  check('안 적었으면 그대로', 도구줄이기({ 도구: null }, 코드도구).도구 === 코드도구, '');
}

// ══ 4. 지침은 시킨 일 앞에 ═════════════════════════════════════════════
trace('4-지침');
{
  /*
   * 지침은 「어떻게」 이고 시킨 일은 「무엇을」 이다. 뒤에 놓으면 모델이
   * 마지막에 읽은 것을 일로 여겨서, 지침을 시킨 일로 착각한다.
   */
  const 글 = 할일합치기({ 지침: '되돌릴 수 없는 것부터 본다.' }, '이 diff 를 봐 줘');
  check('★★ 지침이 시킨 일보다 앞이다',
    글.indexOf('되돌릴 수 없는') < 글.indexOf('이 diff'), 글.slice(0, 40));
  check('둘 사이에 금이 있다', 글.includes('---'), '');
  check('지침이 없으면 그대로', 할일합치기({ 지침: null }, '그대로') === '그대로', '');
}

// ══ 5. 모델에게는 이름과 설명만 실린다 ═════════════════════════════════
trace('5-스키마');
{
  /*
   * 지침 본문은 **고른 뒤에** 하위 프롬프트로 간다. 여기 실으면 안 쓰는
   * 에이전트의 지침까지 매 요청에 나간다 — 스킬을 2단계로 올리는 것과
   * 같은 셈법이다.
   */
  const 것들 = [{ 이름: '리뷰어', 설명: '고친 데만 본다', 지침: '아주 긴 지침 '.repeat(50) }];
  const 말 = 고를말(것들);
  check('★ 이름과 설명은 실린다', 말.includes('리뷰어') && 말.includes('고친 데만 본다'), '');
  check('★★ 지침 본문은 안 실린다', !말.includes('아주 긴 지침'), '');
  check('없으면 아무 말도 안 한다', 고를말([]) === null, '');

  const 있을때 = toolSchemas(null, { work: 'code', 에이전트들: 것들 });
  const 없을때 = toolSchemas(null, { work: 'code' });
  const task있 = 있을때.find((t) => t.function.name === 'Task');
  const task없 = 없을때.find((t) => t.function.name === 'Task');
  check('★★ 정의가 있으면 Task 에 agent 칸이 생긴다', !!task있?.function?.parameters?.properties?.agent, '');
  check('★★ 없으면 안 생긴다 — 못 쓸 칸을 세워 두지 않는다',
    !task없?.function?.parameters?.properties?.agent, '');
  check('  이름 목록이 그 칸 설명에 있다',
    /리뷰어/.test(task있?.function?.parameters?.properties?.agent?.description ?? ''), '');

  /*
   * 원본 스키마를 안 건드려야 한다. TOOLS 는 한 벌이라, 거기 썼으면 다음
   * 부름에도 남고 폴더가 다른 방(ACP)의 목록까지 같이 물들인다.
   */
  const 다시 = toolSchemas(null, { work: 'code' });
  check('★★ 원본 스키마를 안 건드린다',
    !다시.find((t) => t.function.name === 'Task')?.function?.parameters?.properties?.agent, '');
}

// ══ 6. 화면 한 줄 ══════════════════════════════════════════════════════
trace('6-화면');
{
  const 줄들 = 에이전트줄들(에이전트읽기(root, { 집 }));
  const 글 = JSON.stringify(줄들);
  check('몇 개인지 적는다', /개/.test(글), 글.slice(0, 100));
  check('★ 못 읽은 것도 화면에 적는다', 줄들.some((x) => x.이름?.includes('못 읽음')), '');
  check('자리는 .deel/agents 와 .claude/agents 둘', 자리들('/x').length === 2, 자리들('/x').join(' '));
  check('한 폴더 상한이 있다', 최대 > 0 && 최대 <= 64, String(최대));
}

rmSync(root, { recursive: true, force: true });
rmSync(집, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n이름 붙인 하위 작업  ${D}(모드·모델·도구·지침을 파일 하나가 들고 있다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

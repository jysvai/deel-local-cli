// 기억 — 대화가 끝나도 남는 것.
//
// 무엇을 확인하나:
//   1) 매 요청에 실리는 물건이라 **자리를 지키는가** — 안 막으면 컨텍스트를 먹는다
//   2) 같은 말이 쌓이지 않는가 — 모델은 자기가 방금 적은 것을 기억 못 한다
//   3) 사람이 **지울 수 있는가** — 틀린 기억은 없느니만 못하다
//   4) 시스템 프롬프트에 실제로 들어가는가 — 안 들어가면 적는 의미가 없다
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 읽기, 쓰기, 더하기, 지우기, 비우기, 프롬프트토막, 자리, 기억최대, 한줄최대, 줄최대 } from '../src/agent/memory.js';
import { TOOLS, toolSchemas } from '../src/tools/index.js';
import { Session } from '../src/agent/session.js';
import { makeScope } from '../src/safety/guard.js';
import { Audit } from '../src/safety/audit.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-mem-'));

trace('1-적고읽기');

{
  check('없으면 없다고 한다', 읽기(root).있음 === false && 읽기(root).줄들.length === 0);
  check('없을 때 프롬프트에 아무것도 안 넣는다', 프롬프트토막(root) === '',
    JSON.stringify(프롬프트토막(root)));

  const r = 더하기(root, '사내 문서는 CP949 로 읽고 CP949 로 되돌려 쓴다');
  check('한 줄 적힌다', r.ok && r.줄수 === 1, JSON.stringify(r));
  check('파일이 생긴다', existsSync(자리(root)), 자리(root));

  // 사람이 열어 고칠 수 있는 글이어야 한다. 데이터베이스가 아니다.
  const 글 = readFileSync(자리(root), 'utf8');
  check('사람이 읽을 수 있는 글이다', /^# 기억/.test(글) && /- 사내 문서는 CP949/.test(글), 글.slice(0, 40));
  check('직접 고쳐도 된다고 적어 둔다', /직접 고치/.test(글));

  더하기(root, '검증 포트로 7080 은 쓰지 않는다');
  check('여러 줄이 쌓인다', 읽기(root).줄들.length === 2, String(읽기(root).줄들.length));

  // 사람이 손으로 고친 파일도 읽어야 한다 — 목록 표시가 있든 없든.
  writeFileSync(자리(root), '# 기억\n\n손으로 적은 줄\n- 목록으로 적은 줄\n', 'utf8');
  const 손 = 읽기(root).줄들;
  check('손으로 고친 파일도 읽는다', 손.length === 2, JSON.stringify(손));
  check('목록 표시는 떼고 담는다', 손[1] === '목록으로 적은 줄', JSON.stringify(손[1]));
}

trace('2-같은말은안쌓임');

// ── 모델은 자기가 방금 적은 것을 기억 못 한다 ───────────────────────────
//
// 안 막으면 같은 말이 조금씩 다른 꼴로 스무 줄 쌓인다. 그게 매 요청마다 나간다.
{
  비우기(root);
  더하기(root, 'CP949 로 읽고 CP949 로 되돌려 쓴다');

  check('똑같은 말은 안 쌓인다', 더하기(root, 'CP949 로 읽고 CP949 로 되돌려 쓴다').ok === false);
  check('안 쌓는 이유를 말한다', /이미 기억/.test(더하기(root, 'CP949 로 읽고 CP949 로 되돌려 쓴다').why ?? ''));
  check('띄어쓰기만 다른 것도 안 쌓는다', 더하기(root, 'CP949로 읽고 CP949로 되돌려쓴다.').ok === false);
  check('그래서 한 줄 그대로다', 읽기(root).줄들.length === 1, String(읽기(root).줄들.length));

  check('다른 말은 쌓인다', 더하기(root, '빌드는 npm run build 로 한다').ok === true);
  check('빈 줄은 안 쌓는다', 더하기(root, '   ').ok === false);
  check('빈 줄은 이유를 말한다', /비었/.test(더하기(root, '').why ?? ''));
}

trace('3-자리지키기');

// ── 매 요청마다 나가는 물건이라 자리를 지켜야 한다 ──────────────────────
{
  비우기(root);

  // 모델이 파일을 통째로 기억에 넣으려 드는 일이 실제로 있다.
  const 긴줄 = '가'.repeat(2000);
  더하기(root, 긴줄);
  const 담긴것 = 읽기(root).줄들[0];
  check('긴 줄은 자른다', 담긴것.length <= 한줄최대 + 1, String(담긴것.length));
  check('잘랐으면 표시를 남긴다', 담긴것.endsWith('…'), 담긴것.slice(-10));

  // 줄바꿈이 들어오면 파일 꼴이 무너진다. 한 줄로 편다.
  비우기(root);
  더하기(root, '첫 줄\n둘째 줄\n셋째 줄');
  check('줄바꿈은 한 줄로 편다', 읽기(root).줄들.length === 1, JSON.stringify(읽기(root).줄들));

  // 줄 수 상한. 넘으면 오래된 것부터 뺀다 — 최근에 정한 것이 대개 맞다.
  비우기(root);
  for (let i = 0; i < 줄최대 + 20; i++) 더하기(root, `규칙 번호 ${i} 는 이렇게 한다`);
  const 남은것 = 읽기(root).줄들;
  check('줄 수가 상한을 안 넘는다', 남은것.length <= 줄최대, String(남은것.length));
  check('오래된 것부터 뺀다', !남은것.some((l) => /규칙 번호 0 /.test(l)), 남은것[0]);
  check('최근 것은 남는다', 남은것.some((l) => new RegExp(`규칙 번호 ${줄최대 + 19} `).test(l)), 남은것.at(-1));
  check('넘쳤다고 알려 준다', 더하기(root, '새로 정한 것 하나').넘침 === true);

  // 글자 상한도 지켜야 한다. 줄 수가 적어도 한 줄이 길면 넘칠 수 있다.
  비우기(root);
  for (let i = 0; i < 40; i++) 더하기(root, `${i} ` + '나'.repeat(한줄최대 - 4));
  const 전체 = 읽기(root).줄들.join('\n');
  check('전체 글자가 상한을 안 넘는다', 전체.length <= 기억최대, String(전체.length));
}

trace('4-사람이지우기');

// ── 틀린 기억은 없느니만 못하다 ─────────────────────────────────────────
//
// 매 요청마다 실려 나가면서 계속 틀리게 만든다. 사람이 반드시 지울 수 있어야 한다.
{
  비우기(root);
  더하기(root, '첫째 규칙');
  더하기(root, '틀리게 적힌 규칙');
  더하기(root, '셋째 규칙');

  const r = 지우기(root, 2);
  check('번호로 지운다', r.ok && r.뺀것 === '틀리게 적힌 규칙', JSON.stringify(r));
  check('나머지는 그대로', 읽기(root).줄들.join('|') === '첫째 규칙|셋째 규칙', 읽기(root).줄들.join('|'));
  check('없는 번호는 말해 준다', 지우기(root, 99).ok === false && /번호/.test(지우기(root, 99).why));
  check('0 번도 없다', 지우기(root, 0).ok === false);
  check('숫자가 아니면 안 지운다', 지우기(root, 'x').ok === false);

  비우기(root);
  check('통째로 비운다', 읽기(root).줄들.length === 0);
  check('비워도 파일은 남는다 (사람이 열어 볼 수 있게)', existsSync(자리(root)));
}

trace('5-프롬프트에들어가는가');

// ── 적는 의미는 프롬프트에 들어가야 생긴다 ──────────────────────────────
{
  비우기(root);
  더하기(root, '사내 문서는 CP949 다');
  더하기(root, '검증 포트로 7080 은 쓰지 않는다');

  const 토막 = 프롬프트토막(root);
  check('프롬프트 토막에 다 들어간다', /CP949/.test(토막) && /7080/.test(토막), 토막.slice(0, 60));
  check('무엇인지 설명이 붙는다', /지난 대화에서 정한 것/.test(토막), 토막.split('\n')[1] ?? '');

  const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', auth: 'none', key: null, model: 'm', ctx: 32768, streaming: false, tools: true };
  const s = new Session(conn, { root });
  check('기억을 안 넣으면 프롬프트에 없다', !/CP949/.test(s.systemPrompt()));
  s.memory = 토막;
  check('넣으면 시스템 프롬프트에 실린다', /CP949/.test(s.systemPrompt()) && /7080/.test(s.systemPrompt()));

  // 매 요청마다 나가는 값이므로 컨텍스트 셈에도 들어가야 한다.
  const 없이 = new Session(conn, { root }).breakdown().used;
  const 함께 = s.breakdown().used;
  check('기억도 컨텍스트로 센다', 함께 > 없이, `${없이} → ${함께}`);
}

trace('6-도구로');

// ── 모델이 스스로 적을 수 있어야 한다 ───────────────────────────────────
//
// 사람이 /memory 로 적게 하면 아무도 안 적는다. 지금 막 정한 것을 남길지
// 판단할 수 있는 것은 그 자리에 있는 모델뿐이다.
{
  비우기(root);
  const ctx = { scope: makeScope(root), audit: new Audit(root), seen: new Set() };

  const r = await TOOLS.Remember.run({ text: '이 프로젝트는 의존성을 0개로 유지한다' }, ctx);
  check('Remember 도구가 적는다', r.remembered === true, JSON.stringify(r));
  check('무엇을 적었는지 돌려준다', /의존성을 0개/.test(r.content ?? ''), r.content);
  check('파일에 실제로 남는다', 읽기(root).줄들.some((l) => /의존성을 0개/.test(l)));

  const 또 = await TOOLS.Remember.run({ text: '이 프로젝트는 의존성을 0개로 유지한다' }, ctx);
  check('같은 것을 또 적으면 안 쌓는다', 또.remembered === false && 읽기(root).줄들.length === 1,
    JSON.stringify(또));

  // 목록에 실제로 있어야 모델이 부를 수 있다.
  const 이름들 = toolSchemas(null, { web: true }).map((t) => t.function.name);
  check('도구 목록에 Remember 가 있다', 이름들.includes('Remember'), 이름들.join(','));
  // 파일을 안 건드리므로 계획·설계 모드에서도 준다 — 거기서 정한 것이야말로
  // 다음에 이어질 때 필요하다.
  const 계획중 = toolSchemas(null, { web: true, work: 'plan' }).map((t) => t.function.name);
  check('계획 모드에서도 기억할 수 있다', 계획중.includes('Remember'), 계획중.join(','));
  check('계획 모드에 쓰기 도구는 여전히 없다', !계획중.includes('Write'), 계획중.join(','));
}

rmSync(root, { recursive: true, force: true });

trace('7-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n기억 검사  ${D}(매 요청마다 나가는 물건이라 자리를 지켜야 한다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

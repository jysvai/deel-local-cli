// @파일 지목 — 말 속에 @경로 를 쓰면 그 파일을 바로 붙여 보낸다.
//
// 왜 필요한가: 지금은 파일 하나 보여주려면 모델이 Read 도구를 스스로 불러야
// 한다. 로컬 모델은 도구 호출이 약해서 이 왕복이 자주 헛돈다. 사람이 이미
// 어느 파일인지 알고 있는데 모델더러 찾아보라고 시키는 셈이다.
//
// 여기서 제일 조심할 것은 '아닌 것을 파일로 오해하지 않기' 다.
// 이메일 주소, CSS 의 @media, 파이썬 장식자, 트위터 아이디 — 전부 @ 로 시작한다.
// 그래서 실제로 있는 경로일 때만 붙인다. 없으면 글자 그대로 둔다.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expand, findMentions } from '../src/agent/mention.js';
import { makeScope } from '../src/safety/guard.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-at-'));
const scope = makeScope(root);
mkdirSync(join(root, 'src'), { recursive: true });
mkdirSync(join(root, '자료 폴더'), { recursive: true });
writeFileSync(join(root, 'src', 'a.js'), 'const a = 1;\nexport default a;\n', 'utf8');
writeFileSync(join(root, 'src', 'b.js'), 'export const b = 2;\n', 'utf8');
writeFileSync(join(root, '한글 이름.txt'), '띄어쓰기가 든 이름\n', 'utf8');
writeFileSync(join(root, '자료 폴더', '표.csv'), 'ㄱ,ㄴ\n1,2\n', 'utf8');
writeFileSync(join(root, '큰것.txt'), 'x'.repeat(50000), 'utf8');
// CP949 파일 — 사내에 흔하다. UTF-8 로 읽으면 다 깨진다.
writeFileSync(join(root, 'cp949.txt'), Buffer.from([0xB0, 0xA1, 0xB3, 0xAA, 0x0A]));

const 붙임 = (text, opts = {}) => expand(text, { scope, ...opts });

trace('1-찾기');

// ── 무엇을 지목으로 볼 것인가 ───────────────────────────────────────────
{
  check('맨 앞의 @ 를 찾는다', findMentions('@src/a.js 봐줘').length === 1, '');
  check('가운데 것도 찾는다', findMentions('이거 @src/a.js 어때').length === 1, '');
  check('여럿도 찾는다', findMentions('@src/a.js 와 @src/b.js').length === 2, '');
  check('이메일은 안 잡는다', findMentions('yunseok@gmail.com 로 보내줘').length === 0,
    JSON.stringify(findMentions('yunseok@gmail.com 로 보내줘')));
  check('@ 뒤가 비면 안 잡는다', findMentions('값이 @ 이다').length === 0, '');
  check('따옴표로 묶으면 통째로 잡는다', findMentions('@"한글 이름.txt" 읽어')[0]?.path === '한글 이름.txt',
    JSON.stringify(findMentions('@"한글 이름.txt" 읽어')));
}

trace('2-붙이기');

// ── 실제로 붙는가 ───────────────────────────────────────────────────────
{
  const r = 붙임('@src/a.js 이거 뭐 하는 거야?');
  check('파일 내용이 붙는다', r.text.includes('export default a;'), r.text.slice(0, 120));
  check('원래 하던 말은 남는다', r.text.includes('이거 뭐 하는 거야?'), r.text.slice(0, 120));
  check('무엇을 붙였는지 알려 준다', r.attached.length === 1, JSON.stringify(r.attached));
  check('붙인 경로를 보기 좋게 준다', /a\.js/.test(r.attached[0]?.show ?? ''), r.attached[0]?.show);
  check('줄 번호가 붙는다', /\b1\b.*const a = 1;/.test(r.text), r.text.slice(0, 200));
}

{
  const r = 붙임('@src/a.js 와 @src/b.js 를 비교해줘');
  check('두 개를 다 붙인다', r.attached.length === 2, JSON.stringify(r.attached.map((x) => x.show)));
  check('둘 다 내용이 들어간다', r.text.includes('export default a;') && r.text.includes('export const b = 2;'), '');
}

{
  const r = 붙임('@"한글 이름.txt" 이거');
  check('따옴표로 묶은 이름도 붙는다', r.text.includes('띄어쓰기가 든 이름'), r.text.slice(0, 150));
}

trace('3-아닌것');

// ── 파일이 아닌 @ 는 건드리지 않는다 ────────────────────────────────────
{
  const 원래 = 'yunseok@gmail.com 으로 보내고 @media 도 손봐줘';
  const r = 붙임(원래);
  check('이메일·@media 는 그냥 둔다', r.text === 원래, r.text);
  check('붙인 게 없다', r.attached.length === 0, '');
}

{
  const 원래 = '@없는파일.js 좀 봐줘';
  const r = 붙임(원래);
  check('없는 파일은 글자 그대로 둔다', r.text === 원래, r.text);
  check('없다고 조용히 적어 둔다', r.missing.length === 1, JSON.stringify(r.missing));
}

{
  // 작업 범위 밖은 절대 안 읽는다. @ 로 우회할 수 있으면 울타리가 없는 것과 같다.
  const r = 붙임('@../../../비밀.txt 읽어');
  check('작업 범위 밖은 안 붙인다', r.attached.length === 0, JSON.stringify(r.attached));
  check('막혔다고 남긴다', r.blocked.length === 1, JSON.stringify(r.blocked));
  check('막힌 것도 글자는 그대로', r.text.includes('@../../../비밀.txt'), r.text);
}

trace('4-폴더');

// ── 폴더를 지목하면 ─────────────────────────────────────────────────────
{
  const r = 붙임('@src 안에 뭐가 있어?');
  check('폴더는 목록을 붙인다', r.text.includes('a.js') && r.text.includes('b.js'), r.text.slice(0, 200));
  check('폴더라고 밝힌다', /폴더/.test(r.text), r.text.slice(0, 200));
  check('폴더도 붙인 것으로 센다', r.attached.length === 1, '');
}

trace('5-상한');

// ── 너무 크면 ───────────────────────────────────────────────────────────
{
  const r = 붙임('@큰것.txt 요약해줘', { budget: 400 });
  check('상한을 넘으면 앞부분만 붙인다', r.text.length < 20000, String(r.text.length));
  check('잘랐다고 말해 준다', /잘랐|일부만|중 /.test(r.text), r.text.slice(-200));
  check('잘린 것은 다 읽은 것으로 안 친다', r.attached[0]?.full === false, JSON.stringify(r.attached[0]));
}

{
  const r = 붙임('@src/a.js 짧은 것', { budget: 4000 });
  check('작은 파일은 통째로 붙는다', r.attached[0]?.full === true, JSON.stringify(r.attached[0]));
}

{
  // 여러 개를 붙여도 전체 상한을 넘지 않아야 한다. 컨텍스트를 통째로 먹으면
  // 정작 하려던 일을 못 한다.
  const r = 붙임('@큰것.txt @src/a.js @src/b.js', { budget: 500 });
  const 넘음 = r.text.length > 40000;
  check('여러 개를 붙여도 전체 상한을 지킨다', !넘음, String(r.text.length));
}

trace('6-인코딩');

// ── CP949 ───────────────────────────────────────────────────────────────
{
  const r = 붙임('@cp949.txt 뭐라고 적혀 있어?');
  check('CP949 파일도 제대로 읽는다', r.text.includes('가나'), JSON.stringify(r.text.slice(0, 120)));
  check('깨진 글자가 안 섞인다', !r.text.includes('�'), '');
}

trace('7-읽은것으로치기');

// ── 통째로 붙었으면 '읽은 파일' 로 친다 ─────────────────────────────────
{
  const seen = new Set();
  const r = 붙임('@src/a.js 고쳐줘', { seen });
  check('통째로 붙으면 읽은 것으로 친다', seen.size === 1, String(seen.size));
  check('그 파일이 맞다', [...seen][0].endsWith('a.js'), [...seen][0]);
  check('붙인 개수와도 맞는다', r.attached.length === 1, '');
}

{
  // 잘렸으면 읽은 것으로 치면 안 된다 — 안 본 데를 고치게 된다.
  const seen = new Set();
  붙임('@큰것.txt 고쳐줘', { budget: 300, seen });
  check('잘렸으면 읽은 것으로 안 친다', seen.size === 0, String(seen.size));
}

trace('8-이상한것');

// ── 이상한 값 ───────────────────────────────────────────────────────────
{
  check('빈 글이어도 안 죽는다', 붙임('').text === '', '');
  check('@ 하나만 있어도 안 죽는다', 붙임('@').text === '@', '');
  check('@@ 도 안 죽는다', typeof 붙임('@@src/a.js').text === 'string', '');
  check('없는 값이어도 안 죽는다', typeof expand(null, { scope }).text === 'string', '');
  check('scope 가 없어도 안 죽는다', typeof expand('@src/a.js', {}).text === 'string', '');
}

{
  // 문장부호가 붙어 와도 파일을 찾아야 한다.
  const r = 붙임('@src/a.js, 이거랑 @src/b.js. 둘 다');
  check('뒤에 붙은 쉼표·마침표를 떼고 찾는다', r.attached.length === 2, JSON.stringify(r.attached.map((x) => x.show)));
  check('문장부호는 글에 남는다', r.text.includes(',') && r.text.includes('.'), '');
}

trace('9-치움');
rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n@파일 지목  ${D}(아닌 것을 파일로 오해하지 않는 게 절반이다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

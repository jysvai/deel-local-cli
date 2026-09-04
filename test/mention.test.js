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
import { 내부살림 } from '../src/tools/fsutil.js';

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
  check('이메일은 안 잡는다', findMentions('hong@example.com 로 보내줘').length === 0,
    JSON.stringify(findMentions('hong@example.com 로 보내줘')));
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
  const 원래 = 'hong@example.com 으로 보내고 @media 도 손봐줘';
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

/*
 * ── 살림 파일은 @ 로도 못 붙인다 ────────────────────────────────────────
 *
 * mention.js 가 이 검사를 가리키고 있었는데 **검사가 없었다.** 주석은
 * `test/mention-secret.test.js` 를 가리켰고 그런 파일은 없다. 그러니까 이
 * 자리는 「지킨다고 적어 두고 아무도 안 재는」 상태였다 — 그게 제일 오래
 * 안 들키는 종류다.
 *
 * 무엇을 막나: Read 도구는 `.deel/config.json` 을 막고 있었는데 @ 는 안
 * 막고 있었다. 그래서 `@.deel/config.json` 한 줄이면 게이트웨이 열쇠가
 * 대화에 실려 그대로 바깥으로 나갔다. 도구는 막고 @ 는 안 막으면 막은 것이
 * 아니다.
 *
 * 울타리 밖(위 검사)과는 다른 축이다. 이건 **울타리 안에 있는데도 못 읽는**
 * 파일이라, 경로 검사로는 안 걸린다.
 */
{
  mkdirSync(join(root, '.deel'), { recursive: true });
  writeFileSync(join(root, '.deel', 'config.json'),
    '{"profiles":[{"key":"sk-비밀열쇠-절대-안-나가야-함"}]}', 'utf8');

  const r = 붙임('@.deel/config.json 좀 봐줘');
  check('★★ 살림 파일은 안 붙인다', r.attached.length === 0, JSON.stringify(r.attached));
  check('★★ 열쇠가 글에 안 실린다', !r.text.includes('sk-비밀열쇠'), r.text.slice(0, 80));
  check('막혔다고 남긴다', r.blocked.length === 1, JSON.stringify(r.blocked));
  // 막았다고 사람이 친 글자를 지우지는 않는다. 화면에서 무엇을 시켰는지는 남아야 한다.
  check('막힌 것도 글자는 그대로', r.text.includes('@.deel/config.json'), r.text.slice(0, 80));

  /*
   * ★★ 열쇠를 담는 파일이 config.json 하나가 아니다.
   *
   * mcp.json 은 붙여 둔 MCP 서버마다 env 를 통째로 적어 두는 자리라 토큰이
   * 그대로 들어 있다. 목록으로 막는 방식은 늘 이렇게 샌다 — 같은 종류의
   * 파일을 하나 늘려 놓고 목록에 안 올리면 그날부터 조용히 나간다.
   * (이 검사를 쓰면서 실제로 찾은 구멍이다.)
   */
  writeFileSync(join(root, '.deel', 'mcp.json'),
    '{"servers":{"깃허브":{"env":{"GITHUB_TOKEN":"ghp_비밀토큰"}}}}', 'utf8');
  const r2 = 붙임('@.deel/mcp.json 이거 봐줘');
  check('★★ MCP 설정도 안 붙인다', r2.attached.length === 0, JSON.stringify(r2.attached));
  check('★★ MCP 토큰이 글에 안 실린다', !r2.text.includes('ghp_비밀토큰'), r2.text.slice(0, 80));

  // 지난 대화 기록도 안 붙인다. 열쇠는 없지만 옛 대화가 통째로 들어온다.
  mkdirSync(join(root, '.deel', 'sessions'), { recursive: true });
  writeFileSync(join(root, '.deel', 'sessions', 'a1.jsonl'), '{"role":"user"}', 'utf8');
  const r3 = 붙임('@.deel/sessions/a1.jsonl');
  check('★ 지난 대화 기록도 안 붙인다', r3.attached.length === 0, JSON.stringify(r3.attached));
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

/*
 * ── 살림 자리는 옮길 수 있다 ────────────────────────────────────────────
 *
 * `DEEL_HOME` 이 정식 설정이다(config.js) — 사내 휴대용 설치와 검사가 쓴다.
 * 그런데 막는 자(내부살림)가 `.deel` 이라는 **글자**로 찾고 있었다. 이름에
 * 그 글자가 없는 자리로 옮기면 막이 통째로 풀리고, 그 순간 `config.json`
 * (게이트웨이 열쇠가 든 파일)이 그냥 읽힌다.
 */
{
  const 옛집 = process.env.DEEL_HOME;
  const 딴집 = join(tmpdir(), 'deel-딴이름-살림');
  process.env.DEEL_HOME = 딴집;
  try {
    check('★★ 옮긴 살림의 설정 파일도 막는다',
      !!내부살림(join(딴집, 'config.json')), String(내부살림(join(딴집, 'config.json'))).slice(0, 40));
    check('★★ 옮긴 살림의 MCP 설정도 막는다',
      !!내부살림(join(딴집, 'mcp.json')), String(내부살림(join(딴집, 'mcp.json'))).slice(0, 40));
    check('★ 기본 이름(.deel)도 그대로 막는다',
      !!내부살림(join('C:', 'Users', 'x', '.deel', 'config.json').replace(/\\/g, '/')));
    check('★ 남의 config.json 은 안 막는다 — 막는 것이 아니라 살림을 막는 것',
      내부살림(join(딴집, '..', '프로젝트', 'config.json')) === null,
      String(내부살림(join(딴집, '..', '프로젝트', 'config.json'))));
  } finally {
    if (옛집 == null) delete process.env.DEEL_HOME; else process.env.DEEL_HOME = 옛집;
  }
}


const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n@파일 지목  ${D}(아닌 것을 파일로 오해하지 않는 게 절반이다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

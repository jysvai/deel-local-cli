// 디스크에 있는 파일을 「없다」 고 하던 경로들.
//
// 모델은 사람 말에서 경로를 베껴 온다. 따옴표째, 앞뒤 빈칸째, 작업 폴더 이름을 앞에 한 번 더
// 붙여서, 터미널에 끌어다 놓은 모양으로, 맥이 저장한 자모 모양과 다른 모양으로 온다.
//
// 재는 것은 둘이다. 있는 파일을 찾는가. 그리고 **없는 데를 있는 것처럼 고치지 않는가** —
// 이름에 진짜 따옴표가 든 파일, 프로젝트와 같은 이름의 하위 폴더, 범위 밖 경로는 그대로여야 한다.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope, ScopeError, 경로인자맞추기 } from '../src/safety/guard.js';
import { TOOLS } from '../src/tools/index.js';
import { rg글로브들 } from '../src/tools/fastgrep.js';

let 통과 = 0;
let 실패 = 0;
const check = (이름, 됐나, 덧 = '') => {
  if (됐나) { 통과 += 1; console.log(`  ✓ ${이름}`); }
  else { 실패 += 1; console.log(`  ✗ ${이름}  ${덧}`); }
};

const 맨위 = realpathSync(mkdtempSync(join(tmpdir(), 'deel-pathfix-')));
const 프로젝트 = 'qwen 프로젝트';
const 판 = (꼴) => {
  const 뿌리 = join(맨위, 꼴, 프로젝트.normalize(꼴));
  mkdirSync(join(뿌리, 'hr_dashboard', 'js'), { recursive: true });
  mkdirSync(join(뿌리, '한글 폴더'.normalize(꼴)), { recursive: true });
  writeFileSync(join(뿌리, 'hr_dashboard', 'js', 'app.js'), 'function appMark() { return 1; }\n');
  writeFileSync(join(뿌리, '한글 폴더'.normalize(꼴), '보고서 (최종).md'.normalize(꼴)), '# appMark\n');
  return 뿌리;
};
const 문맥 = (뿌리) => ({ scope: makeScope(뿌리), seen: new Set(), 모델컨텍스트: 48000, 로컬: true });
const 부르기 = async (도구, 인자, ctx) => {
  경로인자맞추기(도구, 인자, ctx.scope);
  try { return await TOOLS[도구].run(인자, ctx); } catch (e) { return { error: e.message, 던짐: e }; }
};
const 찾음 = (r) => !r.error && /appMark|app\.js|보고서/.test(String(r.content ?? ''));
const 앞 = (r) => String(r.error ?? r.content ?? '').slice(0, 90);

console.log('경로 모양');
for (const 디스크 of ['NFC', 'NFD']) {
  const 뿌리 = 판(디스크);
  const ctx = 문맥(뿌리);
  const 앱 = 'hr_dashboard/js/app.js';
  const 절대 = `${뿌리.replaceAll('\\', '/')}/${앱}`;
  const 형태 = {
    상대: 앱,
    절대,
    '둥근 따옴표': `‘${앱}’`,
    '곧은 따옴표': `'${앱}'`,
    큰따옴표: `"${앱}"`,
    '둥근 큰따옴표': `“${앱}”`,
    낫표: `「${앱}」`,
    '겹친 따옴표': `"'${앱}'"`,
    '앞뒤 빈칸': `  ${앱} `,
    '작업 폴더 이름 겹침': `${프로젝트}/${앱}`,
    '작업 폴더 이름 겹침(자모 분리)': `${프로젝트.normalize('NFD')}/${앱}`,
    '점 빗금에 겹침': `./${프로젝트}/${앱}`,
    '둥근 따옴표 절대': `‘${절대}’`,
  };
  for (const [이름, p] of Object.entries(형태)) {
    const r = await 부르기('Read', { file_path: p }, ctx);
    check(`★★★ ${디스크}: Read 가 찾는다 — ${이름}`, 찾음(r), 앞(r));
    const o = await 부르기('Outline', { path: p }, ctx);
    check(`★★ ${디스크}: Outline 이 찾는다 — ${이름}`, !o.error, 앞(o));
  }
  for (const 말꼴 of ['NFC', 'NFD']) {
    const 글 = `${디스크} 디스크에 ${말꼴} 로 물음`;
    const r = await 부르기('Read', { file_path: '한글 폴더/보고서 (최종).md'.normalize(말꼴) }, ctx);
    check(`★★★ ${글}: Read`, 찾음(r), 앞(r));
    const g1 = await 부르기('Glob', { pattern: '*.md', path: '한글 폴더'.normalize(말꼴) }, ctx);
    check(`★★★ ${글}: Glob 폴더`, 찾음(g1), 앞(g1));
    const g2 = await 부르기('Glob', { pattern: '**/보고서*'.normalize(말꼴) }, ctx);
    check(`★★★ ${글}: Glob 이름 무늬`, 찾음(g2), 앞(g2));
    const g3 = await 부르기('Glob', { pattern: '한글 폴더/*.md'.normalize(말꼴) }, ctx);
    check(`★★★ ${글}: Glob 폴더 무늬`, 찾음(g3), 앞(g3));
    const g4 = await 부르기('Grep', { pattern: 'appMark', path: '한글 폴더'.normalize(말꼴), output_mode: 'files_with_matches' }, ctx);
    check(`★★★ ${글}: Grep 폴더`, 찾음(g4), 앞(g4));
    const g5 = await 부르기('Grep', { pattern: 'appMark', glob: '보고서*'.normalize(말꼴), output_mode: 'files_with_matches' }, ctx);
    check(`★★★ ${글}: Grep glob`, 찾음(g5), 앞(g5));
  }
  const 겹 = await 부르기('Glob', { pattern: '**/*.js', path: `${프로젝트}/hr_dashboard` }, ctx);
  check(`★★ ${디스크}: Glob 폴더에 작업 폴더 이름 겹침`, 찾음(겹), 앞(겹));
  const 무 = await 부르기('Glob', { pattern: `${프로젝트}/hr_dashboard/**/*.js` }, ctx);
  check(`★★ ${디스크}: Glob 무늬에 작업 폴더 이름 겹침`, 찾음(무), 앞(무));
  const 따 = await 부르기('Glob', { pattern: '‘**/*.js’' }, ctx);
  check(`★★ ${디스크}: Glob 무늬에 따옴표`, 찾음(따), 앞(따));
  const 절 = await 부르기('Glob', { pattern: `${뿌리.normalize('NFC').replaceAll('\\', '/')}/hr_dashboard/**/*.js` }, ctx);
  check(`★★ ${디스크}: Glob 절대 무늬(뿌리를 다른 모양으로)`, 찾음(절), 앞(절));
  const 찾 = await 부르기('Grep', { pattern: 'appMark', path: `${프로젝트}/hr_dashboard`, output_mode: 'files_with_matches' }, ctx);
  check(`★★ ${디스크}: Grep 폴더에 작업 폴더 이름 겹침`, 찾음(찾), 앞(찾));
}

console.log('고치면 안 되는 것');
{
  const 뿌리 = join(맨위, 'proj');
  mkdirSync(join(뿌리, 'proj'), { recursive: true });
  mkdirSync(join(뿌리, 'src'), { recursive: true });
  writeFileSync(join(뿌리, "'q'.txt"), '진짜 따옴표\n');
  writeFileSync(join(뿌리, 'q.txt'), '따옴표 없음\n');
  writeFileSync(join(뿌리, 'a.txt'), '바깥 a\n');
  writeFileSync(join(뿌리, 'proj', 'a.txt'), '안쪽 a\n');
  const ctx = 문맥(뿌리);
  const 고치기 = (도구, 인자) => { 경로인자맞추기(도구, 인자, ctx.scope); return 인자; };

  const 진짜 = await 부르기('Read', { file_path: "'q'.txt" }, ctx);
  check('★★★ 이름에 진짜 따옴표가 든 파일은 그 파일을 읽는다', /진짜 따옴표/.test(String(진짜.content)), 앞(진짜));
  const 안쪽 = await 부르기('Read', { file_path: 'proj/a.txt' }, ctx);
  check('★★★ 프로젝트와 같은 이름의 하위 폴더가 있으면 그 안을 읽는다', /안쪽 a/.test(String(안쪽.content)), 앞(안쪽));
  check('★★★ 새 파일: proj/__init__.py 를 뿌리로 당기지 않는다', 고치기('Write', { file_path: 'proj/__init__.py' }).file_path === 'proj/__init__.py');
  check('★★ 새 파일: 없는 폴더 이름은 그대로 둔다', 고치기('Write', { file_path: 'proj2/a.py' }).file_path === 'proj2/a.py');
  check('★★★ 새 파일: 따옴표째 만들지 않는다', 고치기('Write', { file_path: '‘new.js’' }).file_path === 'new.js');
  check('★★ 새 파일: 겹친 이름 뒤 폴더가 있으면 안쪽으로 당긴다', 고치기('Write', { file_path: 'proj/src/new.js' }).file_path === 'src/new.js');
  check('★★ 묶음 꼴도 맞춘다', 고치기('Write', { files: [{ file_path: '‘new.js’' }] }).files[0].file_path === 'new.js');
  check('★★ Move 도 맞춘다', 고치기('Move', { from: '“a.txt”', to: '‘b.txt’' }).to === 'b.txt');
  check('★★★ Grep 의 정규식은 건드리지 않는다', 고치기('Grep', { pattern: "'q'" }).pattern === "'q'");
  check('★★ 있는 경로는 글자 하나 안 바꾼다', 고치기('Read', { file_path: './src/../a.txt' }).file_path === './src/../a.txt');

  const 밖1 = await 부르기('Read', { file_path: '‘../../바깥.txt’' }, ctx);
  check('★★★ 따옴표를 벗겨도 범위 밖은 막는다', 밖1.던짐 instanceof ScopeError, 앞(밖1));
  const 집 = process.env.HOME;
  const 윈집 = process.env.USERPROFILE;
  process.env.HOME = 맨위;
  process.env.USERPROFILE = 맨위;
  try {
    const 물결 = await 부르기('Read', { file_path: '~/proj/a.txt' }, ctx);
    check('★★ ~/ 로 적은 작업 폴더 안 파일을 찾는다', /바깥 a/.test(String(물결.content)), 앞(물결));
    const 밖2 = await 부르기('Read', { file_path: '~/바깥.txt' }, ctx);
    check('★★★ ~/ 로 적어도 범위 밖은 막는다', !!밖2.error && !밖2.content, 앞(밖2));
  } finally {
    if (집 === undefined) delete process.env.HOME; else process.env.HOME = 집;
    if (윈집 === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = 윈집;
  }

  mkdirSync(join(뿌리, '.deel'), { recursive: true });
  writeFileSync(join(뿌리, '.deel', 'config.json'), '{"key":"비밀열쇠"}\n');
  const 살림 = await 부르기('Read', { file_path: '‘.deel/config.json’' }, ctx);
  check('★★★ 따옴표를 벗겨도 살림 파일은 안 읽는다', !/비밀열쇠/.test(JSON.stringify(살림)), 앞(살림));

  if (process.platform !== 'win32') {
    const 빈칸뿌리 = join(맨위, 'a b');
    mkdirSync(join(빈칸뿌리, 'c d'), { recursive: true });
    writeFileSync(join(빈칸뿌리, 'c d', 'x.txt'), 'appMark\n');
    const 맥 = await 부르기('Read', { file_path: `${빈칸뿌리.replace(/ /g, '\\ ')}/c\\ d/x.txt` }, 문맥(빈칸뿌리));
    check('★★★ 터미널에 끌어다 놓은 모양을 찾는다', 찾음(맥), 앞(맥));
  }
}

console.log('Argon 이 짚은 자리');
{
  const 푸 = join(맨위, 'foo');
  mkdirSync(푸, { recursive: true });
  writeFileSync(join(푸, '__init__.py'), 'appMark\n');
  const ctx푸 = 문맥(푸);
  const 쓰기 = { file_path: 'foo/__init__.py' };
  경로인자맞추기('Write', 쓰기, ctx푸.scope);
  check('★★★ Write 는 겹친 이름을 뿌리의 있는 파일로 끌어오지 않는다', 쓰기.file_path === 'foo/__init__.py', 쓰기.file_path);
  const 옮김 = { from: '__init__.py', to: 'foo/__init__.py' };
  경로인자맞추기('Move', 옮김, ctx푸.scope);
  check('★★★ Move 의 도착지도 끌어오지 않는다', 옮김.to === 'foo/__init__.py', 옮김.to);
  const 읽기 = await 부르기('Read', { file_path: 'foo/__init__.py' }, ctx푸);
  check('★★ Read 는 있는 파일로 찾아 준다', 찾음(읽기), 앞(읽기));

  const 앱뿌리 = join(맨위, 'app');
  mkdirSync(join(앱뿌리, 'packages', 'app'), { recursive: true });
  writeFileSync(join(앱뿌리, 'packages', 'app', 'a.js'), 'appMark\n');
  writeFileSync(join(앱뿌리, 'packages', 'b.js'), 'appMark\n');
  const ctx앱 = 문맥(앱뿌리);
  const g = await 부르기('Glob', { path: 'packages', pattern: 'app/*.js' }, ctx앱);
  check('★★★ path 를 준 무늬의 앞 칸은 안 뗀다', /packages\/app\/a\.js/.test(String(g.content)) && !/b\.js/.test(String(g.content)), 앞(g));
  const 빼기 = await 부르기('Grep', { pattern: 'appMark', path: 'packages', glob: '!app/*.js', output_mode: 'files_with_matches' }, ctx앱);
  check('★★★ path 를 준 빼기 무늬도 안 뗀다', /b\.js/.test(String(빼기.content)) && !/a\.js/.test(String(빼기.content)), 앞(빼기));

  const 범위 = await 부르기('Grep', { pattern: 'appMark', glob: '[가-힣]*.md', output_mode: 'files_with_matches' }, 문맥(판('NFC')));
  check('★★★ 한글 범위 무늬에 rg 가 안 죽는다', 찾음(범위), 앞(범위));

  const 덮 = join(맨위, 'deelsub');
  mkdirSync(join(덮, 'sub'), { recursive: true });
  writeFileSync(join(덮, '.deelignore'), 'secret.key\n');
  writeFileSync(join(덮, 'sub', '.gitignore'), '*.key\n');
  writeFileSync(join(덮, 'sub', 'secret.key'), 'x\n');
  writeFileSync(join(덮, 'sub', 'open.key'), 'x\n');
  const 하위 = await 부르기('Glob', { path: 'sub', pattern: '*.key' }, 문맥(덮));
  check('★★★ 하위 폴더를 찾아도 뿌리의 .deelignore 를 지킨다', /open\.key/.test(String(하위.content)) && !/secret/.test(String(하위.content)), 앞(하위));
}

console.log('못 찾았을 때 말');
{
  const 뿌리 = join(맨위, 'hint');
  mkdirSync(join(뿌리, 'a', 'b'), { recursive: true });
  mkdirSync(join(뿌리, 'data'), { recursive: true });
  mkdirSync(join(뿌리, 'secret'), { recursive: true });
  writeFileSync(join(뿌리, 'a', 'b', 'app.js'), 'x\n');
  writeFileSync(join(뿌리, '.gitignore'), 'data/\nsecret/\n');
  writeFileSync(join(뿌리, '.deelignore'), 'secret/\n');
  writeFileSync(join(뿌리, 'data', '직원.csv'), 'a,b\n');
  writeFileSync(join(뿌리, 'secret', '급여.csv'), 'a,b\n');
  const ctx = 문맥(뿌리);
  const 힌트 = await 부르기('Read', { file_path: 'app.js' }, ctx);
  check('★★★ 다른 폴더의 같은 이름 파일을 알려 준다', /a\/b\/app\.js/.test(String(힌트.error)), 앞(힌트));
  const 없음 = await 부르기('Read', { file_path: '정말없는파일.zzz' }, ctx);
  check('★★ 진짜 없으면 그냥 없다고 한다', !!없음.error && !/a\/b/.test(없음.error), 앞(없음));
  const 가려 = await 부르기('Glob', { pattern: '**/*.csv' }, ctx);
  check('★★★ .gitignore 에 가려진 파일은 이름을 알려 준다', /data\/직원\.csv/.test(String(가려.content)), 앞(가려));
  check('★★★ .deelignore 로 뺀 파일은 끝까지 안 낸다', !/급여/.test(String(가려.content)), 앞(가려));
  const 진짜없음 = await 부르기('Glob', { pattern: '**/*.zzz' }, ctx);
  check('★★ 가려진 데도 없으면 없다고 한다', /찾은 파일 없음/.test(String(진짜없음.content)), 앞(진짜없음));
}

console.log('드문 모양');
{
  const 뿌리 = join(맨위, 'rv', 'proj');
  mkdirSync(join(뿌리, 'src'), { recursive: true });
  mkdirSync(join(뿌리, 'proj', 'lib'), { recursive: true });
  writeFileSync(join(뿌리, 'src', 'a.js'), 'x');
  const sc = makeScope(뿌리);
  const 무늬 = (인자) => { 경로인자맞추기('Glob', 인자, sc); return 인자.pattern; };
  check('★★ 양끝만 괄호인 새 이름은 안 벗긴다', sc.바로잡기('「1부」 「2부」', { 쓰기: true }) === '「1부」 「2부」', sc.바로잡기('「1부」 「2부」', { 쓰기: true }));
  check('★★ .. 이 든 경로는 앞칸을 안 뗀다', sc.바로잡기('proj/../proj/src/a.js') === 'proj/../proj/src/a.js', sc.바로잡기('proj/../proj/src/a.js'));
  check('★★ path 가 작업 폴더면 무늬의 겹친 이름을 뗀다', 무늬({ pattern: 'proj/src/*.js', path: '.' }) === 'src/*.js', 무늬({ pattern: 'proj/src/*.js', path: '.' }));
  check('★★ 같은 이름 하위 폴더가 있어도 다음 칸이 없으면 겹친 것이다', 무늬({ pattern: 'proj/src/*.js' }) === 'src/*.js', 무늬({ pattern: 'proj/src/*.js' }));
  check('★★ 같은 이름 하위 폴더에 다음 칸이 있으면 그대로다', 무늬({ pattern: 'proj/lib/*.js' }) === 'proj/lib/*.js', 무늬({ pattern: 'proj/lib/*.js' }));
  check('★★ 무늬의 이스케이프는 경로 구분자가 아니다', 무늬({ pattern: 'proj/src/a\\[1\\].js' }) === 'src/a\\[1\\].js', 무늬({ pattern: 'proj/src/a\\[1\\].js' }));
  const 글로브 = rg글로브들('한글/[가-힣].js');
  check('★★★ 대괄호가 있어도 바깥 글자는 두 모양을 다 준다', 글로브.includes(`${'한글'.normalize('NFD')}/[가-힣].js`) && 글로브.includes(`${'한글'.normalize('NFC')}/[가-힣].js`), 글로브.join(' | '));
  check('★★ 무늬에 .. 이 들면 앞칸을 안 뗀다', 무늬({ pattern: 'proj/nope/../../*' }) === 'proj/nope/../../*', 무늬({ pattern: 'proj/nope/../../*' }));
  const 글자대괄호 = rg글로브들('\\[한글\\]/*.js');
  check('★★ 이스케이프한 대괄호는 범위가 아니라 안의 글자도 두 모양을 다 준다', 글자대괄호.includes(`\\[${'한글'.normalize('NFD')}\\]/*.js`), 글자대괄호.join(' | '));
  const 맨앞닫힘 = rg글로브들('[^]가-힣]/한글.js');
  check('★★ 범위 맨 앞의 닫는 괄호를 범위 끝으로 안 본다', 맨앞닫힘.includes(`[^]가-힣]/${'한글'.normalize('NFD')}.js`) && !맨앞닫힘.some((x) => x.includes(`${'가'.normalize('NFD')}-`)), 맨앞닫힘.join(' | '));
  const 대괄호안빗금 = rg글로브들('[\\]-가]/한글.js');
  check('★★ 범위 안의 이스케이프를 대괄호 끝으로 안 본다', 대괄호안빗금.includes(`[\\]-가]/${'한글'.normalize('NFD')}.js`) && !대괄호안빗금.some((x) => x.includes(`-${'가'.normalize('NFD')}]`)), 대괄호안빗금.join(' | '));
}

rmSync(맨위, { recursive: true, force: true });
console.log(`\n  통과 ${통과} · 실패 ${실패}`);
process.exitCode = 실패 ? 1 : 0;

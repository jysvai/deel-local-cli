// 눈으로 보는 검증 — 전체화면(TUI)이 실제로 어떻게 그려지는지.
//
// 왜 따로 만들었나:
//   TUI 는 터미널일 때만 켜진다. 검사는 파이프로 돌아가므로 그 코드가
//   한 번도 안 돈다 — 즉 '검사 전부 통과' 가 '화면이 맞다' 를 뜻하지 않는
//   유일한 자리다. 그래서 TuiScreen 이 그릴 화면을 **값으로** 내놓게 하고
//   (프레임()), 그걸 그대로 찍어 본다. 진짜 터미널에 뜨는 글자와 같다.
//
// 돌리는 법:  node test/demo-tui.mjs
//             node test/demo-tui.mjs --plain          색 빼고 (테두리 보기 좋다)
//             node test/demo-tui.mjs --cols=80        좁은 창에서
process.env.FORCE_COLOR = '1';

const 색없이 = process.argv.includes('--plain');
const 행 = Number(process.argv.find((a) => a.startsWith('--rows='))?.slice(7)) || 26;
const 열 = Number(process.argv.find((a) => a.startsWith('--cols='))?.slice(7)) || 104;

// TureScreen 은 만들 때 딴 화면으로 넘어가는 제어문자를 뱉는다. 여기서는
// 화면을 안 바꾸고 글만 보고 싶으니 그 사이 출력만 삼킨다.
const 진짜쓰기 = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
Object.defineProperty(process.stdout, 'rows', { value: 행, configurable: true });
Object.defineProperty(process.stdout, 'columns', { value: 열, configurable: true });

const { TuiScreen } = await import('../src/ui/tui.js');
const { c, width } = await import('../src/ui/ansi.js');

const 화면 = new TuiScreen();

// ── 실제로 오갈 법한 한 턴을 그대로 먹인다 ──────────────────────────────
화면.머리말([
  `${c.hcyan(c.bold('deel'))}  ${c.gray('OpenAI 호환 규격')}`,
  `${c.gray('모델')}    ${c.white('qwen2.5-coder:7b')}  ${c.gray('(128k 토큰)')}`,
  `${c.gray('보냄')}    ${c.green('이 컴퓨터 안')} ${c.white('127.0.0.1:11434')}`,
]);
화면.줄('');
화면.줄(` ${c.hcyan('❯')} ${c.white('로그 형식 통일하고 할 일도 정리해줘')}`);
화면.줄('');
화면.줄(`  ${c.magenta('❊')} ${c.bold('Grep')}${c.gray('(console.log)')}`);
화면.줄(`    ${c.gray('└')} ${c.gray('3개 파일 · 11건')}`);
화면.줄('');
화면.줄(`  ${c.yellow('◈')} ${c.bold('Edit')}${c.gray('(src/runner.js)')}`);
화면.줄(`    ${c.gray('└')} ${c.gray('1군데')} ${c.green('+3')}${c.red('-1')}`);
화면.줄(`    ${c.red('-')} ${c.gray(' 12')} ${c.red("console.log('시작', 이름)")}`);
화면.줄(`    ${c.green('+')} ${c.gray(' 12')} ${c.green("logger.info({ 단계: '시작', 이름 })")}`);
화면.줄('');
화면.파일칸([
  `${c.white('src/runner.js')} ${c.green('+3')}${c.red('-1')}`,
  `${c.white('src/index.js')} ${c.green('+1')}${c.red('-1')}`,
  `${c.white('src/ui/log.js')} ${c.green('+12')}${c.red('-0')}`,
]);
화면.할일칸([
  `${c.green('☑')} ${c.gray('로그 호출 찾기')}`,
  `${c.green('☑')} ${c.gray('runner.js 통일')}`,
  `${c.hyellow('▶')} ${c.white('index.js 통일')}`,
  `${c.gray('☐')} ${c.gray('문서 갱신')}`,
]);
// 긴 답이 칸 안에서 접히는지 — 여기가 제일 잘 깨지는 자리다.
화면.붙임(`  ${c.hcyan('▌')} `);
화면.붙임('로그 호출을 logger 형식으로 통일했습니다. 한글이 섞이면 폭이 두 칸이라 '
  + '테두리가 밀리기 쉬워서, 일부러 길게 써서 접히는 자리를 봅니다. runner.js 한 군데입니다.');
화면.줄('');
화면.줄(`  ${c.gray('──')} ${c.gray('4.2초 · 도구 3회 · ↑3,900 ↓180')}`);
화면.기다림(c.gray('이어가기·low 생각 중…'));
화면.입력자리({
  root: 'C:/work/myproject',
  conn: { model: 'qwen2.5-coder:7b', ctx: 131072 },
  breakdown: () => ({ used: 28672, total: 131072, left: 102400 }),
  work: 'auto', effectiveWork: () => 'auto', routed: null,
  think: 'medium', effort: 'save', mode: 'auto',
  usage: { in: 3900, out: 180, calls: 3, ms: 0 },
});

process.stdout.write = 진짜쓰기;
화면.닫힘 = true;   // close() 가 대화를 또 쏟지 않게 — 여기서는 화면만 본다

const { 줄들 } = 화면.프레임();
const 벗기기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

console.log(`\n\x1b[90m─── 전체화면 ${열}×${행} ${색없이 ? '· 색 뺌' : ''} ────────────────────\x1b[0m\n`);
for (const l of 줄들) console.log(색없이 ? 벗기기(l) : l);

// 자로 잰다. 한 칸 어긋난 것은 눈으로 못 본다.
const 폭들 = 줄들.map((l) => width(l));
const 테두리 = 줄들.map((l, i) => [i, 폭들[i]]).filter(([i]) => /[┌└│├┬┴┐┘╭╰╮╯]/.test(벗기기(줄들[i])));
const 어긋남 = 테두리.filter(([, w]) => w !== 열);

console.log('');
console.log(`\x1b[90m창 폭 ${열} · 테두리 줄 ${테두리.length}개\x1b[0m`);
if (어긋남.length === 0) {
  console.log('\x1b[32m✓ 테두리가 한 칸도 안 어긋납니다\x1b[0m');
} else {
  console.log(`\x1b[31m✗ ${어긋남.length}줄이 어긋났습니다 — ${어긋남.map(([i, w]) => `${i + 1}행:${w}칸`).join(', ')}\x1b[0m`);
}
console.log(`\x1b[90m화면 높이 ${줄들.length}/${행}\x1b[0m\n`);

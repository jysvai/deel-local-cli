// 입력 상자를 눈으로 보는 자리.
//
// 검사는 파이프로 도니 진짜 화면을 못 본다. 여기서는 상자가 내놓는 값을
// 그대로 찍어 본다 — 테두리가 한 칸이라도 어긋나면 바로 보인다.
//
//   node test/demo-tui.mjs
process.env.FORCE_COLOR = '1';
const { 프레임 } = await import('../src/ui/inputbox.js');
const { width } = await import('../src/ui/ansi.js');

const D = '\x1b[90m'; const X = '\x1b[0m'; const G = '\x1b[32m'; const R = '\x1b[31m';

const 상태 = ' \x1b[90m▏\x1b[0m\x1b[90mmyproject\x1b[0m\x1b[90m · \x1b[0m\x1b[96mqwen2.5-coder:7b\x1b[0m'
  + ' \x1b[90m▏\x1b[0m \x1b[92m▰▰\x1b[0m\x1b[90m▱▱▱▱▱▱\x1b[0m \x1b[90m22%\x1b[0m'
  + ' \x1b[90m▏\x1b[0m \x1b[96m◎\x1b[0m \x1b[37m종합\x1b[0m\x1b[90m · \x1b[0m\x1b[93mauto\x1b[0m';

function 보이기(제목, o) {
  const { 줄들, 커서 } = 프레임(o);
  console.log(`\n${D}─── ${제목}  (폭 ${o.폭})${'─'.repeat(Math.max(0, 30 - 제목.length))}${X}\n`);
  for (const l of 줄들) console.log(l);

  // 테두리가 어긋나지 않는가 — 눈이 아니라 자로 잰다.
  const 테두리 = 줄들.filter((l) => /[╭╰│]/.test(l));
  const 폭들 = [...new Set(테두리.map((l) => width(l)))];
  const 맞나 = 폭들.length === 1;
  console.log(`\n${맞나 ? G + '✓ 테두리가 한 칸도 안 어긋납니다' : R + '✗ 테두리 폭이 갈립니다: ' + 폭들.join(', ')}${X}`);
  console.log(`${D}줄 ${줄들.length}개 · 커서 = 마지막 줄에서 ${커서.위}줄 위, ${커서.열}칸${X}`);
}

보이기('빈 상자', { 글: '', 폭: 100, 상태 });
보이기('치는 중', { 글: '집계 함수 좀 줄여줘', 커서: 10, 폭: 100, 상태 });
보이기('영문 섞임', { 글: 'src/runner.js 의 console.log 를 logger 로 바꿔줘', 폭: 100, 상태 });
보이기('접히는 긴 글', {
  글: '사내 문서를 CP949 로 읽어서 UTF-8 로 되돌려 쓰는 스크립트를 만들어줘. 폴더 안 파일 전부에 대해서 하고, 원본은 백업 폴더에 남겨줘.',
  폭: 72, 상태,
});
보이기('좁은 창', { 글: '한글 폭 확인용 가나다라마바사', 폭: 44, 상태: '' });
보이기('경고와 곁말', {
  글: '', 폭: 90, 상태,
  경고: '\x1b[33m⚠ 컨텍스트가 82% 찼습니다 — /compact 로 줄이세요\x1b[0m',
  곁말: '/help 명령 목록   Shift+Tab 작업 모드   Ctrl+C 중단',
});
console.log('');

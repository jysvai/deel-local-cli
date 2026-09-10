// 모드를 고르는 규칙이 **실제로 걸리는가**.
//
// ── 왜 이 검사가 생겼나 ─────────────────────────────────────────────────
//
// route.js 의 「손대라는 말」 무늬가 여러 마디로 시킨 말을 거의 다 놓치고
// 있었다. 무늬를 템플릿 글로 짓는데 `\s` 를 한 겹으로 적어서, 자바스크립트가
// 백슬래시를 먼저 먹고 **글자 `s`** 만 정규식에 닿았기 때문이다.
//
//     적은 것   ...|라(?=[\s.!?~,]|$))
//     닿은 것   ...|라(?=[s.!?~,]|$))     ← 빈칸이 아니라 알파벳 s
//
//     "그것 좀 바꿔라"        걸림   (글 끝이라)
//     "바꿔라 지금 해줘"      안 걸림 ← 사람이 쓰는 말은 거의 다 이쪽이다
//
// 걸려야 할 것이 안 걸리면 고쳐 달라는 지시가 **읽기 전용 모드**로 간다.
// 사람은 고쳐 달라고 세 번 적었는데 아무것도 안 바뀐 화면을 받는다.
//
// ── 이 부류가 왜 안 걸리나 ──────────────────────────────────────────────
//
// 안 걸리는 규칙은 **아무 데서도 안 터진다.** 점수만 안 오를 뿐이고, 그러면
// 다른 규칙이 이겨서 그럴듯한 모드가 나온다. 검사도 초록이고 화면도 멀쩡하다.
// 같은 무늬 안의 `\\S{0,3}` 는 두 겹이라 멀쩡했다 — 한 무늬에서 한쪽만
// 틀리니 눈으로는 더 안 보인다.
//
// 그래서 「규칙이 있다」 가 아니라 **「규칙이 실제로 걸린다」** 를 잰다.
// 여기서 재는 것은 넷이다.
//
//   1. 점수표(표)의 규칙 하나하나가 실제 문장에 걸린다
//   2. 글자열로 지은 정규식에서 이스케이프가 죽지 않았다 (저장소 전체)
//   3. 손대는 동사 목록이 통째로 살아 있다 — 어미 세 가지로 다 걸어 본다
//   4. 읽기만 하는 모드 목록이 modes.js 와 같다
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { 표, 손대라했나, 손대는동사, 읽기만하는모드, route } from '../src/agent/route.js';
import { canWrite, ORDER } from '../src/agent/modes.js';
import { trace } from './trace.mjs';

const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 1. 점수표의 규칙이 **하나도 빠짐없이** 실제 문장에 걸린다 ───────────
trace('1-죽은규칙');
{
  /*
   * 사람이 실제로 치는 말이다. 규칙 하나가 죽으면 여기서 빨개진다.
   *
   * 규칙을 새로 넣는 사람은 이 목록에 한 줄을 더한다. 목록이 안 닿는 규칙은
   * 「넣었지만 걸리는지 아무도 안 본 규칙」 이고, 그건 없는 것과 같다.
   *
   * 여기서 재는 것은 **어느 모드로 갔나** 가 아니다 (그건 route.test.js 가
   * 잰다). 규칙 하나하나가 살아 있나만 본다 — 한 문장이 여러 규칙에 걸려도
   * 괜찮다.
   */
  const 문장들 = [
    // 고장
    '로그인이 왜 안 되지?',
    '어제부터 저장이 안 됩니다',
    '스크롤이 작동 안 함',
    '버튼이 동작 안 해요',
    '빌드하면 에러 나는데 봐줘',
    '버그 하나 있는데 봐줘',
    '테스트가 자꾸 실패해',
    '배포하다 터졌어',
    '앱이 시작하자마자 죽어요',
    '스크롤이 가끔 멈춰',
    '창이 먹통이 됐어',
    '정렬 순서가 이상해',
    '재현 절차는 이렇습니다',
    '스택 트레이스 붙여 넣을게',
    'TypeError: cannot read property of undefined',
    'the build is broken on windows',
    '어디가 고장 났는지 모르겠어',
    '이 값이 왜 이래',
    '왜 못 읽지',
    '이거 뭐 때문에 느려졌지',
    '원인 좀 찾아줘',

    // 계획
    '작업 계획부터 잡자',
    '먼저 플랜 좀 보여줘',
    '먼저 살펴보고 이야기하자',
    '이거 어떤 순서로 하면 좋을까',
    '순서를 정해 줘',
    '단계로 나눠서 보여 줘',
    '리팩터링 로드맵 좀 그려줘',
    '방향만 잡아 주세요',
    '작업하기 전에 검토하자',
    '뭐부터 하면 될까',

    // 설계
    '인증 레이어 설계 좀 봐줘',
    '아키텍처 관점에서 어느 쪽이 나을까',
    '이 모듈 구조를 어떻게 바꾸는 게 좋을까',
    '상태 관리를 어떻게 나누는 게 좋을지',
    '모듈로 나누는 게 나을까',
    '의존성 방향이 뒤집힌 것 같아',
    '계층을 하나 더 두는 건 어때',
    '대안 두어 개만 보여 줘',
    '여기 어떤 패턴을 쓰는 게 맞을까',
    'what is the best structure here',

    // 점검
    '배포 전에 점검 좀 해줘',
    '이 로그 분석 좀',
    '전체적으로 검토해줘',
    '이 변경 리뷰 부탁해',
    '권한 설정을 감사해 줘',
    '한 번 훑어 봐',
    '취약점 있는지 봐줘',
    '보안 구멍 없는지 봐줘',
    '경합이 나는 것 같아',
    '데이터 유실 나는 자리 없나',
    '동시 편집하면 어떻게 되나',
    '충돌 나는 자리가 있는지 봐줘',
    '값이 서로 어긋나 있어',
    '누락된 항목이 있는지 봐줘',
    '위험한 자리 짚어 줘',
    '결함이 있나 봐줘',
    '터질 가능성이 있는 자리',
    '문제가 있는지 봐줘',
    '이상한 자리 찾아 줘',
    'please review this diff',
    'is there a deadlock here',

    // 설명
    '이 함수 뭐야?',
    '이 값이 무엇입니까',
    '이거 뭐 하는 파일이야?',
    '얘는 뭐 하나',
    '이 모듈은 무슨 역할이야',
    '이 코드가 어떻게 동작하는지 설명해줘',
    '어디에 쓰이는지 알려 줘',
    '이게 어떻게 돌아가는 거야',
    '이 설정값 무슨 뜻이야',
    'useMemo 랑 useCallback 차이가 뭐야',
    '왜 이렇게 짰는지 궁금해',
    'what is this flag for',
    '읽어 보고 설명해 줘',

    // 총괄
    '테스트 전부 다시 짜고 끝까지 돌려줘',
    '전체 로그 형식을 다 통일해줘',
    '여러 파일에 흩어진 거 하나씩 다 정리해줘',
    '마무리까지 한 번에 해줘',
    '순서대로 하나씩 해줘',
    'run it end-to-end',

    /*
     * 「… 좀 해줘」 — 낱말과 '좀' 사이에 빈칸이 오는 꼴. 규칙마다 이 가지가
     * 따로 있고, 가지가 죽어도 다른 가지가 걸려서 규칙은 살아 보인다.
     * 그래서 가지 하나에 문장 하나를 붙여 둔다 (아래 빈칸좀 검사가 요구한다).
     */
    '배포 전에 점검 좀 해줘',
    '이 로그 분석 좀 해줘',
    '이거 검토 좀 해줘',
    '이 변경 리뷰 좀 해줘',
    '이 함수 설명 좀 해줘',
    '로그 형식 통일 좀 해줘',
    '이 함수 수정 좀 해줘',
    '널 체크 추가 좀 해줘',
    '캐시 구현 좀 해줘',
    '이 값 변경 좀 해줘',
    '이 줄 삭제 좀 해줘',
    '이 부분 리팩터링 좀 해줘',

    // 구현
    '이 부분 고쳐줘',
    '이 함수에 널 체크 추가해줘',
    '캐시 로직 구현해줘',
    '로그인 버튼 색 좀 바꿔줘',
    '쓰지 않는 import 지워줘',
    '이 파일 이름 바꿔줘',
    '이 함수 다른 파일로 옮겨줘',
    '이 부분 리팩터링해 줘',
    'fix the typo in the header',
    'README 에 설치 방법 좀 써줘',
  ];

  const 안걸린규칙 = [];
  for (const [모드, 규칙들] of Object.entries(표)) {
    규칙들.forEach(([re], i) => {
      if (!문장들.some((s) => re.test(s))) 안걸린규칙.push(`${모드}[${i}] ${String(re)}`);
    });
  }

  /*
   * ── 규칙이 살아 있는 것과 **그 가지가** 살아 있는 것은 다르다 ──────────
   *
   * 위 검사는 `re.test(s)` 하나만 본다. 그런데 규칙은 대개 `(해|\s*좀|을)`
   * 처럼 가지가 여럿이다. 가지 하나가 죽어도 다른 가지가 걸리면 규칙 전체는
   * 「걸린다」 로 나온다 — 죽은 가지는 그대로 지나간다.
   *
   * 실제로 그랬다. 「… 좀 해줘」 를 살린 규칙 열둘 중 넷(통일·추가·변경·
   * 리팩터)은 검사 문장이 전부 `해` 가지로 걸리고 있었다. 그 넷은 옛 모양
   * (`통일(해|시켜|좀)`)으로 되돌려도 검사가 초록이었다. 고쳤다고 적어 둔
   * 것의 3분의 1이 안 지켜지고 있었던 셈이다.
   *
   * 그래서 이 가지만은 **따로** 잰다. 규칙 소스에 `\s*좀` 이 있으면, 그
   * 낱말과 '좀' 사이에 **빈칸이 든** 문장이 목록에 있어야 한다. 새 규칙에
   * 그 가지를 넣는 사람은 문장도 같이 넣게 된다.
   */
  const 빈칸좀없는것 = [];
  for (const [모드, 규칙들] of Object.entries(표)) {
    규칙들.forEach(([re], i) => {
      const 소스 = String(re);
      if (!소스.includes('\\s*좀')) return;
      /*
       * **걸린 글자**를 본다. 규칙에서 낱말을 뽑아내려 하면 `리팩터(링)?(해|\s*좀)`
       * 처럼 사이에 다른 묶음이 낀 모양에서 빗나간다. 걸린 자리에 「빈칸+좀」 이
       * 들었으면 그 가지로 걸린 것이 확실하다.
       */
      const 걸림 = 문장들.some((s) => /\s좀/.test(s.match(re)?.[0] ?? ''));
      if (!걸림) 빈칸좀없는것.push(`${모드}[${i}] ${소스} — 「… 좀」 으로 걸리는 문장이 없다`);
    });
  }
  check('★★★ 「… 좀」 가지마다 빈칸이 든 문장이 있다 (가지가 죽어도 규칙은 살아 보인다)',
    빈칸좀없는것.length === 0, 빈칸좀없는것.slice(0, 6).join(' · '));
  const 규칙수 = Object.values(표).reduce((n, r) => n + r.length, 0);
  check(`★★★ 점수표 규칙 ${규칙수}개가 전부 실제 문장에 걸린다`,
    안걸린규칙.length === 0, 안걸린규칙.slice(0, 6).join(' · '));

  /*
   * 반대쪽도 본다 — 아무 규칙에도 안 걸리는 문장은 이 목록에서 자리만
   * 차지한다. 규칙을 지웠는데 문장이 남아 있으면 여기서 뜬다.
   */
  const 헛문장 = 문장들.filter((s) =>
    !Object.values(표).some((규칙들) => 규칙들.some(([re]) => re.test(s))));
  check('★ 아무 규칙에도 안 걸리는 문장이 목록에 없다',
    헛문장.length === 0, 헛문장.slice(0, 4).join(' · '));

  // 목록이 규칙 수보다 적으면 한 문장이 여러 규칙을 떠맡고 있다는 뜻이다.
  check('  문장 수를 적어 둔다', true, `문장 ${문장들.length}개 · 규칙 ${규칙수}개`);
}

// ── 2. 글자열로 지은 정규식에서 이스케이프가 죽지 않았다 ────────────────
trace('2-이스케이프');
{
  /*
   * 정규식을 **글자열이나 템플릿으로** 지으면 백슬래시를 두 겹으로 적어야
   * 한다. 한 겹으로 적으면 정규식이 그 글자를 보기도 전에 자바스크립트가
   * 먼저 먹는다.
   *
   *   '\s'  → 글자 s        (모르는 이스케이프라 백슬래시만 뗀다)
   *   '\d'  → 글자 d
   *   '\b'  → 백스페이스(0x08)  ← 이건 더 나쁘다. 정규식 안에서 절대 안 맞고,
   *                              화면·grep·에디터가 전부 `\b` 로 보여 준다.
   *
   * 소스 바이트에는 제어문자가 없으므로 죽은규칙.test.js 의 1번(날 제어문자)
   * 이 못 잡는다. 그건 **적힌 것**을 보고, 이건 **닿는 것**을 본다.
   *
   * 정규식 리터럴(`/\s/`)은 건드리지 않는다 — 거기서는 한 겹이 맞다. 그래서
   * 줄 단위로 훑지 않고 글자열 안쪽만 골라 본다. 템플릿 안의 `${…}` 는 다시
   * 코드라서 그 안의 정규식 리터럴도 봐주지 않으면 안 된다.
   */
  /*
   * `\p{L}`(유니코드 속성)과 `\k<이름>`(이름 있는 되받기)도 같은 부류다 —
   * 정규식 리터럴에서는 뜻이 있고 글자열 안에서 한 겹이면 그냥 글자로 주저앉는다.
   * 이 저장소는 outline.js·lsp.js 에서 이미 `\p{L}` 로 한글 이름 경계를 잡고 있으니,
   * 그 무늬를 템플릿으로 짓는 날이 온다.
   */
  const 위험한글자 = new Set(['s', 'S', 'd', 'D', 'w', 'W', 'b', 'B', 'p', 'P', 'k']);

  /*
   * 일부러 그런 자리. 둘 다 **진짜 백스페이스 글자**가 필요한 곳이다.
   *
   *   src/ui/prompt.js    터미널에서 한 글자 지우기('\b \b')
   *   src/agent/salvage.js  JSON 의 \b 를 되돌리는 표
   *
   * 목록으로 둔다 — 주석 표시로 봐주면 그 표시가 온 저장소로 번진다.
   */
  const 봐줄자리 = new Set(['src/ui/prompt.js', 'src/agent/salvage.js']);

  const 훑기 = (글) => {
    const 걸린것 = [];
    const n = 글.length;
    let i = 0;
    let 줄 = 1;
    let 앞글자 = '';
    const 쌓임 = [];
    let 중괄호 = 0;

    // 글자열 하나를 먹는다. 템플릿이면 `${` 에서 멈추고 코드로 돌아간다.
    const 글자열먹기 = (끝, 시작) => {
      let j = 시작;
      while (j < n) {
        const d = 글[j];
        if (d === '\\') {
          const e = 글[j + 1];
          if (위험한글자.has(e)) 걸린것.push({ 줄, 무엇: `\\${e}` });
          if (e === '\n') 줄 += 1;
          j += 2; continue;
        }
        if (d === '\n') { 줄 += 1; j += 1; continue; }
        if (끝 === '`' && d === '$' && 글[j + 1] === '{') {
          쌓임.push(중괄호);
          중괄호 = 0;
          return { 다음: j + 2, 안으로: true };
        }
        if (d === 끝) return { 다음: j + 1, 안으로: false };
        j += 1;
      }
      return { 다음: n, 안으로: false };
    };

    while (i < n) {
      const c = 글[i];
      if (c === '\n') { 줄 += 1; i += 1; continue; }
      if (c === '/' && 글[i + 1] === '/') { while (i < n && 글[i] !== '\n') i += 1; continue; }
      if (c === '/' && 글[i + 1] === '*') {
        i += 2;
        while (i < n && !(글[i] === '*' && 글[i + 1] === '/')) { if (글[i] === '\n') 줄 += 1; i += 1; }
        i += 2; continue;
      }
      // 정규식 리터럴. 앞글자가 값이면 나눗셈이다.
      if (c === '/' && !/[\w)\]]/.test(앞글자)) {
        let j = i + 1; let 클래스 = false; let 닫힘 = false;
        while (j < n) {
          const d = 글[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '\n') break;
          if (d === '[') 클래스 = true;
          else if (d === ']') 클래스 = false;
          else if (d === '/' && !클래스) { 닫힘 = true; break; }
          j += 1;
        }
        if (닫힘) { i = j + 1; 앞글자 = '/'; continue; }
      }
      if (c === "'" || c === '"' || c === '`') {
        const r = 글자열먹기(c, i + 1);
        i = r.다음;
        앞글자 = r.안으로 ? '' : c;
        continue;
      }
      if (c === '{') { 중괄호 += 1; i += 1; 앞글자 = c; continue; }
      if (c === '}') {
        if (중괄호 === 0 && 쌓임.length) {
          중괄호 = 쌓임.pop();
          const r = 글자열먹기('`', i + 1);   // 템플릿 안으로 되돌아간다
          i = r.다음;
          앞글자 = '`';
          continue;
        }
        중괄호 -= 1; i += 1; 앞글자 = c; continue;
      }
      if (!/\s/.test(c)) 앞글자 = c;
      i += 1;
    }
    return 걸린것;
  };

  /*
   * 없는 뿌리는 건너뛴다. 이 검사는 저장소 **전체**를 훑는데, 한 벌 베껴 놓고
   * 도는 판(tools/mutate.mjs)에는 안 베낀 뿌리가 있을 수 있다. 실제로 `tools/`
   * 가 없어서 여기서 터졌고, 그러면 이 검사는 「어긋내기 전부터 빨갛다」 로
   * 빠진다 — 아무것도 못 재고 못 잰 줄도 모른다. (지금은 tools/ 도 베낀다.)
   */
  const 파일훑기 = (d, 모음 = []) => {
    let 것들;
    try { 것들 = readdirSync(d, { withFileTypes: true }); } catch { return 모음; }
    for (const e of 것들) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) 파일훑기(p, 모음);
      else if (/\.m?js$/.test(e.name)) 모음.push(p);
    }
    return 모음;
  };

  const 걸린것 = [];
  for (const 뿌리이름 of ['src', 'bin', 'tools', 'test']) {
    for (const p of 파일훑기(join(뿌리, 뿌리이름))) {
      const 이름 = relative(뿌리, p).replace(/\\/g, '/');
      if (봐줄자리.has(이름)) continue;
      for (const h of 훑기(readFileSync(p, 'utf8'))) 걸린것.push(`${이름}:${h.줄} ${h.무엇}`);
    }
  }
  check('★★★ 글자열 안의 정규식 이스케이프가 한 겹으로 적혀 있지 않다',
    걸린것.length === 0, 걸린것.slice(0, 6).join(' · '));

  // 검사기 자신이 도는지 본다. 아무것도 못 잡는 검사기는 언제나 초록이다.
  const 스스로 = 훑기("const x = '\\s';\nconst y = /\\s/;\nconst z = `a${/\\d/}b`;");
  check('★★ 검사기가 한 겹짜리를 실제로 잡는다', 스스로.length === 1, JSON.stringify(스스로));
  const 안잡아야 = 훑기('const y = /\\s+/g;\nconst z = `${String(a).replace(/\\s/g, "")}`;');
  check('★★ 정규식 리터럴은 안 잡는다 (템플릿 안의 것도)',
    안잡아야.length === 0, JSON.stringify(안잡아야));
}

// ── 3. 손대는 동사 목록이 통째로 살아 있다 ──────────────────────────────
trace('3-손대라');
{
  /*
   * 「손대라는 말」 무늬는 동사 목록을 템플릿으로 끼워 넣어 짓는다. 그 무늬가
   * 깨지면 **목록 전체가 한 번에 죽는다** — 동사 서른 개가 같이 죽는데,
   * 화면에는 「모드를 안 바꿨습니다」 한 줄만 뜬다.
   *
   * 그래서 동사를 목록에서 그대로 꺼내 어미 세 가지로 다 걸어 본다. 새 동사를
   * 넣으면 그 동사도 자동으로 이 검사에 들어온다.
   */
  const 동사들 = 손대는동사.split('|');
  const 어미들 = [
    ['줘', (v) => `${v}줘`],
    ['해라', (v) => `${v.endsWith('해') ? v : `${v}해`}라 지금`],
    // ★ 이 꼴이 백슬래시 하나 때문에 통째로 안 걸렸다. 「라」 뒤에 빈칸이 온다.
    ['라+빈칸', (v) => `${v.endsWith('해') ? v : `${v}어`}라 그리고 저장해`],
  ];
  const 죽은동사 = [];
  for (const v of 동사들) {
    for (const [이름, 짓기] of 어미들) {
      const 말 = 짓기(v);
      if (!손대라했나(말)) 죽은동사.push(`${v}(${이름}) "${말}"`);
    }
  }
  check(`★★★ 손대는 동사 ${동사들.length}개가 어미 ${어미들.length}가지로 다 걸린다`,
    죽은동사.length === 0, 죽은동사.slice(0, 6).join(' · '));

  // 빈칸·줄바꿈·탭이 뒤따라도 걸려야 한다. 여기가 정확히 깨졌던 자리다.
  for (const [이름, 말] of [
    ['빈칸', '바꿔라 지금 해줘'],
    ['줄바꿈', '바꿔라\n다음 문장도 있다'],
    ['탭', '바꿔라\t그리고'],
    ['글 끝', '그것 좀 바꿔라'],
    ['마침표', '바꿔라.'],
  ]) {
    check(`★★★ 「라」 뒤에 ${이름}이 와도 손대라는 말이다`, 손대라했나(말) === true, 말.slice(0, 20));
  }

  // 읽고 말하라는 말은 손대라는 말이 아니다. 넓히면 읽기 전용 모드가 영영 안 온다.
  for (const 말 of ['구조를 설명해라', '이게 뭐 하는 파일이야', '어떻게 동작하는지 알려 줘']) {
    check(`  「${말.slice(0, 12)}」 는 손대라는 말이 아니다`, 손대라했나(말) === false);
  }

  /*
   * 영어는 어미가 없다. 문장 첫머리의 명령형으로 가린다 — 그 규칙이 살아
   * 있는지 양쪽으로 본다.
   */
  for (const 말 of ['Build a work request app.', 'Fix the failing test.',
    '1. Create the schema\n2. Wire it up', '- update the README']) {
    check(`★★ 영어 명령형을 알아본다 — "${말.slice(0, 22)}"`, 손대라했나(말) === true);
  }
  for (const 말 of ['Explain how the build works.', 'The build system is broken.']) {
    check(`★★ 첫머리가 아닌 동사는 안 본다 — "${말.slice(0, 26)}"`, 손대라했나(말) === false);
  }
}

// ── 4. 읽기만 하는 모드 목록이 modes.js 와 같다 ─────────────────────────
trace('4-짝맞추기');
{
  /*
   * route.js 는 「손대라는 말이면 읽기 전용 모드를 후보에서 뺀다」 로 고르고,
   * 실제로 도구를 주고 안 주고는 modes.js 가 정한다. 두 목록이 갈라지면
   * 둘 중 하나가 조용히 틀린다 —
   *
   *   modes 에만 있으면  → 고칠 수 없는 모드로 보내 놓고 사람이 막힌다
   *   route 에만 있으면  → 뺄 필요 없는 모드를 빼서 늘 종합에 남는다
   *
   * 그래서 modes.js 에서 직접 캐낸다. 손으로 적은 목록 둘을 눈으로 맞추는
   * 일은 언젠가 어긋난다.
   */
  const modes에서못쓰는것 = ORDER.filter((m) => !canWrite(m)).sort();
  const route가아는것 = [...읽기만하는모드].sort();
  check('★★★ 읽기 전용 모드 목록이 modes.js 와 똑같다',
    modes에서못쓰는것.join(',') === route가아는것.join(','),
    `modes: ${modes에서못쓰는것.join('·')} / route: ${route가아는것.join('·')}`);

  // 점수표의 모드 이름이 실제로 있는 모드인가. 오타 하나면 그 갈래가 통째로 죽는다.
  const 없는모드 = Object.keys(표).filter((m) => !ORDER.includes(m));
  check('★★ 점수표의 모드 이름이 전부 실제 모드다', 없는모드.length === 0, 없는모드.join(' · '));

  /*
   * 끝에서 한 번 더 — 고쳐 달라는 말이 읽기 전용 모드로 가지 않는다.
   * 위 셋이 다 살아 있어도 이어 붙이는 자리에서 어긋날 수 있다.
   */
  for (const 말 of [
    '폴더 구조 개선해줘',
    '재현 검사를 먼저 만들어라 그리고 최소 범위로 고쳐라',
    '이 모듈 설계 다시 잡고 코드도 바꿔라 지금',
  ]) {
    const r = route(말);
    check(`★★★ 고치라는 말이 읽기 전용으로 안 간다 — "${말.slice(0, 20)}"`,
      !읽기만하는모드.has(r.mode), `${r.mode} — ${r.why}`);
  }
}

// ── 5. 긴 명세에서 **지나가는 낱말**이 모드를 정하지 않는다 ──────────────
//
// 1.16 에서 한 번 고쳤다. 5,254자짜리 「빈 폴더에 웹 앱을 만들어라」 가
// `fails` 한 낱말 때문에 디버그로 갔고, 그래서 긴 글에는 문턱을 2 올렸다.
//
// 그런데 올린 문턱은 **낱말 하나**만 막는다. 실제 벤치마크 지시문을 그대로
// 넣어 보니 두 개가 걸렸다 —
//
//     "… handle duplicate requests, stale requests, unexpected server errors."   +3
//     "… A failed operation must not leave state silently inconsistent."          +3
//
// 둘 다 증상이 아니라 **요구사항 조건절**이다. 고장 난 것이 하나도 없는
// 빈 폴더에서 시작하는 지시문인데, 합이 6이라 3+2 문턱을 넘어 디버그가 됐다.
// 디버그 모드는 「증상을 한 문장으로 다시 적어라 · 재현 방법부터 확보해라」
// 를 시킨다. 아직 아무것도 없는 자리에서 재현할 증상을 찾는다.
//
// 눈금을 또 올려도 세 낱말이면 그대로 뚫린다. 그래서 눈금이 아니라 **견줌**
// 으로 본다 — 같은 글에서 설계가 8점, 디버그가 6점이었다. 그 글이 말하는
// 바는 설계·구현이지 원인 찾기가 아니다. 「고치라는 말이라 설계로는 안
// 보낸다」 는 맞지만, 그렇다고 그 글이 디버그가 되지는 않는다. 종합에 둔다.
{
  // 실제 벤치마크 지시문에서 뜻이 같은 대목만 추린 것. 1,500자를 넘겨야 한다.
  const 채움 = 'The application must support creating, listing, and updating work '
    + 'requests with title, description, requester, assignee, priority, status, '
    + 'created, updated, due date, and tags. Every state change must be recorded '
    + 'in an audit trail. Approvers may approve or reject with a reason. Roles are '
    + 'enforced on the server, never trusted from the client. Provide search, '
    + 'filter, and sort. Provide an administrator dashboard with a summary '
    + 'visualization. Data must persist across restarts. Write automated tests and '
    + 'actually run them; do not weaken a test to make it pass. Handle loading, '
    + 'empty, and error states in the interface, and confirm destructive actions. ';
  const 벤치 = 'You are starting from a completely empty working directory. Your task '
    + 'is to independently design, implement, test, verify, and complete a '
    + 'production-oriented web application. Treat this as a completely new project. '
    + 'Determine the architecture, technology choices, data model, API structure, and '
    + 'state management yourself. Do not stop after producing a plan. '
    + 채움 + 채움
    + 'The server must safely handle duplicate requests, stale requests, and '
    + 'unexpected server errors. A failed operation must not leave state silently '
    + 'inconsistent.';

  check('★ 긴 벤치마크 지시문이 1,500자를 넘는다', 벤치.length >= 1500, `${벤치.length}자`);

  const r = route(벤치);
  /*
   * `!== 'debug'` 만 보면 느슨하다 — 2차 리뷰가 짚었다. 이 대목이 말하는
   * 것은 「디버그가 아니다」 가 아니라 **「종합에 그대로 둔다」** 이고,
   * 종합은 mode === null 이다. 아무 쓰기 모드로 가도 초록이면 이 검사는
   * 자기가 무엇을 지키는지 모르는 것이다.
   */
  check('★★★ 빈 폴더에 만들라는 긴 명세는 종합에 그대로 둔다',
    r.mode === null, `${r.mode} — ${r.why} · ${JSON.stringify(r.점수들)}`);
  check('★★★ 그 명세는 읽기 전용 모드로도 안 간다',
    !읽기만하는모드.has(r.mode), `${r.mode} — ${r.why}`);
  check('★★★ 그렇게 둔 것이 일부러라고 표가 선다',
    r.일부러 === true, `일부러=${r.일부러} — ${r.why}`);

  /*
   * 뒤집어 재 본다 — 진짜 긴 버그 보고서는 여전히 디버그로 가야 한다.
   * 위 규칙이 「긴 글은 무조건 종합」 이 되어 버리면 이 검사가 잡는다.
   */
  const 버그보고 = '결제 화면이 왜 안 되는지 봐줘. 어제부터 계속 터진다. '
    + '스택 트레이스를 같이 붙인다. TypeError: cannot read properties of undefined. '
    + '재현은 장바구니에 두 개 담고 쿠폰을 적용하면 100% 난다. '
    + '로그를 보면 결제 직전에 예외가 나고 그대로 죽는다. 원인을 좀 찾아줘. '.repeat(12);
  const b = route(버그보고);
  check('★★★ 긴 버그 보고서는 그대로 디버그로 간다',
    b.mode === 'debug', `${b.mode} — ${b.why} · ${JSON.stringify(b.점수들)}`);

  /*
   * 짧은 글은 손대지 않는다. 「지나가는 낱말」 규칙은 긴 명세에서만 돈다.
   * 짧은 말에서는 낱말 하나가 곧 뜻이다 — 이 파일 맨 위의 전제 그대로다.
   */
  const 짧은고장 = '로그인이 왜 안 되지 에러 나는데 좀 고쳐줘';
  check('★★ 짧은 고장 신고는 그대로 디버그다',
    route(짧은고장).mode === 'debug', `${route(짧은고장).mode}`);
}


// ── 6. 일부러 안 고른 것은 사람에게 말한다 ──────────────────────────────
//
// 이 파일 맨 위 route.js 가 스스로 약속한 것이 있다 —
//
//     2) 왜 그렇게 봤는지 남긴다. **화면에 그 이유가 같이 뜬다.**
//
// 그런데 못 골랐을 때(mode === null) repl.js 도 oneshot.js 도 `if (골라진.mode)`
// 안에서만 찍는다. route.js 는 그 자리에 쓸 말을 세 갈래나 지어 두고 —
//
//     "architect·plan·inspect 신호가 있었지만 고치라는 말이라 안 보냄"
//     "글이 길어 debug 신호 하나로는 안 정함"
//     "글이 길고 architect(8점) 가 debug(6점) 보다 세서 debug 로 안 봄"
//
// — 셋 다 화면에 한 글자도 안 떴다. 바로 윗줄 주석이 「"설계로 갈 뻔했는데
// 고치라는 말이라 안 보냈다" 와 "그냥 모르겠다" 는 사람에게 아주 다른
// 말이다」 라고 적어 둔 그 구분이, 화면에서는 통째로 없었다.
//
// 그렇다고 전부 찍으면 안 된다. 보통 한마디는 거의 다 mode === null 이고
// 까닭은 「무슨 일인지 뚜렷하지 않음」 이다. 그걸 매번 찍으면 소음이다.
// 그래서 **일부러 안 골랐나**를 route 가 직접 갈라 준다.
{
  const 일부러인것 = [
    ['고치라는 말이라 읽기 전용을 뺐다', '폴더 구조 개선해줘'],
  ];
  for (const [무엇, 말] of 일부러인것) {
    const r = route(말);
    check(`★★★ 일부러 안 고른 것에 표가 선다 — ${무엇}`,
      r.mode === null && r.일부러 === true, `mode=${r.mode} 일부러=${r.일부러} — ${r.why}`);
  }

  // 긴 명세 두 갈래도 일부러다.
  const 긴것 = 'You are starting from a completely empty working directory. '
    + 'Determine the architecture and design the data model yourself. '
    + 'Build and test a production web application. '.repeat(40)
    + 'Handle unexpected server errors. A failed operation must not corrupt state.';
  const g = route(긴것);
  check('★★★ 긴 명세에서 안 고른 것도 일부러다',
    g.mode === null && g.일부러 === true, `mode=${g.mode} 일부러=${g.일부러} — ${g.why}`);

  // 반대쪽 — 그냥 모르겠는 것은 일부러가 아니다. 화면에 안 뜬다.
  for (const 말 of ['ㅇㅇ', '고마워', '그거 어제 얘기한 거']) {
    const r = route(말);
    check(`★★★ 그냥 모르겠는 것은 표가 안 선다 — "${말}"`,
      r.mode === null && !r.일부러, `mode=${r.mode} 일부러=${r.일부러} — ${r.why}`);
  }

  /*
   * 까닭도 같이 잰다. 2차 리뷰가 짚었다 — 표만 재고 말은 안 재면, 화면에
   * 「무슨 일인지 뚜렷하지 않음」 같은 소음 문구가 들어가도 안 잡힌다.
   * 표가 서는 것과 **쓸 말이 지어지는 것**은 다른 일이다.
   */
  const 소음말 = '무슨 일인지 뚜렷하지 않음';
  const 까닭재기 = (이름, r, 있어야) => {
    check(`★★★ ${이름} — 까닭에 소음 문구가 안 들어간다`,
      String(r.why) !== 소음말, String(r.why));
    check(`★★★ ${이름} — 까닭이 왜 그랬는지 말한다`,
      있어야.test(String(r.why)), String(r.why));
  };

  까닭재기('고치라는 말이라 뺐다', route('폴더 구조 개선해줘'), /고치라는 말이라/);

  /*
   * 긴 명세는 **두 갈래**다. 주석에 둘이라고 적어 놓고 하나만 재고 있었다.
   *   ① 뺀 것이 더 세서 안 고름 (지나가는말)
   *   ② 신호가 하나뿐이라 안 고름 (긴글 + 문턱은 넘고 +2 는 못 넘음)
   */
  const 갈래1 = route(긴것);
  check('★★★ ① 뺀 것이 더 셀 때 — 일부러 표가 선다',
    갈래1.mode === null && 갈래1.일부러 === true, `${갈래1.mode} / ${갈래1.일부러}`);
  까닭재기('① 뺀 것이 더 셈', 갈래1, /보다 세서/);

  const 갈래2 = route('이 문서는 결재 서비스의 운영 안내서입니다. 배포 절차와 담당자를 적어 둡니다. '.repeat(60)
    + ' 점검해 주세요.');
  check('★★★ ② 신호가 하나뿐일 때 — 일부러 표가 선다',
    갈래2.mode === null && 갈래2.일부러 === true, `${갈래2.mode} / ${갈래2.일부러} — ${갈래2.why}`);
  까닭재기('② 신호가 하나뿐', 갈래2, /신호 하나로는 안 정함/);

  /*
   * 1·2등이 비긴 갈래도 일부러다. 이 갈래를 재는 검사가 아예 없어서,
   * `일부러: true` 를 false 로 되돌려도 아무 데서도 안 터졌다 — 2차 리뷰가 짚었다.
   */
  const 비김 = route('이 코드 점검해 주고 설명해 줘');
  check('★★★ 1·2등이 비기면 일부러 표가 선다',
    비김.mode === null && 비김.일부러 === true,
    `${비김.mode} / ${비김.일부러} — ${비김.why} · ${JSON.stringify(비김.점수들)}`);
  까닭재기('비김', 비김, /비슷함/);

  /*
   * 화면 쪽 배선. route 가 표를 세워도 부르는 쪽이 안 보면 약속은 그대로
   * 안 지켜진다 — 이 결함이 바로 그 모양이었다(까닭은 만들어 놓고 안 찍음).
   * 그래서 두 부르는 자리가 실제로 이 표를 본다는 것을 여기서 잰다.
   */
  for (const 파일 of ['src/repl.js', 'src/oneshot.js']) {
    const 글 = readFileSync(join(뿌리, 파일), 'utf8');
    check(`★★★ ${파일} 가 일부러 표를 본다`,
      /골라진\.일부러/.test(글), '못 골랐을 때 까닭을 안 찍고 있습니다');
  }
}


// ── 7. 영어 시킴말이 code 표에서 점수를 받는다 ───────────────
//
// 2차 리뷰가 「설계 낱말이 없는 명세는 그대로 디버그로 간다」 고 짚었고,
// 돌려 보니 맞았다. 그런데 그것은 증상이지 뿌리가 아니었다.
//
// 영어 시킴말 14개를 재 봤다. **열 개가 code 표에서 0점**이다 —
// Build · Create · Make · Develop · Scaffold · Refactor · Remove · Set up ·
// Migrate … 전부 손대라했나 가 참으로 아는 말인데도 그렇다.
// 한국어 쪽은 '만들어' · '고쳐' 가 4점, '구현해' 가 5점인데 영어는
// `implement|add|fix|write` 네 낱말이 2점씩이 전부다. code 문턴은 3이라
// 2점짜리 하나로는 **절대** 못 넘는다.
//
// 그래서 「웹 앱을 만들어라」 는 긴 명세가 code 2점이고, 지나가던
// `error`·`failed` 가 6점이라 디버그가 이긴다. 점수를 맞추면 1·2등이
// 붙어 원래 있던 「비기면 안 고른다」 규칙이 알아서 받아 낸다.
trace('7-영어시킴말');
{
  const 문턱넘어야 = [
    'Build a complete work request and approval management web application.',
    'Create the database schema.',
    'Make the dashboard responsive.',
    'Develop a production-oriented web application.',
    'Scaffold the project structure.',
    'Refactor the approval module.',
    'Remove the unused files.',
    'Set up the test runner.',
    'Migrate the schema.',
    'Implement the approval workflow.',
  ];
  for (const 글 of 문턱넘어야) {
    let 합 = 0;
    for (const [re, 점] of 표.code) if (re.test(글)) 합 += 점;
    check(`★★★ 영어 시킴말이 code 문턴(3)을 넘는다 — "${글.slice(0, 34)}"`,
      합 >= 3, `${합}점`);
  }

  /*
   * 반대쪽 — 넣어서는 안 되는 것. 문장 가운데 낱말은 시킴말이
   * 아니다. 이걸 넣으면 「the build is broken」 이 code 로 간다.
   */
  for (const 글 of [
    'Explain how the build system works.',
    'The build is broken and I want to understand why.',
    'What does the create handler do?',
    'This module writes to the audit table.',
  ]) {
    let 합 = 0;
    for (const [re, 점] of 표.code) if (re.test(글)) 합 += 점;
    check(`★★★ 문장 가운데 낱말은 code 가 아니다 — "${글.slice(0, 34)}"`,
      합 < 3, `${합}점`);
  }

  /*
   * 그래서 실제로 뭐가 달라지나 — 설계 낱말이 하나도 없는
   * 「빈 폴더에 만들어라」 긴 명세. 2차 리뷰가 짚은 바로 그 자리다.
   */
  const 채움 = 'The application must support creating, listing, and updating work '
    + 'requests with title, description, requester, assignee, priority, status, '
    + 'created, updated, due date, and tags. Every state change must be recorded '
    + 'in an audit trail. Approvers may approve or reject with a reason. Roles are '
    + 'enforced on the server, never trusted from the client. Provide search, '
    + 'filter, and sort. Data must persist across restarts. Automated tests must '
    + 'exist and must actually run; a test may never be weakened to pass. ';
  const 설계없는명세 = 'You are starting from a completely empty working directory. '
    + 'Build a production-oriented work request and approval web application. '
    + 채움 + 채움
    + 'The server must safely handle duplicate requests, stale requests, and '
    + 'unexpected server errors. A failed operation must not leave state silently '
    + 'inconsistent.';
  /*
   * 채움 글에서 시킴말을 걷어 냈다. 3차 리뷰가 짚었다 — 원래는 채움에 우연히
   * 든 `Write automated tests` 가 점수를 주고 있어서, 재려던 `Build` 를
   * 무늘에서 통째로 지워도 이 검사가 초록이었다. 딴 데서 온 점수에 얹혀
   * 가는 검사는 재는 것이 아니라 지나가는 것이다.
   */
  const 시킴말샘 = 설계없는명세.match(/(?:^|[.!?]\s+)(?:Build|Write|Create|Make|Add|Fix)\b/g) ?? [];
  check('★ 이 명세에서 점수를 주는 시킴말은 맨 앞 Build 하나뿐이다',
    시킴말샘.length === 1, JSON.stringify(시킴말샘));

  const r = route(설계없는명세);
  check('★★★ 설계 낱말이 없는 명세도 디버그로 안 간다',
    r.mode !== 'debug', `${r.mode} — ${r.why} · ${JSON.stringify(r.점수들)}`);
  check('★★ 그 명세는 읽기 전용으로도 안 간다',
    !읽기만하는모드.has(r.mode), `${r.mode}`);
}

// ── 8. 마침표 뒤에 **빈칸이 있어야** 다음 문장이다 ──────────────────────
//
// 3차 리뷰가 짚었고, 돌려 보니 제일 나쁜 자리였다.
//
//     "Explain user.delete in detail."   →  code 모드
//
// 첫머리 무늬가 `[.!?\n]\s*` 라 마침표 뒤 **빈칸 0개**도 문장 첫머리로 쳤다.
// 그래서 `user.delete` 의 `delete` 가 시킴말이 되고, 설명해 달라는 말이
// 파일을 고치는 모드로 간다. 묻기(ask) 점수는 4점이나 있었는데 「고치라는
// 말」 로 잡혀 후보에서 빠졌다 — 이 파일 맨 위가 걱정한 바로 그 모양이다.
//
// 이건 손대라했나 에 원래 있던 틈인데, 점수까지 주게 되면서 드러났다.
// 넓힌 것이 잘못이 아니라, 넓히니 원래 있던 틈이 보인 것이다.
//
// ── 그리고 「Build failed」 는 시킴말이 아니다 ───────────────────────────
//
// `Build failed with exit code 1.` 이 code 4점을 받아 디버그(3점)를 눌렀다.
// 붙여 넣는 빌드 오류 로그의 첫 줄이 정확히 이 모양이다. 영어에서 시킴말
// 뒤에는 목적어가 오지, 과거분사가 오지 않는다 — 그 자리가 갈림길이다.
trace('8-마침표뒤빈칸');
{
  const code점 = (글) => 표.code.reduce((a, [re, 점]) => a + (re.test(글) ? 점 : 0), 0);

  // ① 마침표 뒤에 빈칸이 없으면 문장 첫머리가 아니다.
  for (const 글 of [
    'Explain user.delete in detail.',
    'What does e.g. create handler do?',
    'The value of config.update is read once.',
    'It calls db.remove and then returns.',
  ]) {
    check(`★★★ 마침표에 붙은 낱말은 시킴말이 아니다 — "${글.slice(0, 36)}"`,
      code점(글) < 3 && 손대라했나(글) === false, `code=${code점(글)} 손대라=${손대라했나(글)}`);
  }

  // ② 시킴말 뒤에 실패말이 오면 그건 주어다.
  for (const 글 of [
    'Build failed with exit code 1.',
    'Update failed: connection reset.',
    'Create failed because the table already exists.',
  ]) {
    check(`★★★ 「동사 + 실패말」 은 시킴말이 아니다 — "${글.slice(0, 36)}"`,
      code점(글) < 3 && 손대라했나(글) === false, `code=${code점(글)} 손대라=${손대라했나(글)}`);
    check(`★★★ 그런 줄은 디버그로 간다 — "${글.slice(0, 30)}"`,
      route(글).mode === 'debug', `${route(글).mode} · ${JSON.stringify(route(글).점수들)}`);
  }

  // ③ 그래도 진짜 시킴말은 그대로 산다. 좁히다 이쪽을 죽이면 7번이 되돌아온다.
  for (const 글 of [
    'Build a production-oriented web application.',
    'Fix the bug. Create the schema too.',
    '  Build a production-oriented web application.',
    'Setup the project structure.',
  ]) {
    check(`★★★ 진짜 시킴말은 그대로 — "${글.slice(0, 40)}"`,
      code점(글) >= 3 && 손대라했나(글) === true, `code=${code점(글)} 손대라=${손대라했나(글)}`);
  }

  /*
   * ④ 무늬가 아는 동사가 **하나도 빠짐없이** 문턱을 넘는다.
   *    열 개만 재고 있었다 — 안 재는 동사는 없는 것과 같다(이 파일의 1번과 같은 뜻).
   */
  const 동사들 = ['build', 'implement', 'create', 'write', 'make', 'add', 'fix', 'refactor',
    'remove', 'delete', 'rename', 'migrate', 'update', 'modify', 'change', 'generate',
    'scaffold', 'set up', 'setup', 'develop'];
  const 못넘는것 = 동사들.filter((v) => {
    const 글 = `${v[0].toUpperCase()}${v.slice(1)} the approval module.`;
    return code점(글) < 3 || !손대라했나(글);
  });
  check('★★★ 무늬가 아는 동사가 전부 문턱을 넘는다', 못넘는것.length === 0, 못넘는것.join(' · '));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n자동 모드 하네스  ${D}(규칙이 있는 것과 걸리는 것은 다르다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

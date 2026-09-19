/**
 * Def · Refs — 언어 서버에게 "이게 어디 있나 / 어디서 쓰나" 를 묻는다.
 *
 * ── Grep 을 밀어내는 것이 아니다 ────────────────────────────────────────
 *
 * Grep 은 남는다. 언어 서버가 안 깔린 자리가 더 많고(사내망이 대개 그렇다),
 * 깔려 있어도 못 읽는 파일이 있고, 무엇보다 Grep 은 **주석·설정·문서까지**
 * 찾는다. 이름을 바꿀 때 정말 필요한 것은 그쪽까지다.
 *
 * 이 둘이 더해 주는 것은 딱 하나, **틀린 자리를 안 준다는 것**이다.
 * `run` 을 Grep 으로 찾으면 수백 줄이 나오고 그중 진짜는 몇 개다. 모델은 그
 * 수백 줄을 다 읽을 자리가 없어서 앞의 몇 개만 보고 고치기 시작한다. 놓친
 * 자리는 돌려 본 뒤에야 드러나고, 그때는 이미 다른 것도 같이 고쳐 놓은 뒤다.
 *
 * ── 왜 자리(줄·칸)가 아니라 이름을 받나 ─────────────────────────────────
 *
 * LSP 는 "이 파일 이 줄 이 칸에 있는 것" 을 묻는 규약이다. 그런데 모델은
 * 칸 번호를 모른다. 알려면 파일을 먼저 Read 해야 하는데, 그러면 이 도구를
 * 쓰는 값(파일을 안 읽고도 안다)이 통째로 사라진다.
 *
 * 그래서 이름을 받아 **workspace/symbol 로 자리를 먼저 찾고**, 그 자리로
 * 다시 묻는다. 사람이 하는 것과 같은 순서다. 이름이 여럿이면 그 목록을
 * 그대로 보여 주고 고르게 한다 — 하나를 골라 주고 아닌 척하지 않는다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { 얻기, 색인중일까 } from '../lsp/client.js';
import { 갈래, 프로젝트갈래 } from '../lsp/servers.js';
import { 찾을개수 } from '../agent/budget.js';
import { 말, 세말 } from '../i18n/index.js';

/**
 * 한 자리를 사람이 읽을 한 줄로. 그 줄의 글까지 붙여야 열어 보지 않고도 안다.
 *
 * ── 파일은 파일마다 **한 번** (사냥4 W3) ─────────────────────────────────
 *
 * 여기가 **자리 하나마다** 그 파일을 통째로 다시 읽었다. 4만 줄짜리 파일에 참조가
 * 5000곳이면 5000번을 읽는다. 게다가 `trim()` 으로 뗀 줄은 V8 에서 원래 글의 **조각**
 * 이라, 그 한 줄이 파일 전체를 붙들고 놓지 않았다 — 5000줄이 5000벌을 붙들어 힙이 넘쳤다.
 *
 * 그래서 한 번 부를 동안 같은 파일은 줄표 에서 꺼내 쓰고, 뗀 글은 **새 글로 옮겨 적는다**
 * (Buffer 를 거치면 조각이 아니라 제 몸을 가진 글이 된다). 부르는 쪽(Refs)은 창에 안 실을
 * 자리는 아예 여기로 안 보낸다.
 *
 * @param 줄표 한 번 부를 동안 같이 쓰는 표 (파일 → 줄들 | null). 안 주면 그 자리에서 읽는다.
 */
function 한줄(scope, uri, 범위, 줄표 = new Map()) {
  let abs;
  try { abs = fileURLToPath(uri); } catch { abs = String(uri); }
  const 줄번호 = (범위?.start?.line ?? 0) + 1;
  // 윈도우는 서버가 드라이브 글자를 소문자로 적어 온다(c%3A) — 같은 파일을 두 번 읽지 않게.
  const 열쇠 = process.platform === 'win32' ? abs.toLowerCase() : abs;
  if (!줄표.has(열쇠)) {
    try { 줄표.set(열쇠, readFileSync(abs, 'utf8').split(/\r?\n/)); } catch { 줄표.set(열쇠, null); /* 못 읽으면 자리만 준다 */ }
  }
  let 글 = (줄표.get(열쇠)?.[줄번호 - 1] ?? '').trim();
  if (글.length > 160) 글 = 글.slice(0, 160) + '…';
  글 = Buffer.from(글, 'utf8').toString('utf8');
  const 보일 = scope?.show ? (() => { try { return scope.show(abs); } catch { return abs; } })() : abs;
  return { 파일: 보일, 줄: 줄번호, 글, abs };
}

/** LSP 의 답은 하나일 수도, 목록일 수도, LocationLink 일 수도 있다. 다 같은 모양으로 편다. */
function 자리들펴기(값) {
  if (!값) return [];
  const 목록 = Array.isArray(값) ? 값 : [값];
  return 목록.map((it) => {
    if (!it) return null;
    if (it.targetUri) return { uri: it.targetUri, range: it.targetSelectionRange ?? it.targetRange };
    if (it.uri) return { uri: it.uri, range: it.range };
    if (it.location) return { uri: it.location.uri, range: it.location.range };
    return null;
  }).filter(Boolean);
}

/**
 * 이름이 그 줄 어디쯤에 있는지.
 *
 * 낱말 경계를 본다. `run` 을 찾을 때 `runner` 를 짚으면 서버는 runner 의
 * 정의를 준다 — 틀린 답인데 맞는 답처럼 생겨서 제일 나쁘다.
 */
function 칸찾기(줄글, 이름) {
  if (!줄글 || !이름) return -1;
  let i = 0;
  for (;;) {
    const p = 줄글.indexOf(이름, i);
    if (p < 0) return -1;
    const 앞 = 줄글[p - 1] ?? ' ';
    const 뒤 = 줄글[p + 이름.length] ?? ' ';
    const 낱말 = (ch) => /[\p{L}\p{N}_$]/u.test(ch);
    if (!낱말(앞) && !낱말(뒤)) return p;
    i = p + 1;
  }
}

/**
 * 이름으로 자리를 찾는다.
 *
 * @returns {{자리: {uri, position}, 후보: object[]}|{오류: string}}
 */
async function 자리잡기(서버, scope, { 이름, 파일, 줄 }) {
  // 1) 파일과 줄을 준 경우. 그게 제일 정확하다 — 모델이 방금 Read 했거나
  //    Grep 으로 좁혀 온 자리다.
  if (파일) {
    let abs;
    try { abs = scope.resolve(파일); } catch (e) { return { 오류: e.message }; }
    let 줄들;
    try { 줄들 = readFileSync(abs, 'utf8').split(/\r?\n/); } catch { return { 오류: `못 읽었습니다: ${파일}` }; }
    서버.보여주기(abs, 줄들.join('\n'));

    const 볼줄 = Number.isFinite(줄) && 줄 > 0 ? [줄 - 1] : 줄들.map((_, i) => i);
    for (const i of 볼줄) {
      const 칸 = 칸찾기(줄들[i] ?? '', 이름);
      if (칸 >= 0) return { 자리: { uri: pathToFileURL(abs).href, position: { line: i, character: 칸 } } };
    }
    return { 오류: `${파일}${Number.isFinite(줄) ? `:${줄}` : ''} 에서 ${이름} 을 못 찾았습니다` };
  }

  /*
   * 2) 이름만 준 경우. 프로젝트 전체에서 그 이름을 찾는다.
   *
   * 방금 켠 서버는 빈손으로 답한다. 없어서가 아니라 아직 프로젝트를 다 못
   * 훑어서다 — 악수는 몇십 ms 면 끝나지만 색인은 몇 초씩 걸린다. 실제로 켠 지
   * 0.2초 만에 물었더니 없다고 했고, 0.5초 뒤에 물으니 나왔다.
   *
   * 이 둘을 구별 안 하면 "그런 이름 없습니다" 가 되고, 모델은 그 말을 믿고
   * 이미 있는 것을 새로 만든다. 그래서 **켠 지 얼마 안 됐을 때만** 몇 번 더
   * 물어본다. 오래 돈 서버에서 빈손이면 그건 정말 없는 것이라 안 기다린다.
   */
  let 답 = await 서버.물어보기('workspace/symbol', { query: 이름 });
  for (const 쉼 of [400, 800, 1500]) {
    if (답.오류 || (Array.isArray(답.값) && 답.값.length)) break;
    if (!색인중일까(서버)) break;
    // 이 시계는 unref 하지 않는다. 여기는 도구가 도는 한가운데라,
    // 놔 버리면 기다리는 사이에 프로그램이 그냥 끝나 버린다.
    await new Promise((r) => setTimeout(r, 쉼));
    답 = await 서버.물어보기('workspace/symbol', { query: 이름 });
  }
  if (답.오류) return { 오류: 답.오류 };
  const 것들 = (Array.isArray(답.값) ? 답.값 : []).filter((s) => s?.name);
  /*
   * 이름이 똑같은 것만. 서버는 대개 부분 일치까지 준다.
   *
   * 똑같은 것이 없을 때 **아무 부분 일치나** 받았다 — `셈` 을 물으면 `셈하기` 를 짚고 답은
   * 「셈 — 정의 1곳」 이었다 (2.0.0 6회차 LS1). 남의 정의를 내 것처럼 준 것이다. 되받는 것은
   * 이름이 **낱말로 들어 있는** 것뿐이다 — 서버에 따라 `Cls.foo` · `foo(int)` 처럼 이름을 꾸며
   * 주기 때문이다. 되받았으면 무엇을 짚었는지 같이 돌려준다 (닮은이름).
   */
  const 딱맞는 = 것들.filter((s) => s.name === 이름);
  const 쓸것 = 딱맞는.length ? 딱맞는 : 것들.filter((s) => 칸찾기(String(s.name), 이름) >= 0);
  if (!쓸것.length) {
    return {
      오류: `${이름} 을(를) 못 찾았습니다`
        + (색인중일까(서버) ? ' (언어 서버가 아직 프로젝트를 훑는 중일 수 있습니다)' : '')
        + '. Grep 으로 한 번 더 보세요.',
    };
  }

  const 후보 = 쓸것.map((s) => {
    const loc = s.location ?? {};
    return { 이름: s.name, 갈래: s.kind, uri: loc.uri, range: loc.range ?? null, 컨테이너: s.containerName ?? '' };
  }).filter((x) => x.uri);
  if (!후보.length) return { 오류: `${이름} 의 자리를 못 받았습니다` };

  const 첫 = 후보[0];
  // WorkspaceSymbol 은 range 없이 오기도 한다. 그럼 파일을 열어 직접 짚는다.
  let position = 첫.range?.start;
  if (!position) {
    try {
      const abs = fileURLToPath(첫.uri);
      const 줄들 = readFileSync(abs, 'utf8').split(/\r?\n/);
      for (let i = 0; i < 줄들.length; i++) {
        const 칸 = 칸찾기(줄들[i], 이름);
        if (칸 >= 0) { position = { line: i, character: 칸 }; break; }
      }
    } catch { /* 아래에서 걸린다 */ }
  }
  if (!position) return { 오류: `${이름} 의 자리를 못 짚었습니다` };

  // 정확히 이름 글자 위를 짚어야 한다. 정의 줄 맨 앞(`export function`)을 짚으면
  // 서버가 아무것도 못 준다.
  try {
    const abs = fileURLToPath(첫.uri);
    const 줄글 = readFileSync(abs, 'utf8').split(/\r?\n/)[position.line] ?? '';
    const 칸 = 칸찾기(줄글, 이름);
    if (칸 >= 0) position = { line: position.line, character: 칸 };
    서버.보여주기(abs);
  } catch { /* 그대로 간다 */ }

  return { 자리: { uri: 첫.uri, position }, 후보, 닮은이름: 딱맞는.length ? null : 첫.이름 };
}

/**
 * 모델이 준 줄 번호. **따옴표가 붙어 와도 숫자로 본다.**
 *
 * 스키마에 number 라고 적어 두어도 `"line": "42"` 로 보내는 모델이 있다.
 * `Number.isFinite('42')` 는 false 라 그 줄이 통째로 버려졌고, 자리잡기 는
 * 줄을 안 준 것으로 보고 **파일 처음부터** 이름을 찾았다 — 문자열 42 는 4번
 * 줄을, 숫자 42 는 41번 줄을 짚었다. 엉뚱한 줄을 짚어 놓고 찾았다고 답하므로
 * 잘못됐다는 신호가 어디에도 안 남는다.
 *
 * 빈 값·빈 글자는 「안 준 것」 이다. Number('') 가 0 이라 그냥 넘기면 0번 줄을
 * 짚으려 든다.
 */
function 줄값(값) {
  if (값 === null || 값 === undefined) return null;
  const n = typeof 값 === 'string' ? (값.trim() === '' ? NaN : Number(값)) : 값;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** 두 도구가 같은 앞머리를 쓴다 — 서버 얻고 자리 잡는 데까지. */
async function 채비(args, ctx) {
  const 이름 = String(args.name ?? '').trim();
  if (!이름) return { 오류: 'name 이 비었습니다' };

  const 파일 = args.file_path ? String(args.file_path) : null;
  /*
   * 어느 언어 서버에게 물을지.
   *
   * 파일을 줬으면 그 파일의 언어다. 안 줬으면 이 폴더에서 제일 많은 언어로
   * 간다 — 모델은 `handleClick 어디 있어` 처럼 이름만 알고 부르는 것이 보통이라,
   * 매번 파일을 요구하면 이 도구를 쓰는 값이 사라진다.
   */
  const 볼것 = 파일 ?? (await 프로젝트갈래(ctx.scope.root))?.대표파일 ?? null;
  if (!볼것) return { 오류: '이 폴더에서 쓸 수 있는 언어 서버가 없습니다. Grep · Outline 을 쓰세요.' };
  if (!갈래(볼것)) return { 오류: `언어 서버가 없는 갈래입니다: ${볼것}` };

  const 서버 = await 얻기(ctx.scope.root, 볼것);
  if (!서버) return { 오류: '언어 서버가 이 자리에 없습니다. Grep · Outline 을 쓰세요.' };

  const 잡음 = await 자리잡기(서버, ctx.scope, {
    이름, 파일, 줄: 줄값(args.line),
  });
  if (잡음.오류) return { 오류: 잡음.오류 };
  return { 이름, 서버, 자리: 잡음.자리, 후보: 잡음.후보 ?? [], 닮은이름: 잡음.닮은이름 ?? null };
}

/**
 * 여러 곳에 같은 이름이 있으면 그대로 알려 준다. 하나를 골라 주고 아닌 척하지 않는다.
 *
 * 가르는 열쇠는 **파일과 컨테이너**다. 파일만 봤더니 한 파일 안의 서로 다른 둘(`server.go` 의
 * `Server.Run` · `Worker.Run`)을 하나로 쳐서 말이 없었다 (2.0.0 6회차 LS2). 보기가 두 **파일**
 * (`A.go` · `B.go`)로 적혀 있었는데, 그건 파일만 봐도 갈리는 판이라 설명하는 고장과 어긋났다.
 * 그렇다고 줄마다 세면, 겹쳐쓰기(overload)처럼 같은
 * 것이 여러 줄로 오는 흔한 자리에서 거짓 경고가 난다 — 컨테이너까지 같으면 같은 것으로 친다.
 */
function 여럿이면(후보, scope) {
  if (!Array.isArray(후보) || 후보.length < 2) return null;
  const 곳들 = new Map();   // [파일, 컨테이너] → 보일 이름
  const 파일들 = new Set();
  for (const c of 후보) {
    let 파일;
    try { 파일 = scope.show(fileURLToPath(c.uri)); } catch { 파일 = c.uri; }
    파일들.add(파일);
    const 컨테이너 = String(c.컨테이너 ?? '');
    곳들.set(JSON.stringify([파일, 컨테이너]), 컨테이너 ? `${파일} (${컨테이너})` : 파일);
  }
  if (곳들.size < 2) return null;
  const 보일것 = [...곳들.values()];
  // 한 파일 안에서 갈리면 file_path 로는 못 좁힌다 — 줄까지 짚어야 한다.
  const 짚는법 = 파일들.size < 2 ? 'file_path 와 line 으로' : 'file_path 로';
  return `같은 이름이 ${보일것.length}곳에 있습니다: ${보일것.slice(0, 5).join(' · ')}`
    + `${보일것.length > 5 ? ' …' : ''}. 다른 것을 뜻했다면 ${짚는법} 짚어 주세요.`;
}

/** 이름이 똑같은 것이 없어 낱말로 든 다른 이름(`Cls.foo` 같은)을 짚었으면 그 이름을 말한다 (자리잡기 의 닮은이름, LS1). */
function 닮은말(이름, 닮은이름) {
  if (!닮은이름 || 닮은이름 === 이름) return null;
  return `「${이름}」 — 이름이 똑같은 것은 없어 「${닮은이름}」 자리를 짚었습니다. 다른 것을 뜻했다면 Grep 으로 보세요.`;
}

export const DEF_TOOL = {
  schema: {
    name: 'Def',
    description:
      '이름 하나가 **어디에 정의돼 있는지** 언어 서버에게 묻는다. 파일을 안 읽고도 자리를 안다.'
      + ' Grep 과 다른 점은 틀린 자리를 안 준다는 것이다 — 주석에 든 같은 이름, 남의 라이브러리의'
      + ' 같은 이름, 문자열 안의 같은 이름을 안 섞어 준다.'
      + ' 남이 쓴 코드를 고치기 전에 이걸 먼저 불러라. 자리를 안 다음에 그 파일만 Read 하면 된다.'
      + ' 이름이 여러 곳에 있으면 그 목록을 준다. file_path 로 어느 것인지 짚어 주면 된다.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '찾을 이름 (함수·클래스·변수)' },
        file_path: { type: 'string', description: '그 이름이 쓰인 파일. 같은 이름이 여럿일 때 짚어 준다' },
        line: { type: 'number', description: 'file_path 안에서 그 이름이 쓰인 줄 번호 (1부터)' },
      },
      required: ['name'],
    },
  },

  async run(args, ctx) {
    const 준비 = await 채비(args, ctx);
    if (준비.오류) return { error: 준비.오류 };
    const { 이름, 서버, 자리, 후보 } = 준비;

    const 답 = await 서버.물어보기('textDocument/definition', {
      textDocument: { uri: 자리.uri },
      position: 자리.position,
    });
    if (답.오류) return { error: `언어 서버: ${답.오류}` };

    const 줄표 = new Map();   // 같은 파일은 한 번만 읽는다 (한줄 머리말)
    let 곳들 = 자리들펴기(답.값).map((x) => 한줄(ctx.scope, x.uri, x.range, 줄표));
    // 서버가 정의를 못 주면(선언만 있는 자리 등) 심볼 검색으로 잡은 자리를 준다.
    // 빈손으로 돌려보내는 것보다 낫고, 어디서 온 값인지 같이 말해 준다.
    let 어디서 = 'definition';
    if (!곳들.length && 후보.length) {
      곳들 = 후보.map((c) => 한줄(ctx.scope, c.uri, c.range, 줄표));
      어디서 = 'workspace/symbol';
    }
    if (!곳들.length) return { summary: `${이름}: ${말('lsp.noDef')}`, found: 0 };

    /*
     * ── 「골라 준 것이 아니다」 는 말은 **모델에게** 가야 한다 ────────────
     *
     * 이 말을 summary 에만 붙여 놨었다. 그런데 모델이 받는 글은 content 다 —
     * loop.js 의 실을글() 은 content 가 비지 않으면 그것만 싣고, 비었을 때만
     * summary 로 내려간다. 즉 **줄 자리가 있을 때는 이 말이 절대 안 갔다.**
     *
     * 사람 화면에는 「같은 이름이 2곳에 있습니다」 가 멀쩡히 찍히니 아무도
     * 눈치를 못 챈다. 정작 모델은 자리 하나만 받고 그게 유일한 정의인 줄
     * 알고, 남의 파일에 있는 같은 이름을 고쳐 놓고 답을 맺는다. 이 도구가
     * 하나를 골라 주고 아닌 척하지 않겠다고 한 약속이 그 자리에서 깨진다.
     *
     * 두 곳에 다 적는다. 사람이 본 말과 모델이 받은 말이 같아야 한다.
     */
    const 여럿 = 여럿이면(후보, ctx.scope);
    /*
     * 이름이 똑같은 것이 없어 꾸민 이름을 짚었거나(LS1), 정의를 못 받아 심볼 검색 자리를
     * 줬으면(LS3) 그렇다고 **모델이 받는 글에도** 적는다 — 바로 위와 같은 까닭이다.
     * 출처를 `source` 칸에만 두었더니 사람에게도 모델에게도 안 갔다 (2.0.0 6회차).
     */
    const 덧말 = [
      닮은말(이름, 준비.닮은이름),
      어디서 === 'workspace/symbol'
        ? '언어 서버가 정의를 못 줘서 심볼 검색으로 찾은 자리입니다 — 정의가 아니라 선언일 수 있습니다.' : null,
      여럿,
    ].filter(Boolean);
    const 글 = 곳들.map((l) => `${l.파일}:${l.줄}  ${l.글}`).join('\n');
    return {
      summary: `${이름} — ${말('lsp.defs', { n: 세말('places', 곳들.length) })}${덧말.length ? `\n${덧말.join('\n')}` : ''}`,
      found: 곳들.length,
      source: 어디서,
      locations: 곳들,
      content: 덧말.length ? `${글}\n\n${덧말.join('\n')}` : 글,
    };
  },
};

export const REFS_TOOL = {
  schema: {
    name: 'Refs',
    description:
      '이름 하나를 **어디서 쓰는지** 언어 서버에게 다 묻는다. 이름을 바꾸거나 함수를 고치기 전에'
      + ' 불러라 — 몇 군데를 같이 고쳐야 하는지가 여기서 나온다.'
      + ' Grep 이 주는 수백 줄과 달리 진짜 그것을 쓰는 자리만 나온다. 대신 Grep 은 주석·설정·문서까지'
      + ' 찾으니, 이름을 통째로 바꿀 때는 이걸로 코드를 잡고 Grep 으로 나머지를 훑어라.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '찾을 이름 (함수·클래스·변수)' },
        file_path: { type: 'string', description: '그 이름이 정의된 파일. 같은 이름이 여럿일 때 짚어 준다' },
        line: { type: 'number', description: 'file_path 안에서 그 이름이 있는 줄 번호 (1부터)' },
        include_declaration: { type: 'boolean', description: '정의한 자리도 넣을지. 기본 false' },
      },
      required: ['name'],
    },
  },

  async run(args, ctx) {
    const 준비 = await 채비(args, ctx);
    if (준비.오류) return { error: 준비.오류 };
    const { 이름, 서버, 자리, 후보 } = 준비;

    const 답 = await 서버.물어보기('textDocument/references', {
      textDocument: { uri: 자리.uri },
      position: 자리.position,
      context: { includeDeclaration: args.include_declaration === true },
    });
    if (답.오류) return { error: `언어 서버: ${답.오류}` };

    // 여기서는 자리만 편다. 줄 글은 창에 실을 것만 아래에서 읽는다 (한줄 머리말, 사냥4 W3).
    const 곳들 = 자리들펴기(답.값);
    const 여럿 = 여럿이면(후보, ctx.scope);
    const 닮은 = 닮은말(이름, 준비.닮은이름);
    if (!곳들.length) {
      /*
       * 「안 쓴다」 는 **짚은 하나**에 대한 답이다. 같은 이름이 다른 곳에도 있으면 그 말을 같이
       * 해야 한다 — 빼면 모델은 지워도 되는 줄 알고 멀쩡히 쓰이는 쪽을 지운다 (2.0.0 6회차 LS5).
       */
      return {
        summary: [
          `${이름}: ${말('lsp.noRefs')}`
            + ' 정말 안 쓰는 것일 수도 있고, 언어 서버가 아직 색인 중일 수도 있습니다 —'
            + ' 지우기 전에 Grep 으로 한 번 더 보세요.',
          닮은, 여럿,
        ].filter(Boolean).join('\n'),
        found: 0,
      };
    }

    // 창에 맞춰 자른다. 자른 것은 자랐다고 말한다 — 조용히 자르면 모델은
    // 그게 전부인 줄 알고 나머지 자리를 안 고친다.
    const 한도 = 찾을개수(ctx.모델컨텍스트 ?? null);
    // 자르고 **나서** 읽는다. 창에 안 실을 70곳의 파일까지 열 까닭이 없다.
    const 줄표 = new Map();
    const 보일것 = 곳들.slice(0, 한도).map((x) => 한줄(ctx.scope, x.uri, x.range, 줄표));
    const 남은 = 곳들.length - 보일것.length;

    // 파일별로 묶어야 읽힌다. 같은 파일 열 줄이 흩어져 있으면 몇 파일을
    // 고쳐야 하는지가 안 보인다.
    const 묶음 = new Map();
    for (const l of 보일것) {
      if (!묶음.has(l.파일)) 묶음.set(l.파일, []);
      묶음.get(l.파일).push(l);
    }
    const 글 = [...묶음.entries()]
      .map(([f, 줄들]) => `${f} (${줄들.length})\n` + 줄들.map((l) => `  ${l.줄}: ${l.글}`).join('\n'))
      .join('\n');

    /*
     * ── 「70곳은 안 실었습니다」 가 모델에게는 안 갔다 ────────────────────
     *
     * 바로 위에서 "자른 것은 자랐다고 말한다" 고 해 놓고, 그 말을 summary
     * 에만 붙였다. 모델이 받는 글은 content 이고(loop.js 의 실을글), content
     * 가 비지 않으면 summary 는 아예 안 실린다. 그러니 **자를 것이 있을 때는
     * 반드시** 이 말이 빠졌다 — 잘랐다는 것을 알려야 할 바로 그때만.
     *
     * 8k 모델이면 한도가 50이다(budget.js 의 찾을개수는 작은 모델에서 50에서
     * 바닥을 친다). 참조 120곳 중 50곳을 받은 모델은 그 50곳을 고치고
     * 「모든 참조를 고쳤습니다」 로 답을 맺는다. 남은 70곳은 돌려 본 뒤에야
     * 드러나고, 그때는 이미 다른 것도 같이 고쳐 놓은 뒤다.
     *
     * 사람 화면(summary)에는 그대로 두고, 글 끝에도 같이 적는다. 같은 말을
     * 두 번 적는 것이 아니라, 여태 **한쪽에만** 적혀 있던 것을 마저 적는 것이다.
     */
    const 잘림말 = 남은 ? `(${남은}곳은 자리가 모자라 안 실었습니다)` : '';
    /*
     * 파일 수는 **자르기 전 전체**로 센다. 보인 50곳(묶음)으로 셌더니 두 파일에 걸친 120곳이
     * 「120곳 · 1개 파일」 이 됐다 (2.0.0 6회차 LS4) — 몇 파일을 고쳐야 하는지 먼저 말하는
     * 줄이 틀린 수를 준다. 줄 글은 안 읽고 주소만 본다.
     */
    const 파일수 = new Set(곳들.map((x) => {
      try { return ctx.scope.show(fileURLToPath(x.uri)); } catch { return x.uri; }
    })).size;
    const 덧말 = [잘림말, 닮은, 여럿].filter(Boolean);
    return {
      summary: `${이름} — ${말('lsp.refs', { 자리: 세말('places', 곳들.length), 파일: 세말('files', 파일수) })}`
        + (잘림말 ? ` ${잘림말}` : '')
        + (닮은 ? `\n${닮은}` : '')
        + (여럿 ? `\n${여럿}` : ''),
      found: 곳들.length,
      files: 파일수,
      truncated: 남은 > 0,
      locations: 보일것,
      content: 덧말.length ? `${글}\n\n${덧말.join('\n')}` : 글,
    };
  },
};

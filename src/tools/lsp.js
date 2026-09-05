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

/** 한 자리를 사람이 읽을 한 줄로. 그 줄의 글까지 붙여야 열어 보지 않고도 안다. */
function 한줄(scope, uri, 범위) {
  let abs;
  try { abs = fileURLToPath(uri); } catch { abs = String(uri); }
  const 줄번호 = (범위?.start?.line ?? 0) + 1;
  let 글 = '';
  try {
    const 줄들 = readFileSync(abs, 'utf8').split(/\r?\n/);
    글 = (줄들[줄번호 - 1] ?? '').trim();
  } catch { /* 못 읽으면 자리만 준다 */ }
  const 보일 = scope?.show ? (() => { try { return scope.show(abs); } catch { return abs; } })() : abs;
  return { 파일: 보일, 줄: 줄번호, 글: 글.length > 160 ? 글.slice(0, 160) + '…' : 글, abs };
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
  // 이름이 똑같은 것만. 서버는 대개 부분 일치까지 준다.
  const 딱맞는 = 것들.filter((s) => s.name === 이름);
  const 쓸것 = 딱맞는.length ? 딱맞는 : 것들;
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

  return { 자리: { uri: 첫.uri, position }, 후보 };
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
    이름, 파일, 줄: Number.isFinite(args.line) ? Number(args.line) : null,
  });
  if (잡음.오류) return { 오류: 잡음.오류 };
  return { 이름, 서버, 자리: 잡음.자리, 후보: 잡음.후보 ?? [] };
}

/** 여러 곳에 같은 이름이 있으면 그대로 알려 준다. 하나를 골라 주고 아닌 척하지 않는다. */
function 여럿이면(후보, scope) {
  if (!Array.isArray(후보) || 후보.length < 2) return null;
  const 파일들 = new Set(후보.map((c) => { try { return scope.show(fileURLToPath(c.uri)); } catch { return c.uri; } }));
  if (파일들.size < 2) return null;
  return `같은 이름이 ${파일들.size}곳에 있습니다: ${[...파일들].slice(0, 5).join(' · ')}`
    + `${파일들.size > 5 ? ' …' : ''}. 다른 것을 뜻했다면 file_path 로 짚어 주세요.`;
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

    let 곳들 = 자리들펴기(답.값).map((x) => 한줄(ctx.scope, x.uri, x.range));
    // 서버가 정의를 못 주면(선언만 있는 자리 등) 심볼 검색으로 잡은 자리를 준다.
    // 빈손으로 돌려보내는 것보다 낫고, 어디서 온 값인지 같이 말해 준다.
    let 어디서 = 'definition';
    if (!곳들.length && 후보.length) {
      곳들 = 후보.map((c) => 한줄(ctx.scope, c.uri, c.range));
      어디서 = 'workspace/symbol';
    }
    if (!곳들.length) return { summary: `${이름}: ${말('lsp.noDef')}`, found: 0 };

    const 여럿 = 여럿이면(후보, ctx.scope);
    return {
      summary: `${이름} — ${말('lsp.defs', { n: 세말('places', 곳들.length) })}${여럿 ? `\n${여럿}` : ''}`,
      found: 곳들.length,
      source: 어디서,
      locations: 곳들,
      content: 곳들.map((l) => `${l.파일}:${l.줄}  ${l.글}`).join('\n'),
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

    const 곳들 = 자리들펴기(답.값).map((x) => 한줄(ctx.scope, x.uri, x.range));
    if (!곳들.length) {
      return {
        summary: `${이름}: ${말('lsp.noRefs')}`
          + ' 정말 안 쓰는 것일 수도 있고, 언어 서버가 아직 색인 중일 수도 있습니다 —'
          + ' 지우기 전에 Grep 으로 한 번 더 보세요.',
        found: 0,
      };
    }

    // 창에 맞춰 자른다. 자른 것은 자랐다고 말한다 — 조용히 자르면 모델은
    // 그게 전부인 줄 알고 나머지 자리를 안 고친다.
    const 한도 = 찾을개수(ctx.모델컨텍스트 ?? null);
    const 보일것 = 곳들.slice(0, 한도);
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

    const 여럿 = 여럿이면(후보, ctx.scope);
    return {
      summary: `${이름} — ${말('lsp.refs', { 자리: 세말('places', 곳들.length), 파일: 세말('files', 묶음.size) })}`
        + (남은 ? ` (${남은}곳은 자리가 모자라 안 실었습니다)` : '')
        + (여럿 ? `\n${여럿}` : ''),
      found: 곳들.length,
      files: 묶음.size,
      truncated: 남은 > 0,
      locations: 보일것,
      content: 글,
    };
  },
};

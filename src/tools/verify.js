/**
 * Verify — 만든 것이 **실제로 되는지** 본다.
 *
 * ── 왜 이게 필요한가 ───────────────────────────────────────────────────
 *
 * 턴 끝에 이렇게 뜬다.
 *   ✓ index.html · 410줄 · 18.2KB
 *
 * 이건 파일이 **있다**는 증명이지 **된다**는 증명이 아니다. `<div>` 를 안 닫아
 * 놨어도, `src="app.js"` 가 없는 파일을 가리켜도, JS 에 괄호가 하나 모자라도
 * 똑같이 초록으로 뜬다. 사람은 그 초록을 믿고 다음 일로 넘어간다.
 *
 * 프롬프트에 "다 했으면 확인한다" 는 이미 넣어 뒀다. 그런데 확인할 **길**을
 * 안 줬다. 그러면 그건 부탁이지 규칙이 아니다.
 *
 * ── 무엇을 확인하나 ────────────────────────────────────────────────────
 *
 * 돌려 볼 수 있는 것은 돌려 본다 (node --check · py_compile).
 * 못 돌리는 것은 **읽어서** 본다 (HTML 태그 짝, 빠진 참조, CSS 중괄호 짝).
 *
 * 임의의 명령은 **여기서 안 돌린다.** 검사 스크립트는 무슨 짓이든 할 수 있어서,
 * 그걸 돌리는 길은 Bash 하나여야 한다 — 승인 관문과 안전 검사가 거기에만 있다.
 * 이 도구가 몰래 돌리면 strict 모드의 약속이 이 자리에서만 깨진다.
 * 여기서는 "이 프로젝트엔 npm test 가 있다" 고 알려 주기만 한다.
 *
 * 그리고 제일 중요한 것 — **못 확인한 것은 못 확인했다고 말한다.**
 * 조용히 넘기면 사람이 받는 신호는 '확인함' 과 구별되지 않는다. 그럴 바에는
 * 이 도구가 없는 편이 낫다. 확인 못 한 것을 확인했다고 하는 것이 제일 나쁘다.
 */
import { existsSync, statSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { extname, dirname, join, resolve } from 'node:path';
import { walk, SKIP_DIRS, 내부살림 } from './fsutil.js';
import { 건너뜀말 } from './ignore.js';
import { decode, looksBinary } from './encoding.js';
import { checkCommand } from '../safety/guard.js';

/** 짝이 맞아야 하는 HTML 태그. 안 닫아도 되는 것(void)은 뺀다. */
const 안닫아도되는것 = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr', '!doctype', '!--',
]);

/**
 * HTML 을 읽어 본다.
 *
 * 파서를 쓰지 않는다(의존성 0개). 대신 **틀렸다고 확신할 수 있는 것만** 잡는다 —
 * 애매한 것은 넘긴다. 잘못된 경고를 내면 모델이 멀쩡한 파일을 고치기 시작하고,
 * 그게 확인 안 하는 것보다 나쁘다.
 */
export function html보기(글, { 있는파일 = () => true } = {}) {
  const 탈 = [];
  const 쌓임 = [];

  // 주석과 script/style 안엣것은 빼고 본다 — 그 안의 `<` 는 태그가 아니다.
  const 뼈 = String(글)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '<$1></$1>');

  for (const m of 뼈.matchAll(/<(\/?)([a-zA-Z!][a-zA-Z0-9-]*)([^>]*)>/g)) {
    const 닫는가 = m[1] === '/';
    const 이름 = m[2].toLowerCase();
    const 뒤 = m[3] ?? '';
    if (안닫아도되는것.has(이름) || 뒤.trimEnd().endsWith('/')) continue;
    if (!닫는가) { 쌓임.push(이름); continue; }
    // 닫는 태그. 짝이 맞는 자리를 찾는다.
    const i = 쌓임.lastIndexOf(이름);
    if (i < 0) { 탈.push(`</${이름}> 를 닫는데 여는 <${이름}> 가 없습니다`); continue; }
    const 안닫힌것 = 쌓임.splice(i).slice(1);
    for (const x of 안닫힌것) 탈.push(`<${x}> 를 안 닫았습니다 (</${이름}> 앞에서 끊겼습니다)`);
  }
  for (const x of 쌓임) 탈.push(`<${x}> 를 안 닫았습니다`);

  // 가리키는 파일이 실제로 있나. 이게 "열었는데 아무것도 안 보인다" 의 첫째 원인이다.
  for (const m of String(글).matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
    const 곳 = m[1];
    if (/^(?:https?:|data:|mailto:|tel:|#|\/\/)/i.test(곳)) continue;   // 바깥 것은 못 본다
    if (!있는파일(곳.split(/[?#]/)[0])) 탈.push(`${곳} 을 가리키는데 그 파일이 없습니다`);
  }

  return 탈;
}

/** CSS 중괄호 짝. 이것만으로도 '스타일이 통째로 안 먹는' 경우는 거의 다 잡힌다. */
export function css보기(글) {
  const 뼈 = String(글).replace(/\/\*[\s\S]*?\*\//g, '');
  const 연것 = (뼈.match(/\{/g) ?? []).length;
  const 닫은것 = (뼈.match(/\}/g) ?? []).length;
  if (연것 === 닫은것) return [];
  return [연것 > 닫은것
    ? `중괄호를 ${연것 - 닫은것}개 안 닫았습니다 (여는 것 ${연것} · 닫는 것 ${닫은것})`
    : `닫는 중괄호가 ${닫은것 - 연것}개 더 많습니다 (여는 것 ${연것} · 닫는 것 ${닫은것})`];
}

/** JSON 은 그냥 파싱해 본다 — 되면 되는 것이다. */
export function json보기(글) {
  try { JSON.parse(글); return []; }
  catch (e) { return [String(e.message)]; }
}

/** 명령 하나를 돌린다. Bash 도구와 같은 안전 검사를 거친다. */
function 명령돌리기(cmd, cwd, 제한 = 60000) {
  return new Promise((끝) => {
    const shell = process.platform === 'win32'
      ? { file: process.env.COMSPEC ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${cmd}"`], verbatim: true }
      : { file: '/bin/sh', args: ['-c', cmd] };
    execFile(shell.file, shell.args, {
      cwd, timeout: 제한, maxBuffer: 4 * 1024 * 1024,
      windowsHide: true, windowsVerbatimArguments: shell.verbatim === true,
      encoding: 'buffer',
    }, (err, so, se) => {
      const 풀기 = (b) => (b && b.length ? decode(Buffer.from(b)).text : '');
      const out = [풀기(so), 풀기(se)].filter(Boolean).join('\n').trim();
      const 시그널 = err?.signal ?? null;
      const code = 시그널 ? null : (err?.code ?? 0);
      끝({ ok: !시그널 && code === 0, code, 시그널, out });
    });
  });
}

/** 이 확장자를 돌려 볼 명령이 있나. 없으면 null — 그러면 '못 돌려 봤다' 고 말한다. */
function 돌릴명령(확장) {
  switch (확장) {
    case '.js': case '.mjs': case '.cjs': return (p) => `node --check "${p}"`;
    case '.py': return (p) => `python -m py_compile "${p}"`;
    default: return null;
  }
}

const 짧게 = (s, n = 300) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export const VERIFY_TOOL = {
  schema: {
    name: 'Verify',
    description:
      '만든 것이 실제로 되는지 확인한다. 일을 끝내기 전에 **반드시** 한 번 불러라.'
      + ' 파일이 있다는 것과 그 파일이 된다는 것은 다르다 — 안 닫힌 태그, 없는 파일을'
      + ' 가리키는 src, 괄호 하나 모자란 JS 는 파일 목록만 봐서는 안 보인다.'
      + ' 돌려 볼 수 있는 것은 돌려 보고(node --check · py_compile),'
      + ' 못 돌리는 것은 읽어서 본다(HTML 태그 짝 · 빠진 참조 · CSS 중괄호 · JSON).'
      + ' 확인 못 한 종류는 못 했다고 그대로 말해 준다.'
      + ' 검사·빌드를 돌리는 것은 Bash 로 해라 — 그건 사용자 승인을 거쳐야 하는 일이다.',
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: '확인할 파일들. 없으면 작업 폴더에서 확인할 수 있는 것을 다 본다.',
        },
      },
      required: [],
    },
  },

  async run(args, ctx) {
    const 뿌리 = ctx.scope.root;

    // 볼 파일 고르기. 안 주면 작업 폴더에서 확인할 수 있는 것을 찾는다.
    let 볼것 = [];
    // .gitignore 로 안 본 것은 셈해 뒀다가 끝에 적는다. 조용히 빼면
    // "빌드 산출물에 탈이 있는데 왜 확인이 통과냐" 를 사람이 못 푼다.
    const 건너뜀 = { 폴더: 0, 파일: 0 };
    // 훑기 상한에서 멈춘 것도 같이 챙긴다 — 안 본 것을 "탈 없음" 으로 읽히게 두면 안 된다.
    let 잘림 = false;
    let 상한 = 0;
    const 셈더하기 = (목록) => {
      건너뜀.폴더 += 목록.건너뜀?.폴더 ?? 0;
      건너뜀.파일 += 목록.건너뜀?.파일 ?? 0;
      if (목록.잘림) { 잘림 = true; 상한 = 목록.상한 ?? 상한; }
    };
    if (Array.isArray(args.paths) && args.paths.length) {
      for (const p of args.paths) {
        let abs;
        try { abs = ctx.scope.resolve(p); } catch (e) { 볼것.push({ 없음: p, 왜: e.message }); continue; }
        if (!existsSync(abs)) { 볼것.push({ 없음: p, 왜: '파일이 없습니다' }); continue; }
        if (statSync(abs).isDirectory()) {
          const 안것 = walk(abs, { skipDirs: SKIP_DIRS });
          셈더하기(안것);
          for (const f of 안것) 볼것.push({ path: f.path });
        } else 볼것.push({ path: abs });      // 짚어 준 파일은 규칙과 상관없이 본다
      }
    } else {
      const 전부 = walk(뿌리, { skipDirs: SKIP_DIRS });
      셈더하기(전부);
      볼것 = 전부
        .filter((f) => ['.html', '.htm', '.css', '.json', '.js', '.mjs', '.cjs', '.py'].includes(extname(f.path).toLowerCase()))
        .slice(0, 40)
        .map((f) => ({ path: f.path }));
    }

    const 된것 = [];
    const 탈난것 = [];
    const 못한것 = [];

    for (const x of 볼것) {
      if (x.없음) { 탈난것.push({ 이름: x.없음, 탈: [x.왜] }); continue; }
      const abs = x.path;
      const 이름 = ctx.scope.show(abs);
      const 확장 = extname(abs).toLowerCase();

      if (내부살림(abs)) continue;
      let buf;
      try { buf = readFileSync(abs); } catch (e) { 탈난것.push({ 이름, 탈: [e.message] }); continue; }
      if (looksBinary(buf)) { 못한것.push({ 이름, 왜: '바이너리 — 돌려 볼 수 없습니다' }); continue; }
      const 글 = decode(buf).text;

      // ── 돌려 볼 수 있는 것 ──────────────────────────────────────────
      const 만들기 = 돌릴명령(확장);
      if (만들기) {
        const cmd = 만들기(abs);
        try { checkCommand(cmd); }
        catch { 못한것.push({ 이름, 왜: '안전 검사에 걸려 안 돌렸습니다' }); continue; }
        const r = await 명령돌리기(cmd, 뿌리, 30000);
        // 도구 자체가 이 컴퓨터에 없으면 '틀렸다' 가 아니라 '못 봤다' 이다.
        // 파이썬이 안 깔린 PC 에서 py 파일을 전부 빨갛게 칠하면 아무도 안 믿는다.
        if (!r.ok && /not recognized|command not found|찾을 수 없|No such file/i.test(r.out)) {
          못한것.push({ 이름, 왜: `${확장} 을 확인할 도구가 이 컴퓨터에 없습니다` });
        } else if (r.ok) 된것.push({ 이름, 어떻게: 확장 === '.py' ? 'py_compile' : 'node --check' });
        else 탈난것.push({ 이름, 탈: [짧게(r.out) || `종료코드 ${r.code}`] });
        continue;
      }

      // ── 읽어서 보는 것 ──────────────────────────────────────────────
      let 탈 = null;
      if (확장 === '.html' || 확장 === '.htm') {
        탈 = html보기(글, { 있는파일: (곳) => existsSync(resolve(dirname(abs), 곳)) });
      } else if (['.css', '.scss', '.less'].includes(확장)) {
        탈 = css보기(글);
      } else if (확장 === '.json') {
        탈 = json보기(글);
      }

      if (탈 === null) { 못한것.push({ 이름, 왜: `${확장 || '확장자 없음'} 은 아직 확인할 줄 모릅니다` }); continue; }
      if (탈.length) 탈난것.push({ 이름, 탈 });
      else 된것.push({ 이름, 어떻게: 확장 === '.json' ? 'JSON 파싱' : '읽어서 확인' });
    }

    // ── 사실대로 적는다 ───────────────────────────────────────────────
    const 줄 = [];

    if (탈난것.length) {
      줄.push(`탈난 것 ${탈난것.length}개 — 여기부터 고쳐라:`);
      for (const x of 탈난것) {
        줄.push(`  ✗ ${x.이름}`);
        for (const t of x.탈.slice(0, 5)) 줄.push(`      ${t}`);
        if (x.탈.length > 5) 줄.push(`      … 그 밖에 ${x.탈.length - 5}개`);
      }
      줄.push('');
    }

    if (된것.length) {
      줄.push(`확인된 것 ${된것.length}개:`);
      for (const x of 된것.slice(0, 20)) 줄.push(`  ✓ ${x.이름} (${x.어떻게})`);
      if (된것.length > 20) 줄.push(`  … 그 밖에 ${된것.length - 20}개`);
      줄.push('');
    }

    /*
     * 못 확인한 것을 **반드시** 적는다.
     *
     * 이걸 빼면 "확인된 것 3개" 만 보이고, 사람도 모델도 그게 전부인 줄 안다.
     * 그러면 이 도구는 확인해 주는 물건이 아니라 안심시켜 주는 물건이 된다.
     */
    if (못한것.length) {
      줄.push(`확인 못 한 것 ${못한것.length}개 (**됐다고 말하면 안 된다**):`);
      for (const x of 못한것.slice(0, 15)) 줄.push(`  ? ${x.이름} — ${x.왜}`);
      if (못한것.length > 15) 줄.push(`  … 그 밖에 ${못한것.length - 15}개`);
    }

    if (!줄.length) 줄.push('확인할 수 있는 파일이 없었습니다. 무엇을 확인할지 paths 로 알려 주세요.');

    /*
     * 이 프로젝트가 스스로 정해 둔 확인 방법이 있으면 **알려만 준다.**
     *
     * 여기서 직접 돌리지 않는다. 검사 스크립트는 무슨 짓이든 할 수 있고,
     * 그걸 돌리는 길은 Bash 하나뿐이어야 한다 — 거기에만 승인 관문과 안전
     * 검사가 걸려 있기 때문이다. 이 도구가 몰래 돌리면 strict 모드에서
     * "물어보고 실행한다" 는 약속이 이 자리에서만 깨진다.
     */
    const 있는명령 = 프로젝트확인법(뿌리);
    if (있는명령) {
      줄.push('');
      줄.push(`이 프로젝트에는 ${있는명령} 가 있습니다. 진짜로 도는지 보려면 Bash 로 돌려라.`);
    }

    const 다됐나 = !탈난것.length;
    return {
      content: 줄.join('\n').trim() + 건너뜀말(건너뜀, 잘림, 상한),
      summary: 탈난것.length
        ? `탈 ${탈난것.length}개 · 확인 ${된것.length}개`
        : `확인 ${된것.length}개` + (못한것.length ? ` · 못 확인 ${못한것.length}개` : ''),
      // 루프가 '아직 안 끝났다' 고 알 수 있게. 탈이 났는데 성공으로 넘기면
      // 다음 걸음에서 모델이 "다 됐습니다" 로 답을 맺는다.
      failed: !다됐나,
      확인됨: 된것.length,
      탈: 탈난것.length,
      못확인: 못한것.length,
    };
  },
};

/**
 * 이 프로젝트가 스스로 정해 둔 확인 방법.
 *
 * package.json 에 test 가 있으면 그것이 답이다. 없는 것을 지어내지는 않는다 —
 * 없으면 null 이고, 그러면 파일별 확인만 한 것이 전부다.
 * 돌리지는 않는다. 알려 주기만 한다 (위 머리말 참고).
 */
function 프로젝트확인법(뿌리) {
  const pkg = join(뿌리, 'package.json');
  if (!existsSync(pkg)) return null;
  try {
    const j = JSON.parse(readFileSync(pkg, 'utf8'));
    if (j.scripts?.test) return 'npm test';
    if (j.scripts?.build) return 'npm run build';
  } catch { /* 망가진 package.json 은 아래 파일 확인에서 잡힌다 */ }
  return null;
}

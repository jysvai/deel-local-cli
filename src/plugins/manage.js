// 플러그인 설치·삭제·묶기.
//
// 온라인 기기에서 /plugin install 로 받고, /plugin pack 으로 묶어
// 오프라인 기기에 반입한다. 오프라인에서는 압축만 풀면 그대로 인식된다.
import { execFile } from 'node:child_process';
import { homeDir } from '../config.js';
import { join, dirname, basename, resolve, relative, sep } from 'node:path';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync,
  readdirSync, statSync,
} from 'node:fs';
import { untargz, stripTop, 밖을가리키는것 } from '../pack/tar.js';
import { makeZip } from '../pack/zip.js';
import { allowTemporarily, isOffline, NetBlocked } from '../safety/network.js';
import { 원시요청, 몸읽기 } from '../backend/http.js';

/**
 * 플러그인을 받다 되돌림(redirect)이 오면 따라가도 되는 곳인가. 던지면 안 따라간다.
 * github 가 제 다른 집으로 보내는 것만 따라간다 — https 이고, github.com · githubusercontent.com 뿐.
 */
export function 플러그인되돌림(다음) {
  if (다음.protocol !== 'https:') throw new Error(`${다음.protocol} 로 되돌립니다 — 따라가지 않습니다`);
  if (!/(^|\.)github\.com$|(^|\.)githubusercontent\.com$/i.test(다음.hostname)) {
    throw new Error(`github 밖(${다음.hostname})으로 되돌립니다 — 따라가지 않습니다`);
  }
}
import { copyDir } from '../tools/fsutil.js';
import { BOM떼기 } from '../safety/trust.js';

/*
 * 플러그인이 깔리는 자리.
 *
 * 여기 넘기는 `home` 은 **살림 자리**(`~/.deel` 또는 `DEEL_HOME`)다. 예전에는
 * OS 의 집 폴더를 받아 `.deel` 을 직접 붙였는데, 그러면 `DEEL_HOME` 이 안
 * 먹었다 — 휴대용 설치(USB·공유폴더)에서 설정은 USB 로 가고 플러그인만
 * 로밍 프로필에 남았고, `deel reset plugins` 는 엉뚱한 데를 보며 「0개 ·
 * 이미 비어 있습니다」 를 찍었다. 살림 자리 하나로 모은다.
 */
export const pluginsDir = (home = homeDir()) => join(home, 'plugins');

// owner/repo · owner/repo#가지 · 전체 URL 을 모두 받는다.
export function parseSpec(spec) {
  let s = String(spec).trim();
  let ref = null;
  const hash = s.lastIndexOf('#');
  if (hash > 0) { ref = s.slice(hash + 1); s = s.slice(0, hash); }

  s = s.replace(/\.git$/, '');
  const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (!m) return null;
  return { owner: m[1], repo: m[2], ref, url: `https://github.com/${m[1]}/${m[2]}.git` };
}

function has(cmd) {
  return new Promise((res) => {
    execFile(cmd, ['--version'], { timeout: 8000, windowsHide: true }, (err) => res(!err));
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    execFile(cmd, args, { timeout: 180000, windowsHide: true, maxBuffer: 1 << 24, ...opts },
      (err, stdout, stderr) => res({ ok: !err, out: `${stdout}${stderr}`.trim() }));
  });
}

/**
 * 받은 묶음을 폴더에 푼다.
 *
 * ── 왜 따로 떼어 놨나 ───────────────────────────────────────────────────
 *
 * 이 몇 줄이 **남이 준 글자로 디스크에 파일을 쓰는 자리**다. 이 프로그램에서
 * 제일 조심해야 하는 대목인데, fetchInto 안에 묻혀 있어서 검사가 한 번도 안
 * 지나갔다. 거기까지 가려면 진짜로 네트워크에서 tarball 을 받아야 했기 때문이다.
 *
 * 그래서 「받는 일」 과 「푸는 일」 을 갈랐다. 푸는 일은 이제 파일 목록만 주면
 * 그대로 재 볼 수 있다 — 남이 노리고 만든 묶음을 먹여 보는 것을 포함해서.
 *
 * ── 무엇을 막나 ─────────────────────────────────────────────────────────
 *
 * tar 안의 이름은 남이 적은 글자다. `../../../..` 하나면 플러그인 폴더 밖에
 * 파일을 쓴다. 아래 mkdirSync 가 recursive 라 없는 폴더까지 만들어 가며 나간다.
 * 이 프로그램이 파는 문장이 「작업 폴더 밖은 안 만진다」 인데, 플러그인을 받는
 * 이 길에만 그 문장을 지키는 코드가 없었다.
 *
 * 나쁜 것만 골라 버리지 않고 **묶음째 거절한다.** 밖을 가리키는 이름이 든
 * 묶음은 실수가 아니라 노린 것이고, 나머지를 풀어 줄 까닭이 없다.
 * 그리고 **rmSync 앞에서** 막는다 — 거절할 묶음 때문에 이미 깔린 것을
 * 지워 버리면 안 된다.
 */
export function 묶음풀기(dest, files) {
  if (!files?.length) return { error: '받은 묶음이 비어 있습니다' };
  const 밖엣것 = 밖을가리키는것(dest, files);
  if (밖엣것.length) {
    return { error: `묶음 안에 플러그인 폴더 밖을 가리키는 이름이 있습니다 — 풀지 않았습니다: ${밖엣것[0].name}` };
  }
  /*
   * ── 안쪽이어도 **못 쓰는** 이름은 지우기 전에 거른다 (2.0.0 3회차 사냥) ──
   *
   * 위는 밖으로 나가는 것만 본다. 안쪽인데 쓰다가 넘어지는 이름이 셋 있었다:
   *
   *   `a/..`          풀 자리 그 자체 → EISDIR
   *   `x` 와 `x/y`    파일과 폴더가 같은 이름 → EEXIST
   *   `Doc.md` · `doc.md`  윈도우·맥에서는 한 파일 → 하나가 말없이 사라진다
   *
   * 앞의 둘은 **rmSync 뒤에** 던져서 풀 자리를 비운 채 날것 오류(EISDIR)로 끝났고, 셋째는 「2개 풀었다」
   * 고 하고 하나만 남겼다. 쓰기 전에 전부 재 보고 사람 말로 거절한다.
   */
  const 뿌리 = resolve(dest);
  /*
   * ── 쓸 이름도 **잰 이름과 같게** (2.0.2 · P3 · P1) ──────────────────────────
   *
   * 아래 재기는 역슬래시를 빗금으로 보고 쟀는데, 쓸 때는 적힌 이름 그대로 `join` 했다.
   * 윈도에서는 둘이 같지만 리눅스·맥에서는 역슬래시가 **이름 글자**라, 윈도에서 만든
   * 묶음의 `sub\file.txt` 가 `sub` 폴더 안이 아니라 뿌리에 한 파일로 풀렸다 — 스킬이
   * 제자리를 못 찾는다. 이름을 한 번 빗금으로 편 것을 재기와 쓰기가 같이 쓴다.
   *
   * 같은 자리 견주기에는 NFC 도 맞춘다. 맥은 `한글`(NFC)과 `한글`(NFD)을 한 파일로
   * 보므로, 두 꼴이 같이 든 묶음은 맥에서 하나가 말없이 사라진다. 대소문자만 다른
   * 이름과 같은 대접으로 묶음째 거절한다.
   */
  const 편이름 = (f) => String(f.name ?? '').replace(/\\/g, '/');
  const 자리들 = new Map();                 // 소문자·NFC 상대 자리 → 적힌 이름
  for (const f of files) {
    const 상대 = relative(뿌리, resolve(뿌리, 편이름(f))).replace(/\\/g, '/');
    if (!상대) return { error: `묶음 안에 풀 폴더 그 자체를 가리키는 파일이 있습니다 — 풀지 않았습니다: ${f.name}` };
    const 열쇠 = 상대.normalize('NFC').toLowerCase();
    if (자리들.has(열쇠)) {
      return { error: `묶음 안에 같은 자리를 가리키는 이름이 둘 있습니다(대소문자나 한글 자모 꼴만 다를 수 있음) — 풀지 않았습니다: ${자리들.get(열쇠)} · ${f.name}` };
    }
    자리들.set(열쇠, f.name);
  }
  for (const [열쇠, 이름] of 자리들) {
    const 마디 = 열쇠.split('/');
    for (let i = 1; i < 마디.length; i++) {
      const 윗자리 = 마디.slice(0, i).join('/');
      if (자리들.has(윗자리)) return { error: `묶음 안에 파일과 폴더가 같은 이름입니다 — 풀지 않았습니다: ${자리들.get(윗자리)} · ${이름}` };
    }
  }
  rmSync(dest, { recursive: true, force: true });
  for (const f of files) {
    const p = join(dest, 편이름(f));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.data);
  }
  return { 푼것: files.length };
}

/*
 * ── git 없이 받을 주소들 (2.0.2 · P5) ─────────────────────────────────────────
 *
 * `#v1.0.0` 처럼 **태그**를 적어도 `refs/heads/` 만 물어서, git 이 없는 PC 에서는 늘
 * 「받지 못했습니다 — 가지 이름을 확인하세요」 였다. git 이 있으면 `clone --branch` 가
 * 태그도 받으니, 같은 명령이 git 유무에 따라 되고 안 됐다. 가지를 먼저 묻고 없으면
 * 태그를 묻는다(같은 이름이면 git 도 가지를 먼저 고른다).
 */
export function 받을주소들(spec) {
  const 뿌리 = `https://codeload.github.com/${spec.owner}/${spec.repo}/tar.gz`;
  if (spec.ref) {
    return [
      { branch: spec.ref, url: `${뿌리}/refs/heads/${spec.ref}` },
      { branch: spec.ref, url: `${뿌리}/refs/tags/${spec.ref}` },
    ];
  }
  return ['main', 'master'].map((b) => ({ branch: b, url: `${뿌리}/refs/heads/${b}` }));
}

// 받는 방법 두 가지. git 이 있으면 clone, 없으면 tarball 을 내려받아 푼다.
async function fetchInto(spec, dest, onStep) {
  if (await has('git')) {
    onStep?.('git clone');
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dirname(dest), { recursive: true });
    const args = ['clone', '--depth', '1'];
    if (spec.ref) args.push('--branch', spec.ref);
    args.push(spec.url, dest);
    const r = await run('git', args);
    if (!r.ok) return { error: `git clone 실패 — ${r.out.split('\n').slice(-2).join(' ')}` };
    rmSync(join(dest, '.git'), { recursive: true, force: true });
    return { how: 'git' };
  }

  onStep?.('tarball 내려받기');
  if (isOffline()) return { error: '오프라인 모드입니다 — 받아 올 수 없습니다. 풀어 놓은 폴더 경로를 주세요.' };
  for (const { branch, url } of 받을주소들(spec)) {
    // 사용자가 이 명령을 친 동안만 github 를 연다. 끝나면 바로 닫는다.
    const close = allowTemporarily(url);
    let gz;
    // 한 문(backend/http.js)으로 나간다 — 프록시를 거치고, 되돌림은 홉마다 문지기를 지난다.
    // github 는 받기 주소를 제 다른 집(githubusercontent 등)으로 되돌리므로 그 홉은 열어 준다 —
    // 그 밖의 집이면 안 따라가고, 왜 못 받았는지를 말한다 (조용히 '주소를 확인하세요' 로 끝내지 않는다).
    // 상한까지만 받는다. 플러그인 묶음이 64MB 를 넘을 일은 없고, 넘는 것을 다 받아 줄 이유도 없다.
    const 열어둔 = [];
    try {
      const res = await 원시요청(url, {
        timeout: 120000, stream: true,
        되돌림: (다음) => { 플러그인되돌림(다음); 열어둔.push(allowTemporarily(다음.origin)); },
      });
      if (!res.ok) { await res.버리기?.(); continue; }
      gz = await 몸읽기(res.res.body, 64 * 1024 * 1024);
    } catch (err) {
      if (err instanceof NetBlocked || /되돌립니다/.test(String(err?.message))) return { error: `받지 못했습니다 — ${err.message}` };
      continue;
    } finally {
      close();
      for (const 닫기 of 열어둔) 닫기();
    }
    if (!gz) return { error: '받은 묶음이 너무 큽니다 (64MB 넘음) — 플러그인 저장소가 맞는지 확인하세요' };
    // 받는 크기만 막으면 압축 폭탄에 그대로 당한다 (pack/tar.js 푼것상한 머리말).
    // 던지는 것을 여기서 받아 화면에 올린다 — 안 받으면 명령이 통째로 죽는다.
    let 푼것;
    try { 푼것 = 묶음풀기(dest, stripTop(untargz(gz))); }
    catch (err) { return { error: `받은 묶음을 풀지 못했습니다 — ${String(err?.message ?? err)}` }; }
    if (푼것.error) return { error: 푼것.error };
    return { how: 'tarball', branch };
  }
  return { error: '받지 못했습니다 — 저장소 주소나 가지·태그 이름을 확인하세요' };
}

/**
 * 플러그인 이름을 **폴더 이름 한 칸**으로 자른다.
 *
 * ── 왜 있어야 하나 ────────────────────────────────────────────────────
 *
 * 설치할 자리를 `join(플러그인폴더, 이름)` 으로 정하는데, 이 **이름은 남이 적은
 * 글자**다. `.claude-plugin/plugin.json` 의 `name` 을 그대로 읽어 쓰고, 그 파일은
 * 플러그인을 만든 사람이 통째로 정한다.
 *
 * 그래서 이름이 `../../Desktop/뭐시기` 면 설치할 자리가 홈 폴더 밖으로 나간다.
 * `join` 은 `..` 를 정리해 줄 뿐 막아 주지 않는다. 그 자리에 대고 우리가 하는
 * 일이 하필 이것이다 —
 *
 *   rmSync(dest, { recursive: true, force: true })   ← 통째로 지운다
 *   copyDir(tmp, dest)                                ← 그 자리에 파일을 놓는다
 *
 * 묶음 안의 파일 확장자는 안 가린다(반입 묶음을 만들 때만 가린다). 그러니
 * 이름 한 줄로 **남의 폴더를 지우고 그 자리에 실행 파일을 놓을 수 있다.**
 * 시작프로그램 폴더를 노리면 다음 로그인부터 그것이 돈다.
 *
 * 빈 이름과 `.` 도 막아야 한다. 그 둘은 자리가 **플러그인 폴더 자신**이 되어,
 * `rmSync` 가 설치해 둔 플러그인을 전부 지운다.
 *
 * 역슬래시도 칸막이로 본다. 윈도우에서 만든 묶음이 리눅스에서 이름 한 칸으로
 * 통과하면, 그 묶음을 다시 윈도우로 옮겼을 때 그때 나간다 (pack/tar.js 의
 * 안쪽인가 와 같은 판단이다).
 *
 * 이 함수가 없으면 tar 엔트리 이름을 아무리 잘 막아도 소용이 없다. 묶음이
 * **제 이름으로** 나가기 때문이다.
 */
export function 이름한칸(이름) {
  const 글 = String(이름 ?? '').replace(/\\/g, '/').trim();
  if (!글) return null;
  // 마지막 칸만 쓴다. `a/b/../c` 같은 것도 여기서 한 칸이 된다.
  const 한칸 = basename(글);
  if (!한칸 || 한칸 === '.' || 한칸 === '..') return null;
  // 드라이브 글자·칸막이가 남아 있으면 이름이 아니다.
  if (/[/:]/.test(한칸)) return null;
  /*
   * ── 윈도우가 폴더 이름으로 못 쓰는 것도 이름이 아니다 (2.0.0 4회차 사냥) ──
   *
   * 칸막이만 막았더니 `a*b` · `a?b` · NUL 글자 같은 이름이 통과해 install() 이 mkdir 에서
   * **던지고** `.tmp-*` 를 남겼다. `keep.` 은 윈도우가 끝 점을 떼어 `keep` 자리에 깔려
   * 옆 플러그인과 겹쳤고, `CON` · `nul.txt` 는 장치 이름이라 파일이 딴 데로 간다.
   * 리눅스에서는 쓸 수 있는 이름도 막는다 — 묶음(pack)은 윈도우 PC 로 반입된다.
   * 막힌 이름이면 부르는 쪽이 우리가 아는 이름(폴더·저장소 이름)으로 간다.
   */
  if (/[<>"|?*]/.test(한칸) || [...한칸].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return null;
  if (/[. ]$/.test(한칸)) return null;
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(한칸)) return null;
  if (한칸.length > 100) return null;
  return 한칸;
}

/**
 * 그 자리가 정말 플러그인 폴더 **안**인가 — 이름을 자른 뒤에도 한 번 더 본다.
 *
 * 자르는 자가 언젠가 틀릴 수 있다. 그때 마지막으로 서는 그물이다. 지우고
 * 쓰는 자리라 두 겹으로 막는다.
 */
function 플러그인자리인가(base, dest) {
  const 뿌리 = resolve(base);
  const 갈곳 = resolve(dest);
  return 갈곳 !== 뿌리 && 갈곳.startsWith(뿌리 + sep);
}

function manifestOf(dir) {
  const f = join(dir, '.claude-plugin', 'plugin.json');
  if (!existsSync(f)) return null;
  // BOM 을 뗀다 — 윈도우에서 저장한 plugin.json 이 이름·판·라이선스 없이 읽혔다(2.0.0 3회차).
  try { return JSON.parse(BOM떼기(readFileSync(f, 'utf8'))); } catch { return null; }
}

function countIn(dir) {
  let skills = 0;
  let commands = 0;
  let hooks = 0;
  for (const d of ['skills', join('.agents', 'skills'), join('.claude', 'skills')]) {
    const p = join(dir, d);
    if (!existsSync(p)) continue;
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(p, e.name, 'SKILL.md'))) skills++;
    }
  }
  for (const d of ['commands', join('.claude', 'commands'), join('.agents', 'commands')]) {
    const p = join(dir, d);
    if (!existsSync(p)) continue;
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md')) commands++;
    }
  }
  hooks = walkCount(dir, (n) => /\.(js|cjs|mjs|sh|ps1|cmd|bat|py)$/i.test(n));
  return { skills, commands, hooks };
}

function walkCount(dir, match, depth = 5) {
  let n = 0;
  const stack = [{ d: dir, k: 0 }];
  while (stack.length) {
    const { d, k } = stack.pop();
    if (k > depth) continue;
    let es;
    try { es = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of es) {
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') stack.push({ d: join(d, e.name), k: k + 1 }); }
      else if (match(e.name)) n++;
    }
  }
  return n;
}

/*
 * 설치는 **던지지 않는다.** 이름을 걸러도 디스크가 넘어질 자리(권한·꽉 찬 디스크·긴 경로)는
 * 남는다. 던지면 `/plugin install` 이 통째로 죽고 `.tmp-*` 가 남아, 다음 설치가 그 찌꺼기
 * 위에서 돈다(2.0.0 4회차 사냥). 받은 오류는 사람 말로 돌려주고 임시 폴더를 치운다.
 */
export async function install(spec, 옵션 = {}) {
  const 치울것 = [];
  try {
    return await 설치하기(spec, 옵션, 치울것);
  } catch (err) {
    for (const p of 치울것) { try { rmSync(p, { recursive: true, force: true }); } catch { /* 못 치우면 다음 설치가 먼저 지운다 */ } }
    return { error: `플러그인을 설치하지 못했습니다 — ${String(err?.message ?? err)}` };
  }
}

async function 설치하기(spec, { home = homeDir(), onStep, 복사 = copyDir } = {}, 치울것 = []) {
  const base = pluginsDir(home);

  // 이미 풀어 놓은 폴더를 그대로 넣는 길. 오프라인 기기에서 이쪽을 쓴다.
  const asPath = String(spec).trim().replace(/^["']|["']$/g, '');
  const isLocal = existsSync(asPath) && statSync(asPath).isDirectory();

  const parsed = isLocal ? null : parseSpec(spec);
  if (!isLocal && !parsed) {
    return { error: `주소를 알아볼 수 없습니다: ${spec}\n  예: affaan-m/ECC · https://github.com/affaan-m/ECC · C:\\받은폴더\\ecc` };
  }

  const tmp = join(base, `.tmp-${isLocal ? 'local' : parsed.repo}`);
  치울것.push(tmp);
  /*
   * ── copyDir 이 건너뛴 것을 아무도 안 읽고 있었다 ──────────────────────
   *
   * copyDir(tools/fsutil.js)은 심볼릭 링크와 파일도 폴더도 아닌 것을
   * **말없이 건너뛴다.** 그러라고 `skipped` 배열까지 내주는데, 여기
   * 두 군데 부르는 자리가 둘 다 그 값을 안 받았다.
   *
   * 링크로 SKILL.md 를 나눠 쓰는 것은 흔한 꼴이다(맥·리눅스에서 스킬
   * 여러 개가 같은 뼈대를 가리키게 하는 것). 그런 플러그인을 넣으면
   * 화면에는 `✓ myplugin 1.0.0 (MIT) · 스킬 3개 명령 2개` 가 뜨고,
   * 실제로 깔린 것은 2개다.
   *
   * 세는 자리도 어긋나 있었다. countIn 을 **복사하기 전** 임시 폴더에서
   * 부르므로, 복사하다 빠진 것이 개수에 안 잡힌다. 나중에 `/plugin` 으로
   * 목록을 보면 list() 는 진짜 폴더를 세니 숫자가 다르다 — 같은 상태를
   * 두 자리에서 따로 세는 바로 그 모양이다.
   */
  const 건너뛴것 = [];
  let got;
  if (isLocal) {
    onStep?.('폴더 복사');
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(dirname(tmp), { recursive: true });
    copyDir(asPath, tmp, { skipped: 건너뛴것 });
    rmSync(join(tmp, '.git'), { recursive: true, force: true });
    got = { how: '폴더', from: asPath };
  } else {
    got = await fetchInto(parsed, tmp, onStep);
  }
  if (got.error) { rmSync(tmp, { recursive: true, force: true }); return { error: got.error }; }

  const info = manifestOf(tmp);
  /*
   * 이름은 **남이 적은 글자**다. 자리 조립에 쓰기 전에 한 칸으로 자른다
   * (이름한칸 머리말 — 안 자르면 이름 한 줄로 남의 폴더가 지워진다).
   * 매니페스트 이름이 못 쓸 것이면 우리가 아는 이름(폴더명·저장소명)으로 간다.
   */
  const 적힌이름 = 이름한칸(info?.name);
  const 뒷이름 = 이름한칸(isLocal ? basename(asPath) : parsed.repo);
  const name = 적힌이름 || 뒷이름;
  if (!name) {
    rmSync(tmp, { recursive: true, force: true });
    return { error: '플러그인 이름을 읽지 못했습니다 — 이름이 비었거나 폴더 이름으로 쓸 수 없는 글자입니다.' };
  }
  const dest = join(base, name);
  // 두 겹째 그물. 여기서 걸리면 자르는 자가 틀린 것이므로 아예 멈춘다.
  if (!플러그인자리인가(base, dest)) {
    rmSync(tmp, { recursive: true, force: true });
    return { error: `설치할 자리가 플러그인 폴더 밖입니다 — 설치하지 않았습니다 (${name}).` };
  }

  const 담을것 = countIn(tmp);
  if (!담을것.skills && !담을것.commands) {
    rmSync(tmp, { recursive: true, force: true });
    return { error: `스킬도 명령도 없습니다. 플러그인이 맞는지 확인하세요 (${isLocal ? asPath : parsed.owner + '/' + parsed.repo})` };
  }

  /*
   * ── 옛것을 **먼저 지우지 않는다** (2.0.2 · P7) ──────────────────────────────
   *
   * 다시 설치(업데이트)는 옛 폴더를 지우고 새것을 베꼈다. 베끼다 넘어지면(디스크가
   * 꽉 참 · 잠긴 파일 · 긴 경로) **둘 다 잃었다** — 옛것은 지웠고 새것은 반쪽이다.
   * 업데이트 한 번에 쓰던 플러그인이 사라지는 것이다.
   *
   * 옛것을 점 이름(`.old-…` — list() 가 안 보는 이름)으로 비켜 두고 베낀다. 다 베끼면
   * 비켜 둔 것을 버리고, 넘어지면 반쪽을 치우고 비켜 둔 것을 제자리로 되돌린다.
   * 비키기(rename)부터 안 되면(윈도에서 그 폴더의 파일을 연 프로그램이 있으면 흔하다)
   * 아무것도 안 건드리고 그렇다고 말한다.
   */
  mkdirSync(dirname(dest), { recursive: true });
  const 옛것있나 = existsSync(dest);
  const 비켜둘곳 = join(base, `.old-${name}-${process.pid}-${Date.now()}`);
  if (옛것있나) {
    try { renameSync(dest, 비켜둘곳); }
    catch (err) {
      rmSync(tmp, { recursive: true, force: true });
      return { error: `깔려 있던 ${name} 을 비키지 못해 다시 설치하지 않았습니다 — 쓰던 것은 그대로입니다 (${err?.code ?? err?.message ?? err}). 그 폴더의 파일을 연 프로그램을 닫고 다시 하세요.` };
    }
  }
  try {
    복사(tmp, dest, { skipped: 건너뛴것 });
  } catch (err) {
    try { rmSync(dest, { recursive: true, force: true }); } catch { /* 반쪽을 못 치우면 아래 되돌리기가 넘어진다 — 그 말도 한다 */ }
    let 되돌림 = '쓰던 것은 그대로입니다';
    if (옛것있나) {
      try { renameSync(비켜둘곳, dest); }
      catch { 되돌림 = `쓰던 것은 ${비켜둘곳} 에 남아 있습니다 — 폴더 이름을 ${name} 으로 되돌리면 됩니다`; }
    } else {
      되돌림 = '반쪽은 치웠습니다';
    }
    rmSync(tmp, { recursive: true, force: true });
    return { error: `${name} 을 베끼지 못해 설치하지 않았습니다 — ${되돌림} (${err?.code ?? err?.message ?? err})` };
  }
  if (옛것있나) { try { rmSync(비켜둘곳, { recursive: true, force: true }); } catch { /* 못 버려도 list() 는 점 이름을 안 본다 */ } }
  rmSync(tmp, { recursive: true, force: true });
  // 개수는 **깔린 자리**에서 다시 센다. 복사하다 빠진 것이 여기서 빠진다.
  const counts = countIn(dest);

  // 어디서 왔는지 남긴다 — 나중에 반입 심사에서 출처를 물어본다.
  writeFileSync(join(dest, '.deel-source.json'), JSON.stringify({
    from: isLocal ? asPath : `${parsed.owner}/${parsed.repo}`,
    ref: got.branch ?? parsed?.ref ?? null,
    how: got.how,
    at: new Date().toISOString(),
    license: info?.license ?? null,
  }, null, 2) + '\n', 'utf8');

  return {
    name, version: info?.version ?? '', license: info?.license ?? null, path: dest,
    ...counts, how: got.how,
    // 건너뛴 것이 있으면 **개수와 함께** 올린다. 부르는 쪽이 이걸 안 적으면
    // 「스킬 3개」 라고 해 놓고 2개만 깔린 상태가 그대로 초록으로 보인다.
    건너뜀: 건너뛴것,
    // 세기 전과 후가 다르면 그것도 말한다 — 무엇이 빠졌는지 짚어 주는 값이다.
    ...(담을것.skills !== counts.skills || 담을것.commands !== counts.commands
      ? { 덜깔림: { 담을것, 깔린것: counts } } : {}),
  };
}

export function list({ home = homeDir() } = {}) {
  const base = pluginsDir(home);
  if (!existsSync(base)) return [];
  const out = [];
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = join(base, e.name);
    const info = manifestOf(dir);
    let src = null;
    const sf = join(dir, '.deel-source.json');
    if (existsSync(sf)) { try { src = JSON.parse(BOM떼기(readFileSync(sf, 'utf8'))); } catch {} }
    /*
     * 매니페스트 이름이 폴더 이름으로 못 쓸 것(`..` · `keep.`)이면 **폴더 이름**을 보인다.
     * 목록이 보여 준 이름으로 remove() 가 못 찾으면 사람은 지울 길이 없다(2.0.0 4회차 사냥).
     * 쓸 수 있는 이름이면 매니페스트 이름 그대로다 — 폴더와 달라도 remove() 가 그 이름으로 찾는다.
     */
    const 적힌 = typeof info?.name === 'string' ? info.name : '';
    out.push({
      name: 적힌 && 이름한칸(적힌) === 적힌 ? 적힌 : e.name,
      폴더: e.name,
      version: info?.version ?? '',
      license: info?.license ?? src?.license ?? null,
      from: src?.from ?? '(직접 넣음)',
      path: dir,
      ...countIn(dir),
    });
  }
  return out.sort((a, b) => b.skills - a.skills);
}

export function remove(name, { home = homeDir() } = {}) {
  /*
   * 지우는 자리도 이름으로 정해진다. 그러니 여기도 한 칸으로 자른다.
   *
   * 사람이 직접 치는 자리라 안전할 것 같지만, 목록(list)이 보여 주는 이름을
   * 그대로 복사해 붙이는 것이 보통이고 그 이름은 매니페스트에서 온다.
   * 설치 때 막아도 이미 깔려 있던 것에는 못 쓴 이름이 남아 있을 수 있다.
   */
  const base = pluginsDir(home);
  const 한칸 = 이름한칸(name);
  const 찾는이름 = String(name ?? '').trim();
  /*
   * 폴더 이름으로 못 찾으면 **매니페스트 이름**으로 찾는다. 목록(list)은 매니페스트
   * 이름을 보여 주는데, 손으로 넣은 플러그인은 폴더 이름과 다르다. 찾는 대상은
   * 플러그인 폴더를 읽어 나온 칸뿐이라 밖으로 나갈 길이 없다. 둘 이상 걸리면 아무것도
   * 안 지운다 — 어느 것인지 우리가 고르면 사람이 안 고른 것을 지우게 된다.
   */
  const 이름으로찾기 = () => {
    try {
      return readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && 찾는이름
          && manifestOf(join(base, e.name))?.name === 찾는이름)
        .map((e) => e.name);
    } catch { return []; }   // 플러그인 폴더가 없다 — 아래에서 없다고 말한다
  };
  let dir = 한칸 ? join(base, 한칸) : null;
  if (dir && 플러그인자리인가(base, dir) && existsSync(dir)) {
    /*
     * ── 폴더로 찾았어도 **목록 이름**과 겹치는지 본다 (6회차 Gemini 플러그인 P6) ──
     *
     * 목록은 매니페스트 이름을 보여 준다. 폴더 `foo` 의 이름이 `bar` 이고 딴 폴더
     * `plugin-a` 의 이름이 `foo` 면, 사람이 목록에서 보고 친 `foo` 는 plugin-a 다.
     * 그런데 폴더부터 찾아 **bar 를** 지웠다. 두 가지로 읽히면 아무것도 안 지운다.
     */
    /*
     * 앞에 `manifestOf(dir)?.name === 찾는이름 ? [] :` 이 붙어 있었다 (8회차 판정).
     *
     * 폴더 이름과 그 폴더의 매니페스트 이름이 **같기만 하면** 삼항 앞쪽이 위 검사를
     * 통째로 껐다. 그런데 딴 폴더가 목록에 같은 이름으로 떠 있을 수 있다 —
     * 재 보니 폴더 `foo`(이름 foo) 와 폴더 `plugin-a`(이름 foo) 가 같이 있을 때
     * `remove('foo')` 가 아무 말 없이 `foo` 를 지웠다. 바로 위 주석이 「두 가지로
     * 읽히면 아무것도 안 지운다」 라고 적어 둔 그 자리다. 반쪽 붙은 고침이었다.
     *
     * 지금 폴더를 뺀 나머지에 같은 이름이 있으면, 폴더 이름이 무엇이든 두 가지다.
     */
    const 딴것 = 이름으로찾기().filter((n) => n !== basename(dir));
    if (딴것.length) {
      return { error: `${찾는이름} 이 두 플러그인으로 읽힙니다 — 폴더 이름이 ${찾는이름} 인 것과 목록 이름이 ${찾는이름} 인 ${딴것.join(' · ')}. 목록에 보인 딴 이름이나 겹치지 않는 폴더 이름으로 지우세요` };
    }
  } else {
    const 같은것 = 이름으로찾기();
    if (같은것.length > 1) {
      return { error: `이름이 ${찾는이름} 인 플러그인이 ${같은것.length}개입니다 — 폴더 이름으로 지우세요: ${같은것.join(' · ')}` };
    }
    if (!같은것.length) return { error: `설치돼 있지 않습니다: ${name}` };
    dir = join(base, 같은것[0]);
  }
  rmSync(dir, { recursive: true, force: true });
  return { removed: basename(dir) };
}

// 반입용 묶음. 실행 스크립트는 빼고 스킬·명령만 담는다.
const PACK_SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'tests', '__pycache__', '.github']);
const PACK_SKIP_EXT = /\.(js|cjs|mjs|sh|ps1|cmd|bat|py|exe|dll|so|dylib)$/i;

export function pack(outFile, { home = homeDir(), only = null } = {}) {
  const base = pluginsDir(home);
  if (!existsSync(base)) return { error: '설치된 플러그인이 없습니다.' };

  const entries = [];
  const included = [];
  let skipped = 0;
  let 안담은링크 = 0;

  for (const p of list({ home })) {
    if (only?.length && !only.includes(p.name)) continue;
    let n = 0;
    const stack = [p.path];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (!PACK_SKIP_DIRS.has(e.name)) stack.push(full);
          continue;
        }
        /*
         * 폴더도 파일도 아닌 것은 담지 않는다 (6회차 Gemini 플러그인 P10).
         *
         * 폴더를 가리키는 링크(윈도 정션·심볼릭 링크)는 isDirectory() 가 거짓이라 파일로
         * 읽다가 EISDIR 로 던졌다 — /plugin pack 이 통째로 죽었다. 따라가도 안 된다:
         * 링크는 플러그인 폴더 밖을 가리킬 수 있고, 이 묶음은 딴 PC 로 반입된다.
         * (손으로 넣은 플러그인에만 있다 — install 의 copyDir 은 링크를 이미 건너뛴다.)
         */
        if (!e.isFile()) { 안담은링크++; continue; }
        if (PACK_SKIP_EXT.test(e.name)) { skipped++; continue; }
        const rel = full.slice(base.length + 1).split(/[\\/]/).join('/');
        entries.push({ name: rel, data: readFileSync(full), mtime: statSync(full).mtime });
        n++;
      }
    }
    included.push({ ...p, files: n });
  }

  if (!entries.length) return { error: '담을 파일이 없습니다.' };

  // 무엇이 들어 있는지 사람이 읽을 수 있게 같이 담는다 — 반입 심사에 쓴다.
  const manifest = [
    'deel 플러그인 묶음',
    `만든 시각  ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
    `플러그인   ${included.length}개`,
    `파일       ${entries.length}개`,
    `제외한 실행 스크립트  ${skipped}개 (js·sh·ps1·py 등은 담지 않습니다)`,
    ...(안담은링크 ? [`제외한 링크  ${안담은링크}개 (플러그인 폴더 밖을 가리킬 수 있어 담지 않습니다)`] : []),
    '',
    '이름'.padEnd(24) + '판'.padEnd(10) + '라이선스'.padEnd(16) + '스킬  명령  출처',
    '-'.repeat(96),
    ...included.map((p) =>
      String(p.name).padEnd(24) + String(p.version || '-').padEnd(10) +
      String(p.license || '미상').padEnd(16) +
      String(p.skills).padStart(4) + String(p.commands).padStart(6) + '  ' + p.from),
    '',
    '푸는 법: 이 zip 을 오프라인 기기의 ~/.deel/plugins/ 에 풀면 됩니다.',
    '        deel 을 켜면 자동으로 인식합니다. 설치 명령은 필요 없습니다.',
    '',
  ].join('\n');
  entries.unshift({ name: '사용안내.txt', data: Buffer.from(manifest, 'utf8') });

  // 한도(파일 65,535개 · 4GB)를 넘으면 makeZip 이 사람 말로 던진다 — 명령째 죽지 않게 받아 올린다 (2.0.2 · Z5).
  let zip;
  try { zip = makeZip(entries); } catch (err) { return { error: String(err?.message ?? err) }; }
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, zip);
  return { out: outFile, plugins: included, files: entries.length, skipped, bytes: zip.length, manifest };
}

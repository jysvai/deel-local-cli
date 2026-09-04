// 플러그인 설치·삭제·묶기.
//
// 온라인 기기에서 /plugin install 로 받고, /plugin pack 으로 묶어
// 오프라인 기기에 반입한다. 오프라인에서는 압축만 풀면 그대로 인식된다.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname, basename, resolve, sep } from 'node:path';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, rmSync,
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

export const pluginsDir = (home = homedir()) => join(home, '.deel', 'plugins');

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
  rmSync(dest, { recursive: true, force: true });
  for (const f of files) {
    const p = join(dest, f.name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.data);
  }
  return { 푼것: files.length };
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
  for (const branch of spec.ref ? [spec.ref] : ['main', 'master']) {
    const url = `https://codeload.github.com/${spec.owner}/${spec.repo}/tar.gz/refs/heads/${branch}`;
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
  return { error: '받지 못했습니다 — 저장소 주소나 가지 이름을 확인하세요' };
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
  return 한칸;
}

/**
 * 그 자리가 정말 플러그인 폴더 **안**인가 — 이름을 자른 뒤에도 한 번 더 본다.
 *
 * 자르는 자가 언젠가 틀릴 수 있다. 그때 마지막으로 서는 그물이다. 지우고
 * 쓰는 자리라 두 겹으로 막는다.
 */
export function 플러그인자리인가(base, dest) {
  const 뿌리 = resolve(base);
  const 갈곳 = resolve(dest);
  return 갈곳 !== 뿌리 && 갈곳.startsWith(뿌리 + sep);
}

function manifestOf(dir) {
  const f = join(dir, '.claude-plugin', 'plugin.json');
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
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

export async function install(spec, { home = homedir(), onStep } = {}) {
  const base = pluginsDir(home);

  // 이미 풀어 놓은 폴더를 그대로 넣는 길. 오프라인 기기에서 이쪽을 쓴다.
  const asPath = String(spec).trim().replace(/^["']|["']$/g, '');
  const isLocal = existsSync(asPath) && statSync(asPath).isDirectory();

  const parsed = isLocal ? null : parseSpec(spec);
  if (!isLocal && !parsed) {
    return { error: `주소를 알아볼 수 없습니다: ${spec}\n  예: affaan-m/ECC · https://github.com/affaan-m/ECC · C:\\받은폴더\\ecc` };
  }

  const tmp = join(base, `.tmp-${isLocal ? 'local' : parsed.repo}`);
  let got;
  if (isLocal) {
    onStep?.('폴더 복사');
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(dirname(tmp), { recursive: true });
    copyDir(asPath, tmp);
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

  const counts = countIn(tmp);
  if (!counts.skills && !counts.commands) {
    rmSync(tmp, { recursive: true, force: true });
    return { error: `스킬도 명령도 없습니다. 플러그인이 맞는지 확인하세요 (${isLocal ? asPath : parsed.owner + '/' + parsed.repo})` };
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  copyDir(tmp, dest);
  rmSync(tmp, { recursive: true, force: true });

  // 어디서 왔는지 남긴다 — 나중에 반입 심사에서 출처를 물어본다.
  writeFileSync(join(dest, '.deel-source.json'), JSON.stringify({
    from: isLocal ? asPath : `${parsed.owner}/${parsed.repo}`,
    ref: got.branch ?? parsed?.ref ?? null,
    how: got.how,
    at: new Date().toISOString(),
    license: info?.license ?? null,
  }, null, 2) + '\n', 'utf8');

  return { name, version: info?.version ?? '', license: info?.license ?? null, path: dest, ...counts, how: got.how };
}

export function list({ home = homedir() } = {}) {
  const base = pluginsDir(home);
  if (!existsSync(base)) return [];
  const out = [];
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = join(base, e.name);
    const info = manifestOf(dir);
    let src = null;
    const sf = join(dir, '.deel-source.json');
    if (existsSync(sf)) { try { src = JSON.parse(readFileSync(sf, 'utf8')); } catch {} }
    out.push({
      name: info?.name || e.name,
      version: info?.version ?? '',
      license: info?.license ?? src?.license ?? null,
      from: src?.from ?? '(직접 넣음)',
      path: dir,
      ...countIn(dir),
    });
  }
  return out.sort((a, b) => b.skills - a.skills);
}

export function remove(name, { home = homedir() } = {}) {
  /*
   * 지우는 자리도 이름으로 정해진다. 그러니 여기도 한 칸으로 자른다.
   *
   * 사람이 직접 치는 자리라 안전할 것 같지만, 목록(list)이 보여 주는 이름을
   * 그대로 복사해 붙이는 것이 보통이고 그 이름은 매니페스트에서 온다.
   * 설치 때 막아도 이미 깔려 있던 것에는 못 쓴 이름이 남아 있을 수 있다.
   */
  const base = pluginsDir(home);
  const 한칸 = 이름한칸(name);
  const dir = 한칸 ? join(base, 한칸) : null;
  if (!dir || !플러그인자리인가(base, dir) || !existsSync(dir)) {
    return { error: `설치돼 있지 않습니다: ${name}` };
  }
  rmSync(dir, { recursive: true, force: true });
  return { removed: 한칸 };
}

// 반입용 묶음. 실행 스크립트는 빼고 스킬·명령만 담는다.
const PACK_SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'tests', '__pycache__', '.github']);
const PACK_SKIP_EXT = /\.(js|cjs|mjs|sh|ps1|cmd|bat|py|exe|dll|so|dylib)$/i;

export function pack(outFile, { home = homedir(), only = null } = {}) {
  const base = pluginsDir(home);
  if (!existsSync(base)) return { error: '설치된 플러그인이 없습니다.' };

  const entries = [];
  const included = [];
  let skipped = 0;

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

  const zip = makeZip(entries);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, zip);
  return { out: outFile, plugins: included, files: entries.length, skipped, bytes: zip.length, manifest };
}

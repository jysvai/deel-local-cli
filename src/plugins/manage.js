// 플러그인 설치·삭제·묶기.
//
// 온라인 기기에서 /plugin install 로 받고, /plugin pack 으로 묶어
// 오프라인 기기에 반입한다. 오프라인에서는 압축만 풀면 그대로 인식된다.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, rmSync,
  readdirSync, statSync,
} from 'node:fs';
import { untargz, stripTop } from '../pack/tar.js';
import { makeZip } from '../pack/zip.js';
import { allowTemporarily, isOffline } from '../safety/network.js';
import { 원시요청 } from '../backend/http.js';
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
    let res;
    // 한 문(backend/http.js)으로 나간다 — 프록시를 거치고, 다른 집으로 되돌리면 거기서 막힌다.
    try { res = await 원시요청(url, { timeout: 120000 }); }
    catch { continue; }
    finally { close(); }
    if (!res.ok) continue;
    const gz = res.bytes;
    const files = stripTop(untargz(gz));
    if (!files.length) return { error: '받은 묶음이 비어 있습니다' };
    rmSync(dest, { recursive: true, force: true });
    for (const f of files) {
      const p = join(dest, f.name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.data);
    }
    return { how: 'tarball', branch };
  }
  return { error: '받지 못했습니다 — 저장소 주소나 가지 이름을 확인하세요' };
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
  const name = info?.name || (isLocal ? basename(asPath) : parsed.repo);
  const dest = join(base, name);

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
  const dir = join(pluginsDir(home), name);
  if (!existsSync(dir)) return { error: `설치돼 있지 않습니다: ${name}` };
  rmSync(dir, { recursive: true, force: true });
  return { removed: name };
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

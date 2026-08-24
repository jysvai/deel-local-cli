// 스킬·슬래시명령 찾기.
// deel 는 스킬을 품고 다니지 않는다 — 켜질 때 그 PC 를 훑어 있는 것을 쓴다.
// Claude Code 와 같은 형식을 읽으므로, 그쪽으로 쓰인 것이 그대로 먹는다.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';

// --- YAML 앞머리 읽기 (name, description 만 쓰므로 최소만 구현) -------------
export function frontmatter(text) {
  if (!text.startsWith('---')) return { data: {}, body: text };
  const nl = text.indexOf('\n');
  if (nl < 0) return { data: {}, body: text };
  const end = text.indexOf('\n---', nl);
  if (end < 0) return { data: {}, body: text };

  // CRLF 로 저장된 파일이 많다. \r 를 남겨 두면 정규식의 . 와 $ 가 그걸 줄 끝으로 보고
  // 마지막 줄을 통째로 못 읽는다. 먼저 걷어낸다.
  const head = text.slice(nl + 1, end).replace(/\r/g, '');
  const body = text.slice(text.indexOf('\n', end + 1) + 1);
  const data = {};
  let key = null;
  for (const line of head.split('\n')) {
    if (/^\s/.test(line) && key) {          // 이어지는 줄 (여러 줄 값)
      data[key] = (data[key] ? data[key] + ' ' : '') + line.trim();
      continue;
    }
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) { key = null; continue; }
    key = m[1];
    let v = m[2].trim();
    // YAML 블록 표기( > >- | |- )는 값이 다음 줄부터 온다는 뜻이다. 표시만 지우고 비워 둔다.
    if (/^[|>][-+]?\d*$/.test(v)) v = '';
    else if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    data[key] = v;
  }
  return { data, body };
}

const dirs = (p) => {
  try { return readdirSync(p, { withFileTypes: true }); } catch { return []; }
};

// --- 스킬 한 개 읽기 --------------------------------------------------------
function readSkill(file, source, ns) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return null; }
  const { data } = frontmatter(text);
  const folder = basename(dirname(file));
  const bare = data.name || folder;
  return {
    name: ns ? `${ns}:${bare}` : bare,
    description: (data.description || '').replace(/\s+/g, ' ').slice(0, 300),
    path: file,
    source,
    bytes: text.length,
    enabled: true,
  };
}

// skills/<이름>/SKILL.md 꼴을 한 폴더에서 모은다.
function skillsIn(dir, source, ns, out, cap) {
  for (const e of dirs(dir)) {
    if (out.length >= cap) return;
    if (!e.isDirectory()) continue;
    const f = join(dir, e.name, 'SKILL.md');
    if (!existsSync(f)) continue;
    const s = readSkill(f, source, ns);
    if (s) out.push(s);
  }
}

// commands/*.md 를 모은다.
function commandsIn(dir, source, ns, out, cap) {
  for (const e of dirs(dir)) {
    if (out.length >= cap) return;
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const file = join(dir, e.name);
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    const { data } = frontmatter(text);
    const bare = data.name || basename(e.name, '.md');
    out.push({
      name: ns ? `${ns}:${bare}` : bare,
      description: (data.description || '').replace(/\s+/g, ' ').slice(0, 200),
      path: file,
      source,
      enabled: true,
    });
  }
}

// 플러그인 하나 안에서 스킬·명령이 있을 만한 자리들.
const PLUGIN_SKILL_DIRS = ['skills', join('.agents', 'skills'), join('.claude', 'skills')];
const PLUGIN_CMD_DIRS = ['commands', join('.claude', 'commands'), join('.agents', 'commands')];

function readPlugin(rootDir, skills, commands, caps) {
  const manifest = join(rootDir, '.claude-plugin', 'plugin.json');
  let info = null;
  if (existsSync(manifest)) {
    try { info = JSON.parse(readFileSync(manifest, 'utf8')); } catch {}
  }
  const ns = info?.name || basename(rootDir);
  let found = 0;
  for (const d of PLUGIN_SKILL_DIRS) {
    const before = skills.length;
    skillsIn(join(rootDir, d), 'plugin', ns, skills, caps.skills);
    found += skills.length - before;
  }
  for (const d of PLUGIN_CMD_DIRS) {
    commandsIn(join(rootDir, d), 'plugin', ns, commands, caps.commands);
  }
  return { name: ns, version: info?.version ?? '', license: info?.license ?? '', path: rootDir, skills: found };
}

// 플러그인 폴더를 찾는다. 캐시가 <시장>/<플러그인>/<판>/ 처럼 겹쳐 있어 몇 겹 내려간다.
function findPluginRoots(base, depth = 4) {
  const out = [];
  const stack = [{ dir: base, d: 0 }];
  while (stack.length) {
    const { dir, d } = stack.pop();
    if (d > depth) continue;
    if (existsSync(join(dir, '.claude-plugin', 'plugin.json'))) { out.push(dir); continue; }
    for (const e of dirs(dir)) {
      if (e.isDirectory() && !e.name.startsWith('.')) stack.push({ dir: join(dir, e.name), d: d + 1 });
    }
    if (out.length > 200) break;
  }
  return out;
}

function manifestName(rootDir) {
  const f = join(rootDir, '.claude-plugin', 'plugin.json');
  try { return JSON.parse(readFileSync(f, 'utf8')).name || basename(rootDir); }
  catch { return basename(rootDir); }
}

// 알맹이가 얼마나 있는지 — 같은 이름이 겹쳤을 때 어느 쪽을 쓸지 고르는 기준.
function countSkillDirs(rootDir) {
  let n = 0;
  for (const d of PLUGIN_SKILL_DIRS) {
    for (const e of dirs(join(rootDir, d))) {
      if (e.isDirectory() && existsSync(join(rootDir, d, e.name, 'SKILL.md'))) n++;
    }
  }
  return n;
}

/**
 * 그 PC 에 있는 스킬·명령·플러그인을 전부 찾는다.
 * 뒤에서 찾은 것이 같은 이름을 덮는다: 플러그인 < 사용자 < 프로젝트
 */
export function discover(root, opts = {}) {
  const home = opts.home ?? homedir();
  const caps = { skills: opts.maxSkills ?? 400, commands: opts.maxCommands ?? 400 };
  const skills = [];
  const commands = [];
  const plugins = [];

  // 1) 플러그인
  // 같은 플러그인이 cache/ 와 marketplaces/ 양쪽에 있을 수 있다.
  // 이름이 같으면 알맹이가 더 많은 쪽 하나만 쓴다.
  const roots = [];
  for (const base of [join(home, '.deel', 'plugins'), join(home, '.claude', 'plugins')]) {
    if (existsSync(base)) roots.push(...findPluginRoots(base));
  }
  const best = new Map();
  for (const r of roots) {
    const name = manifestName(r);
    const score = countSkillDirs(r);
    const prev = best.get(name);
    if (!prev || score > prev.score) best.set(name, { root: r, score });
  }
  for (const { root: r } of best.values()) {
    plugins.push(readPlugin(r, skills, commands, caps));
  }
  plugins.sort((a, b) => b.skills - a.skills);

  // 2) 사용자  3) 프로젝트
  for (const [base, source] of [[home, 'user'], [root, 'project']]) {
    for (const cfgDir of ['.deel', '.claude']) {
      skillsIn(join(base, cfgDir, 'skills'), source, null, skills, caps.skills);
      commandsIn(join(base, cfgDir, 'commands'), source, null, commands, caps.commands);
    }
  }

  return { skills: dedupe(skills), commands: dedupe(commands), plugins };
}

// 같은 이름이면 나중 것(더 가까운 자리)이 이긴다.
function dedupe(list) {
  const m = new Map();
  for (const x of list) m.set(x.name, x);
  return [...m.values()];
}

// 스킬 본문 읽기 — 2단계 적재. 너무 길면 자르고 알려준다.
export function loadSkill(skill, { maxChars = 8000 } = {}) {
  let text;
  try { text = readFileSync(skill.path, 'utf8'); } catch (err) { return { error: err.message }; }
  const { body } = frontmatter(text);
  const trimmed = body.trim();
  if (trimmed.length <= maxChars) return { body: trimmed, cut: 0 };
  return {
    body: trimmed.slice(0, maxChars) + `\n\n(뒤쪽 ${trimmed.length - maxChars}자는 잘렸습니다. 같은 폴더의 파일을 Read 로 직접 읽으세요: ${dirname(skill.path)})`,
    cut: trimmed.length - maxChars,
  };
}

// 슬래시 명령 본문 읽기. $ARGUMENTS 를 사용자가 준 말로 바꾼다.
export function loadCommand(cmd, args = '') {
  let text;
  try { text = readFileSync(cmd.path, 'utf8'); } catch (err) { return { error: err.message }; }
  const { body } = frontmatter(text);
  return {
    text: body
      .replace(/\$ARGUMENTS/g, args)
      .replace(/\$(\d)/g, (_, n) => args.split(/\s+/)[Number(n) - 1] ?? ''),
  };
}

// src/ 아래의 **모든 파일**을 종류에 맞는 검사기로 넘긴다.
//
// ── 왜 손으로 이어 붙인 목록을 버렸나 ───────────────────────────────────
//
// 집안 규칙 7 은 「`src/` 의 모든 파일이 `check` 에 들어 있어야 한다」 이다.
// 그 규칙을 지키는 방법이 여태 `package.json` 안에 `node --check` 를 손으로
// 백 몇 개 이어 붙인 한 줄이었다. 두 가지가 새고 있었다.
//
//   1. **자바스크립트가 아닌 파일은 목록에 아예 못 들어간다.**
//      `src/skills/builtin/*/SKILL.md` 일곱 개가 그렇다. 머리말이 깨지거나
//      필수 지시가 빠진 채로 배포돼도 `npm run check` 와 `prepublishOnly`
//      가 둘 다 `OK` 로 끝난다. 규칙을 지키는 척만 한 셈이다.
//   2. 새 파일을 만들고 그 한 줄에 안 적으면 **아무 일도 안 일어난다.**
//      빠뜨린 것을 알려 주는 자가 없다. 목록이 낡는 방식이 이것이다.
//
// 그래서 목록을 **짓지 않고 훑는다.** 새 파일은 자동으로 들어오고, 종류를
// 모르는 파일이 생기면 그 사실 자체를 여기서 말한다.
//
// 검사기는 종류마다 다르다:
//   .js       node --check (구문)
//   .md       머리말(frontmatter)과 빈 파일
//   그 밖      아직 아는 검사기가 없다 — 조용히 넘기지 않고 적는다
//
// 이 파일 자체는 `tools/` 라 이 검사의 대상이 아니다. 대상이 되면 스스로를
// 검사하다 도는 이야기가 된다.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const 뿌리 = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const src = join(뿌리, 'src');

/** src/ 아래 모든 파일. 폴더는 파고든다. */
function 훑기(dir) {
  const out = [];
  for (const 것 of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, 것.name);
    if (것.isDirectory()) out.push(...훑기(p));
    else if (것.isFile()) out.push(p);
  }
  return out;
}

/**
 * `package.json` 의 `files` 가 가리키는 것 전부. 폴더면 파고든다.
 *
 * 목록을 여기 손으로 다시 적지 않는다. 두 곳에 적힌 목록은 반드시 어긋나고,
 * 어긋난 쪽이 어느 쪽인지는 사고가 난 다음에야 알게 된다.
 */
function 담길것들() {
  const { files = [] } = JSON.parse(readFileSync(join(뿌리, 'package.json'), 'utf8'));
  const out = [];
  for (const 것 of files) {
    const p = join(뿌리, 것);
    let s;
    try { s = statSync(p); } catch { continue; }  // 없는 것은 npm 도 그냥 넘긴다
    if (s.isDirectory()) out.push(...훑기(p));
    else out.push(p);
  }
  return out.sort();
}

const 탈 = [];
const 종류별 = new Map();
const 파일들 = [join(뿌리, 'bin', 'deel.js'), ...훑기(src)].sort();

// ── 줄바꿈은 LF 만 담는다 ───────────────────────────────────────────────
//
// 1.13.0 을 손으로 올렸더니 148개 중 **47개에 CRLF 가 섞여** 나갔다.
//
// `.gitattributes` 에 `eol=lf` 를 적어 두었는데도 그랬다. git 은 이미
// 체크아웃해 둔 파일을 그 규칙이 생겼다고 소급해서 고쳐 주지 않는다.
// 규칙이 생기기 전에 `core.autocrlf=true` 로 받아 둔 파일이 디스크에 그대로
// 남아 있었고, `npm pack` 은 git 이 아니라 **작업 트리**를 담는다. 그래서
// 저장소는 멀쩡한데 올라간 물건만 어긋났다.
//
// 두 가지가 걸린다.
//
//   1. 셰뱅이 CRLF 가 되면 리눅스·맥에서 **실행이 아예 안 된다.**
//      `env: 'node\r': No such file or directory`. 1.13.0 은 `bin/deel.js`
//      가 마침 LF 라 살았다 — 고쳐서가 아니라 운이 좋아서 살았다.
//   2. 이 저장소가 파는 문장이 「올라간 물건이 이 소스에서 나왔다」 이다.
//      줄바꿈이 다르면 CI 가 만든 tarball 과 shasum 이 달라진다. 같은
//      커밋에서 나왔는데 물건이 다르면, 그 문장은 절반만 참이다.
//      (실제로 그랬다 — CI 는 af107a1…, 손으로 올린 것은 8705e83…)
//
// 사람이 눈으로 볼 수 있는 차이가 아니다. 그러니 여기서 본다.
const 담길것 = 담길것들();
for (const p of 담길것) {
  const 글 = readFileSync(p);
  const 자리 = 글.indexOf(0x0d);
  if (자리 === -1) continue;
  const 줄번호 = 글.subarray(0, 자리).toString('utf8').split('\n').length;
  const 짧게 = relative(뿌리, p).replace(/\\/g, '/');
  탈.push(`${짧게}:${줄번호}: 줄바꿈이 CRLF 입니다 — 배포에는 LF 만 담깁니다`);
}

for (const p of 파일들) {
  const 짧게 = relative(뿌리, p).replace(/\\/g, '/');
  const ext = extname(p).toLowerCase();
  종류별.set(ext || '(확장자없음)', (종류별.get(ext || '(확장자없음)') ?? 0) + 1);

  if (ext === '.js' || ext === '.mjs') {
    try {
      execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
    } catch (e) {
      탈.push(`${짧게}: ${String(e.stderr ?? e.message).split('\n').slice(0, 3).join(' ').trim()}`);
    }
    continue;
  }

  if (ext === '.md') {
    /*
     * 내장 스킬은 **머리말이 전부**다. `name` 과 `description` 이 없으면
     * 그 스킬은 목록에 안 뜨고, 안 뜨는 것과 없는 것은 구별이 안 된다.
     * 그러니 배포 전에 여기서 잡는다.
     */
    const 글 = readFileSync(p, 'utf8');
    if (!글.trim()) { 탈.push(`${짧게}: 빈 파일입니다`); continue; }
    if (/[/\\]SKILL\.md$/i.test(p)) {
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(글);
      if (!m) { 탈.push(`${짧게}: 머리말(---)이 없습니다`); continue; }
      for (const 칸 of ['name', 'description']) {
        if (!new RegExp(`^${칸}\\s*:\\s*\\S`, 'm').test(m[1])) {
          탈.push(`${짧게}: 머리말에 ${칸} 이 없습니다`);
        }
      }
    }
    if (글.includes('�')) 탈.push(`${짧게}: 글자가 깨져 있습니다 (U+FFFD)`);
    continue;
  }

  if (ext === '.json') {
    try { JSON.parse(readFileSync(p, 'utf8')); }
    catch (e) { 탈.push(`${짧게}: JSON 이 아닙니다 — ${e.message}`); }
    continue;
  }

  // 아는 검사기가 없다. 조용히 넘기면 목록이 또 낡는다.
  탈.push(`${짧게}: 이 종류(${ext || '확장자 없음'})를 검사할 줄 모릅니다 — tools/check-src.mjs 에 한 갈래를 더하세요`);
}

const 줄 = [...종류별.entries()].sort().map(([k, v]) => `${k} ${v}개`).join(' · ');
if (탈.length) {
  console.error(`검사 못 지나감 (${파일들.length}개 중 ${탈.length}개)\n`);
  for (const t of 탈) console.error(`  · ${t}`);
  process.exit(1);
}
console.log(`OK  ${파일들.length}개 파일 — ${줄}`);
console.log(`    배포에 담기는 ${담길것.length}개는 줄바꿈이 전부 LF`);

// 플러그인 받기·묶기 검증.
//
// 핵심은 '내가 만든 걸 내가 읽어서 맞다' 가 아니다.
// tar 는 진짜 tar 가 만든 걸 읽히고, zip 은 진짜 unzip 으로 열어 본다.
// 사내 PC 에서 압축을 푸는 건 내 코드가 아니라 윈도우 탐색기이기 때문이다.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { untargz, stripTop } from '../src/pack/tar.js';
import { makeZip, crc32 } from '../src/pack/zip.js';
import { parseSpec, install, list, remove, pack, pluginsDir } from '../src/plugins/manage.js';
import { discover } from '../src/skills/discover.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const sand = mkdtempSync(join(tmpdir(), 'deel-plug-'));
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

// ── 1. 주소 해석 ────────────────────────────────────────────────────────
check('owner/repo', parseSpec('affaan-m/ECC')?.url === 'https://github.com/affaan-m/ECC.git');
check('전체 URL', parseSpec('https://github.com/a/b')?.repo === 'b');
check('.git 꼬리 제거', parseSpec('https://github.com/a/b.git')?.repo === 'b');
check('#가지 지정', parseSpec('a/b#dev')?.ref === 'dev');
check('엉뚱한 값 거절', parseSpec('그냥말') === null);

// ── 2. TAR 읽기 — 진짜 tar 가 만든 묶음을 읽는다 ────────────────────────
const src = join(sand, 'tarsrc');
const 긴경로 = '아주/깊은/폴더/구조/를/만들어/이름/길이/백자/넘기기/위한/경로';
mkdirSync(join(src, 긴경로), { recursive: true });
mkdirSync(join(src, 'skills', '품의서작성'), { recursive: true });
writeFileSync(join(src, 'skills', '품의서작성', 'SKILL.md'), '---\nname: 품의서작성\n---\n한글 본문\n', 'utf8');
writeFileSync(join(src, 긴경로, '깊은파일.txt'), '깊은 곳의 내용', 'utf8');
const 이진 = Buffer.from([0, 1, 2, 255, 254, 0, 77]);
writeFileSync(join(src, 'binary.bin'), 이진);

// 윈도우 GNU tar 는 'C:\...' 를 원격 호스트로 오해한다 ("Cannot connect to C:").
// 그래서 결과 파일 이름은 상대 경로로 주고, 작업 폴더를 옮겨서 부른다.
let tarOk = true;
try {
  sh('tar', ['-czf', 'real.tar.gz', '-C', 'tarsrc', '.'], { cwd: sand });
} catch (err) { tarOk = false; check('tar 로 묶기', false, String(err.message).split('\n')[0].slice(0, 70)); }

if (tarOk) {
  const files = untargz(readFileSync(join(sand, 'real.tar.gz')));
  const byName = new Map(files.map((f) => [f.name.replace(/^[.][/]/, ''), f.data]));
  check('진짜 tar 가 만든 묶음을 읽음', files.length >= 3, `파일 ${files.length}개`);
  check('한글 경로 살아남음',
    byName.get('skills/품의서작성/SKILL.md')?.toString('utf8').includes('품의서작성'));
  check('100자 넘는 긴 경로 (GNU/pax 확장)',
    byName.get(긴경로 + '/깊은파일.txt')?.toString('utf8') === '깊은 곳의 내용',
    [...byName.keys()].find((k) => k.includes('깊은파일')) ?? '못 찾음');
  const bin = byName.get('binary.bin');
  check('이진 파일 한 바이트도 안 틀림', bin != null && Buffer.compare(bin, 이진) === 0);
}

// GitHub tarball 은 <저장소>-<커밋>/ 한 겹이 더 있다
const 벗김 = stripTop([
  { name: 'ECC-a1b2c3/README.md', data: Buffer.alloc(0) },
  { name: 'ECC-a1b2c3/skills/x/SKILL.md', data: Buffer.alloc(0) },
]);
check('GitHub 최상위 폴더 벗김', 벗김[0].name === 'README.md' && 벗김[1].name === 'skills/x/SKILL.md');
const 안벗김 = stripTop([
  { name: 'a/1.md', data: Buffer.alloc(0) },
  { name: 'b/2.md', data: Buffer.alloc(0) },
]);
check('최상위가 여럿이면 안 벗김', 안벗김[0].name === 'a/1.md');

// ── 3. ZIP 쓰기 — 진짜 unzip 으로 열어 본다 ─────────────────────────────
const 큰내용 = Buffer.from('되풀이되는 글자'.repeat(500), 'utf8');            // 압축이 먹는 것
const 랜덤 = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256)); // 압축이 안 먹는 것
const zipBuf = makeZip([
  { name: '사용안내.txt', data: Buffer.from('한글 파일 이름 시험\n', 'utf8') },
  { name: 'sabun/skills/품의서/SKILL.md', data: 큰내용 },
  { name: 'tiny.bin', data: 랜덤 },
]);
const zipPath = join(sand, 'out.zip');
writeFileSync(zipPath, zipBuf);

let unzipOk = true;
let 목록 = '';
try { 목록 = sh('unzip', ['-l', zipPath]).toString('utf8'); }
catch (err) { unzipOk = false; check('unzip 으로 열림', false, String(err.message).slice(0, 60)); }

if (unzipOk) {
  check('진짜 unzip 이 목록을 읽음', /3 files/.test(목록), 목록.trim().split('\n').pop()?.trim());
  check('한글 파일 이름 그대로 (UTF-8 플래그)', 목록.includes('사용안내.txt'));
  check('한글 폴더 경로도 그대로', 목록.includes('품의서'));

  const 꺼냄 = join(sand, 'unzipped');
  sh('unzip', ['-qq', '-o', zipPath, '-d', 꺼냄]);
  check('압축된 파일 내용 일치',
    Buffer.compare(readFileSync(join(꺼냄, 'sabun', 'skills', '품의서', 'SKILL.md')), 큰내용) === 0);
  check('압축 안 먹는 파일도 일치',
    Buffer.compare(readFileSync(join(꺼냄, 'tiny.bin')), 랜덤) === 0);
  check('압축이 실제로 줄임', zipBuf.length < 큰내용.length,
    `원본 ${큰내용.length}B → zip 전체 ${zipBuf.length}B`);
}
check('CRC32 표준값 (0xCBF43926)', crc32(Buffer.from('123456789')) === 0xcbf43926,
  '0x' + crc32(Buffer.from('123456789')).toString(16));

// ── 4. 폴더에서 설치 (오프라인 기기의 길) ───────────────────────────────
const home = join(sand, 'home');
const 받은폴더 = join(sand, '받은플러그인');
mkdirSync(join(받은폴더, '.claude-plugin'), { recursive: true });
writeFileSync(join(받은폴더, '.claude-plugin', 'plugin.json'),
  JSON.stringify({ name: 'sabun-kit', version: '2.1.0', license: 'MIT' }), 'utf8');
for (const n of ['품의서', '주간보고']) {
  mkdirSync(join(받은폴더, 'skills', n), { recursive: true });
  writeFileSync(join(받은폴더, 'skills', n, 'SKILL.md'),
    `---\nname: ${n}\ndescription: ${n} 쓰기\n---\n본문\n`, 'utf8');
}
mkdirSync(join(받은폴더, 'commands'), { recursive: true });
writeFileSync(join(받은폴더, 'commands', '결재.md'), '결재 올려줘: $ARGUMENTS\n', 'utf8');
writeFileSync(join(받은폴더, 'hook.js'), 'console.log("실행 스크립트")\n', 'utf8');

const 설치 = await install(받은폴더, { home });
check('폴더에서 설치됨', !설치.error, 설치.error ?? '');
check('manifest 이름을 씀', 설치.name === 'sabun-kit', String(설치.name));
check('스킬 2개 셈', 설치.skills === 2, String(설치.skills));
check('명령 1개 셈', 설치.commands === 1, String(설치.commands));
check('설치 자리 맞음', 설치.path === join(pluginsDir(home), 'sabun-kit'));
if (설치.path) {
  const 출처 = JSON.parse(readFileSync(join(설치.path, '.deel-source.json'), 'utf8'));
  check('출처를 남김 (반입 심사용)', 출처.from === 받은폴더 && 출처.license === 'MIT');
}

const 빈폴더 = join(sand, '빈것');
mkdirSync(join(빈폴더, 'docs'), { recursive: true });
writeFileSync(join(빈폴더, 'docs', 'a.md'), 'x', 'utf8');
check('스킬 없는 폴더는 거절', !!(await install(빈폴더, { home })).error);
check('엉뚱한 주소도 거절', !!(await install('말도안되는값!!', { home })).error);

const 목록2 = list({ home });
check('목록에 뜸', 목록2.length === 1 && 목록2[0].name === 'sabun-kit');
check('목록에 라이선스 표시', 목록2[0].license === 'MIT');

// ── 5. 반입 묶음 ────────────────────────────────────────────────────────
const 반입 = join(sand, '반입.zip');
const 묶음 = pack(반입, { home });
check('반입 묶음 만들어짐', !묶음.error && existsSync(반입), 묶음.error ?? '');
check('실행 스크립트는 뺌', 묶음.skipped >= 1, `${묶음.skipped}개 제외`);

if (!묶음.error && unzipOk) {
  const 푼곳 = join(sand, '반입푼것');
  sh('unzip', ['-qq', '-o', 반입, '-d', 푼곳]);
  check('안내문이 같이 들어감', existsSync(join(푼곳, '사용안내.txt')));
  check('스킬이 들어감', existsSync(join(푼곳, 'sabun-kit', 'skills', '품의서', 'SKILL.md')));
  check('hook.js 는 안 들어감', !existsSync(join(푼곳, 'sabun-kit', 'hook.js')));
  const 안내 = readFileSync(join(푼곳, '사용안내.txt'), 'utf8');
  check('안내문에 라이선스가 적힘', 안내.includes('MIT') && 안내.includes('sabun-kit'));

  // 푼 그대로 다른 PC 의 ~/.deel/plugins 가 되는가 — 이게 반입의 최종 관문
  const 새PC = join(sand, '새PC');
  mkdirSync(join(새PC, '.deel'), { recursive: true });
  cpSync(푼곳, join(새PC, '.deel', 'plugins'), { recursive: true });
  rmSync(join(새PC, '.deel', 'plugins', '사용안내.txt'), { force: true });
  const 새PC결과 = discover(join(새PC, 'proj'), { home: 새PC });
  check('오프라인 PC 가 그대로 인식',
    새PC결과.skills.length === 2 && 새PC결과.commands.length === 1,
    `스킬 ${새PC결과.skills.length}개 · 명령 ${새PC결과.commands.length}개`);
}

// ── 6. 삭제 ─────────────────────────────────────────────────────────────
check('없는 것 삭제하면 오류', !!remove('없는놈', { home }).error);
check('삭제됨', remove('sabun-kit', { home }).removed === 'sabun-kit');
check('삭제 뒤 목록 빔', list({ home }).length === 0);

rmSync(sand, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n플러그인 받기·묶기 검사  ' + D + '(zip 은 진짜 unzip, tar 는 진짜 tar 로 교차 확인)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exit(fail.length ? 1 : 0);

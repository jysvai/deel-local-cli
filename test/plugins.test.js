// 플러그인 받기·묶기 검증.
//
// 핵심은 '내가 만든 걸 내가 읽어서 맞다' 가 아니다.
// tar 는 진짜 tar 가 만든 걸 읽히고, zip 은 진짜 unzip 으로 열어 본다.
// 사내 PC 에서 압축을 푸는 건 내 코드가 아니라 윈도우 탐색기이기 때문이다.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { untargz, stripTop, 안쪽인가, 밖을가리키는것 } from '../src/pack/tar.js';
import { makeZip, crc32 } from '../src/pack/zip.js';
import { parseSpec, install, list, remove, pack, pluginsDir, 묶음풀기 } from '../src/plugins/manage.js';
import { discover } from '../src/skills/discover.js';
import { TOOLS } from '../src/tools/index.js';
import { copyDir } from '../src/tools/fsutil.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const sand = mkdtempSync(join(tmpdir(), 'deel-plug-'));
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

// ── 바깥 도구가 없을 때 ─────────────────────────────────────────────────
// 없는 도구는 실패가 아니라 '못 잰 것' 이다. 둘을 섞으면 두 번 손해다.
// 실제로 겪었다: npm 이 prepublishOnly 로 이 검사를 cmd 에서 돌렸는데 그 PATH 에는
// unzip 이 없다(Git Bash 에만 있다). ENOENT 가 실패 1건으로 잡히고 unzip 에 매달린
// 11건은 조용히 사라져 27/1 이 됐다 — 발행이 막혔고, 사라진 11건은 아무도 몰랐다.
// 그래서 (1) 없는 것은 건너뛰되 (2) 건너뛴 것을 반드시 화면에 남기고
// (3) 윈도우에서는 늘 있는 .NET zip 으로 대신 연다.
const 윈도우 = process.platform === 'win32';
const 건너뜀 = [];
const 없어서 = (err) => err.code === 'ENOENT';

// 윈도우 PowerShell 로 한 줄 실행. 한글 이름이 콘솔 코드페이지(949)로 나가면 깨지므로
// 나가는 인코딩을 UTF-8 로 못 박는다.
const ps = (본문) => sh('powershell', ['-NoProfile', '-NonInteractive', '-Command',
  '$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8;'
  + "[void][Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem');" + 본문,
]).toString('utf8');

// zip 을 '내가 만든 것이 아닌 것' 으로 연다. 1순위 unzip, 없으면 .NET ZipFile.
// .NET 쪽이 대타로 못한 것도 아니다 — 사내 PC 에서 실제로 압축을 푸는 건 탐색기이고
// 탐색기가 쓰는 게 이 구현이다. 이름 목록을 돌려주고, 둘 다 없으면 null.
function zip열개(zipPath) {
  try {
    const 글 = sh('unzip', ['-l', zipPath]).toString('utf8');
    // unzip -l 의 표: `  길이  날짜  시각  이름`. 꼬리의 '3 files' 줄은 칸이 모자라 안 걸린다.
    const 이름 = 글.split('\n')
      .map((l) => l.match(/^\s*\d+\s+\S+\s+\S+\s+(.+)$/)?.[1]?.trim()).filter(Boolean);
    return { 도구: 'unzip', 이름, 풀기: (z, 대상) => void sh('unzip', ['-qq', '-o', z, '-d', 대상]) };
  } catch (err) { if (!없어서(err)) throw err; }

  if (윈도우) {
    try {
      const 글 = ps(`$z=[IO.Compression.ZipFile]::OpenRead('${zipPath}');`
        + '$z.Entries|%{$_.FullName};$z.Dispose()');
      return {
        도구: '.NET ZipFile(탐색기와 같은 것)',
        이름: 글.split('\n').map((l) => l.trim()).filter(Boolean),
        풀기: (z, 대상) => void ps(`[IO.Compression.ZipFile]::ExtractToDirectory('${z}','${대상}')`),
      };
    } catch (err) { if (!없어서(err)) throw err; }
  }
  return null;
}

trace('1-주소해석');
// ── 1. 주소 해석 ────────────────────────────────────────────────────────
check('owner/repo', parseSpec('affaan-m/ECC')?.url === 'https://github.com/affaan-m/ECC.git');
check('전체 URL', parseSpec('https://github.com/a/b')?.repo === 'b');
check('.git 꼬리 제거', parseSpec('https://github.com/a/b.git')?.repo === 'b');
check('#가지 지정', parseSpec('a/b#dev')?.ref === 'dev');
check('엉뚱한 값 거절', parseSpec('그냥말') === null);

trace('2-TAR읽기');
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
} catch (err) {
  tarOk = false;
  // tar 자체가 없는 것과, tar 가 돌았는데 우리 묶음을 뱉은 것은 전혀 다른 얘기다.
  if (없어서(err)) 건너뜀.push('tar 가 없어 TAR 교차확인 4건을 못 쟀다');
  else check('tar 로 묶기', false, String(err.message).split('\n')[0].slice(0, 70));
}

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

/*
 * ── ★ 묶음 안의 이름은 남이 적은 글자다 ────────────────────────────────
 *
 * tar 이름을 그대로 join(dest, name) 에 넣으면 `../../../..` 하나로 플러그인
 * 폴더 밖에 파일을 쓴다. 받는 쪽이 mkdirSync(recursive) 까지 해 주므로 없는
 * 폴더도 만들어 가며 나간다. 이 프로그램이 파는 문장이 「작업 폴더 밖은 안
 * 만진다」 인데, 플러그인을 받는 길에만 그 문장을 지키는 코드가 없었다.
 *
 * 검사가 못 잡은 까닭도 분명하다 — 지금까지 **멀쩡한 tar** 로만 쟀다.
 * 남이 노리고 만든 묶음을 한 번도 안 먹여 봤다.
 */
{
  const 뿌리 = join(sand, '플러그인집', '어떤것');
  const 나쁜이름 = [
    '../../../../윗동네에쓰기.txt',
    '..\\..\\윈도우식.txt',
    'a/../../밖으로.txt',
    '/절대경로.txt',
    process.platform === 'win32' ? 'C:\\Windows\\Temp\\드라이브.txt' : '/etc/passwd',
  ];
  for (const 이름 of 나쁜이름) {
    check(`★ 밖을 가리키는 이름을 막는다 — ${이름}`, 안쪽인가(뿌리, 이름) === false,
      resolve(뿌리, 이름.replace(/\\/g, '/')));
  }
  const 착한이름 = ['README.md', 'skills/품의서작성/SKILL.md', './a/b.txt', '깊은/폴더/파일.txt'];
  for (const 이름 of 착한이름) {
    check(`안쪽 이름은 그대로 통과 — ${이름}`, 안쪽인가(뿌리, 이름) === true);
  }

  // 하나라도 밖을 가리키면 **묶음째** 걸러진다 — 나머지를 풀어 줄 까닭이 없다.
  const 섞인묶음 = [
    { name: 'README.md', data: Buffer.alloc(0) },
    { name: '../../../../몰래.txt', data: Buffer.alloc(0) },
    { name: 'skills/x/SKILL.md', data: Buffer.alloc(0) },
  ];
  const 걸린것 = 밖을가리키는것(뿌리, 섞인묶음);
  check('★ 섞여 있으면 그 이름을 짚어 준다', 걸린것.length === 1 && 걸린것[0].name === '../../../../몰래.txt',
    걸린것.map((f) => f.name).join(' · '));
  check('멀쩡한 묶음은 하나도 안 걸린다',
    밖을가리키는것(뿌리, [{ name: 'a.md' }, { name: 'b/c.md' }]).length === 0);

  /*
   * ★ 그리고 **진짜로 푸는 자리**를 지난다.
   *
   * 위 두 검사는 판단 함수만 잰다. 그 판단이 정작 파일을 쓰는 자리에 안 물려
   * 있으면 아무 소용이 없다 — 이 저장소에서 이미 두 번 그랬다(끊긴 뒤 결과
   * 판단, 파일 기억 버리기). 그래서 여기서는 디스크를 본다.
   */
  const 풀곳 = join(sand, '푸는자리', '어떤것');
  const 밖경로 = join(sand, '푸는자리', '몰래.txt');

  const 나쁜결과 = 묶음풀기(풀곳, [
    { name: 'README.md', data: Buffer.from('착한 것') },
    { name: '../몰래.txt', data: Buffer.from('밖으로 나갔다') },
  ]);
  check('★ 밖을 가리키는 묶음은 아예 안 푼다', !!나쁜결과.error, 나쁜결과.error ?? '(그냥 풀었다)');
  check('★ 그 파일이 진짜로 안 생겼다', !existsSync(밖경로), 밖경로);
  // 착한 파일까지 안 푼다 — 노린 묶음의 나머지를 깔아 줄 까닭이 없다.
  check('★ 같은 묶음의 나머지도 안 푼다', !existsSync(join(풀곳, 'README.md')));

  const 착한결과 = 묶음풀기(풀곳, [
    { name: 'README.md', data: Buffer.from('착한 것') },
    { name: 'skills/품의서/SKILL.md', data: Buffer.from('본문') },
  ]);
  check('멀쩡한 묶음은 그대로 풀린다',
    !착한결과.error && readFileSync(join(풀곳, 'skills', '품의서', 'SKILL.md'), 'utf8') === '본문',
    착한결과.error ?? `${착한결과.푼것}개`);
}

trace('3-ZIP쓰기');
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

const 열개 = zip열개(zipPath);
if (!열개) 건너뜀.push('unzip 도 .NET ZipFile 도 없어 ZIP 교차확인 11건을 못 쟀다');

if (열개) {
  const { 도구, 이름 } = 열개;
  check(`${도구} 가 목록을 읽음`, 이름.length === 3, `${이름.length}개: ${이름.join(', ')}`);
  check('한글 파일 이름 그대로 (UTF-8 플래그)', 이름.includes('사용안내.txt'));
  check('한글 폴더 경로도 그대로', 이름.some((n) => n.includes('품의서')));

  const 꺼냄 = join(sand, 'unzipped');
  열개.풀기(zipPath, 꺼냄);
  check('압축된 파일 내용 일치',
    Buffer.compare(readFileSync(join(꺼냄, 'sabun', 'skills', '품의서', 'SKILL.md')), 큰내용) === 0);
  check('압축 안 먹는 파일도 일치',
    Buffer.compare(readFileSync(join(꺼냄, 'tiny.bin')), 랜덤) === 0);
  check('압축이 실제로 줄임', zipBuf.length < 큰내용.length,
    `원본 ${큰내용.length}B → zip 전체 ${zipBuf.length}B`);
}
check('CRC32 표준값 (0xCBF43926)', crc32(Buffer.from('123456789')) === 0xcbf43926,
  '0x' + crc32(Buffer.from('123456789')).toString(16));

trace('4-폴더설치');
// ── 4. 폴더에서 설치 (오프라인 기기의 길) ───────────────────────────────
const home = join(sand, 'home');
const 받은폴더 = join(sand, '받은플러그인');
mkdirSync(join(받은폴더, '.claude-plugin'), { recursive: true });
writeFileSync(join(받은폴더, '.claude-plugin', 'plugin.json'),
  JSON.stringify({ name: 'sabun-kit', version: '2.1.0', license: 'MIT' }), 'utf8');
for (const n of ['품의서', '주간보고']) {
  mkdirSync(join(받은폴더, 'skills', n), { recursive: true });
  writeFileSync(join(받은폴더, 'skills', n, 'SKILL.md'),
    `---\nname: ${n}\ndescription: ${n} 쓰기\n---\n본문: ${n} 는 이렇게 쓴다.\n결재선은 팀장 다음 부서장.\n`, 'utf8');
}
mkdirSync(join(받은폴더, 'commands'), { recursive: true });
writeFileSync(join(받은폴더, 'commands', '결재.md'), '결재 올려줘: $ARGUMENTS\n', 'utf8');
writeFileSync(join(받은폴더, 'hook.js'), 'console.log("실행 스크립트")\n', 'utf8');

trace('4a-install직전');
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
trace('4b-빈폴더install직전');
check('스킬 없는 폴더는 거절', !!(await install(빈폴더, { home })).error);
trace('4c-엉뚱주소직전');
check('엉뚱한 주소도 거절', !!(await install('말도안되는값!!', { home })).error);

trace('4d-list직전');
const 목록2 = list({ home });
check('목록에 뜸', 목록2.length === 1 && 목록2[0].name === 'sabun-kit');
check('목록에 라이선스 표시', 목록2[0].license === 'MIT');

trace('5-반입묶음');
// ── 5. 반입 묶음 ────────────────────────────────────────────────────────
const 반입 = join(sand, '반입.zip');
const 묶음 = pack(반입, { home });
check('반입 묶음 만들어짐', !묶음.error && existsSync(반입), 묶음.error ?? '');
check('실행 스크립트는 뺌', 묶음.skipped >= 1, `${묶음.skipped}개 제외`);

if (!묶음.error && 열개) {
  const 푼곳 = join(sand, '반입푼것');
  열개.풀기(반입, 푼곳);
  check('안내문이 같이 들어감', existsSync(join(푼곳, '사용안내.txt')));
  check('스킬이 들어감', existsSync(join(푼곳, 'sabun-kit', 'skills', '품의서', 'SKILL.md')));
  check('hook.js 는 안 들어감', !existsSync(join(푼곳, 'sabun-kit', 'hook.js')));
  const 안내 = readFileSync(join(푼곳, '사용안내.txt'), 'utf8');
  check('안내문에 라이선스가 적힘', 안내.includes('MIT') && 안내.includes('sabun-kit'));

  // 푼 그대로 다른 PC 의 ~/.deel/plugins 가 되는가 — 이게 반입의 최종 관문
  const 새PC = join(sand, '새PC');
  mkdirSync(join(새PC, '.deel'), { recursive: true });
  copyDir(푼곳, join(새PC, '.deel', 'plugins'));
  rmSync(join(새PC, '.deel', 'plugins', '사용안내.txt'), { force: true });
  // 내장(품고 다니는 방법론)은 빼고 센다. 여기서 재려는 것은 **반입한 묶음이
  // 그대로 살아났는가** 지 deel 이 무엇을 품고 다니는가가 아니다.
  // 안 빼면 방법론을 하나 더할 때마다 이 검사가 엉뚱하게 빨개진다.
  const 새PC결과 = discover(join(새PC, 'proj'), { home: 새PC, 내장: false });
  check('오프라인 PC 가 그대로 인식',
    새PC결과.skills.length === 2 && 새PC결과.commands.length === 1,
    `스킬 ${새PC결과.skills.length}개 · 명령 ${새PC결과.commands.length}개`);
  // 그래도 내장은 같이 보여야 한다 — 반입한 것이 그것을 밀어내면 안 된다.
  // 개수를 못 박지 않는다. 방법론을 하나 더할 때마다 여기가 엉뚱하게 빨개진다.
  /*
   * ── ★ 그리고 **펼쳐 읽는 데까지** 가 본다 ────────────────────────────
   *
   * 스킬은 두 단으로 실린다. 목록에는 이름과 설명만 올라가고, 모델이 필요한
   * 것을 골라 Skill 도구로 본문을 받는다. 그 둘째 단이 이 기능의 전부다.
   *
   * 찾는 것(discover)은 여러 검사가 재고 도구 목록에 Skill 이 뜨는지도 쟀는데,
   * **본문을 실제로 받아 오는 길은 저장소 어디에서도 한 번도 안 불렸다.**
   * loadSkill 이 늘 오류를 돌려주게 만들어도 전체 검사가 초록이었다 —
   * 판에 넣어 내보내는 기능 하나가 통째로 안 돌아 본 셈이다.
   */
  const 펼칠판 = { skills: 새PC결과.skills, loadedSkills: new Set() };
  const 첫스킬 = 새PC결과.skills[0];
  const 펼친것 = TOOLS.Skill.run({ name: 첫스킬.name }, 펼칠판);
  check('★ 스킬 본문이 실제로 실린다', !펼친것.error && (펼친것.content ?? '').length > 20,
    펼친것.error ?? (펼친것.content ?? '').slice(0, 60).replace(/\n/g, ' '));
  check('★ 어느 스킬인지 머리에 적는다', /^# 스킬: /.test(펼친것.content ?? ''),
    (펼친것.content ?? '').split('\n')[0]);
  check('★ 앞머리(frontmatter)는 안 싣는다', !/^---/m.test(펼친것.content ?? ''),
    (펼친것.content ?? '').slice(0, 40).replace(/\n/g, ' '));
  check('★ 무엇을 펼쳤는지 기록한다', 펼칠판.loadedSkills.has(첫스킬.name),
    [...펼칠판.loadedSkills].join(', '));

  // 상한에 걸리면 잘랐다고 말한다 — 조용히 자르면 모델이 뒤쪽을 봤다고 여긴다.
  const 자른것 = TOOLS.Skill.run({ name: 첫스킬.name }, { ...펼칠판, maxSkillChars: 20 });
  check('★ 잘렸으면 잘렸다고 말하고 어디서 읽을지 알려 준다',
    /잘렸습니다/.test(자른것.content ?? '') && /Read/.test(자른것.content ?? ''),
    (자른것.content ?? '').split('\n').pop());

  // 없는 이름은 비슷한 것을 짚어 준다. 그냥 '없다' 로 끝내면 모델이 헤맨다.
  const 없는것 = TOOLS.Skill.run({ name: '없는스킬이름' }, 펼칠판);
  check('없는 이름은 오류로 돌려준다', !!없는것.error, 없는것.error ?? '(그냥 폈다)');
  const 꼬리로 = TOOLS.Skill.run({ name: 첫스킬.name.split(':').pop() }, 펼칠판);
  check('이름 꼬리만 줘도 찾아 준다', !꼬리로.error, 꼬리로.error ?? '');

  const 같이 = discover(join(새PC, 'proj'), { home: 새PC });
  const 반입이름 = 새PC결과.skills.map((s) => s.name);
  check('반입한 것과 내 방법론이 같이 뜬다',
    반입이름.every((n) => 같이.skills.some((s) => s.name === n))
    && 같이.skills.some((s) => s.source === 'builtin'),
    `${같이.skills.length}개 (반입 ${반입이름.join(', ')} + 내장)`);
}

trace('6-삭제');
// ── 6. 삭제 ─────────────────────────────────────────────────────────────
check('없는 것 삭제하면 오류', !!remove('없는놈', { home }).error);
check('삭제됨', remove('sabun-kit', { home }).removed === 'sabun-kit');
check('삭제 뒤 목록 빔', list({ home }).length === 0);

rmSync(sand, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
const Y = '\x1b[33m';
console.log('\n플러그인 받기·묶기 검사  ' + D + '(내가 만든 묶음을 바깥 도구로 열어 교차 확인)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
// 건너뛴 것을 조용히 넘기지 않는다. 안 보이면 '다 통과' 로 읽힌다.
for (const s of 건너뜀) console.log(`  ${Y}⚠${X} ${s}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패`
  + (건너뜀.length ? ` · ${Y}${건너뜀.length}건 못 쟀음${X}` : '') + '\n');
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

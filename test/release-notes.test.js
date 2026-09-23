/**
 * GitHub 릴리스가 npm 보다 **앞서지 않는가.**
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 *
 * 2.0.2 는 GitHub 에 「Latest」 로 떠 있는데 npm 에는 없었다. 태그를 민 직후
 * 손으로 릴리스를 만들었고, 발행 워크플로의 검사가 리눅스에서 빨개져 npm
 * 발행은 멈췄다. 두 곳이 서로 다른 판을 「최신」 이라고 말했다.
 *
 * 이제 릴리스는 publish.yml 의 release job 이 npm 에 올린 **뒤에** 만든다.
 * 여기서는 두 가지를 잰다.
 *
 *   1. 순서 — release 가 publish 를 기다리고, 쓰기 열쇠는 release 에만 있다
 *   2. 본문 — 노트에서 그 판만 정확히 잘라 내고, 링크가 릴리스 화면에서 안 끊긴다
 *
 * 2 는 **지금 판의 진짜 노트로도** 잰다. 노트에 제목 줄이 빠졌다는 것을 npm 에
 * 이미 올라간 뒤에 알면, 그때는 릴리스 없이 npm 판만 남는다. 푸시마다 도는
 * 여기서 먼저 빨개져야 한다.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { trace } from './trace.mjs';
import { 절뽑기, 링크풀기, 저장소주소, 최신깃발, 릴리스글 } from '../tools/release-notes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const 판 = pkg.version;

// ── 1. 순서 ─────────────────────────────────────────────────────────────
trace('1-순서');
{
  const 글 = readFileSync(join(repo, '.github', 'workflows', 'publish.yml'), 'utf8').replace(/\r/g, '');
  // job 은 두 칸 들여 쓴 `이름:` 줄에서 갈린다. 주석 줄은 빼고 본다 — 머리말에
  // 「gh release」 를 적어 두었다고 그 job 이 릴리스를 만드는 것은 아니다.
  const job = new Map();
  for (const 덩이 of 글.split(/\n(?= {2}[A-Za-z][\w-]*:\n)/)) {
    const 이름 = /^ {2}([A-Za-z][\w-]*):\n/.exec(덩이)?.[1];
    if (이름) job.set(이름, 덩이.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'));
  }
  const 발행 = job.get('publish') ?? '';
  const 릴리스 = job.get('release') ?? '';

  check('★★ publish.yml 에 publish · release 두 job 이 있다', !!발행 && !!릴리스, [...job.keys()].join(', '));
  check('★★★ release 가 publish 를 기다린다 (npm 에 올라간 뒤에만 릴리스)',
    /^ {4}needs: *\[?\s*publish\s*\]?\s*$/m.test(릴리스), /needs:.*/.exec(릴리스)?.[0] ?? '(needs 없음)');
  check('★★ publish job 은 릴리스를 안 만든다', !/gh release/.test(발행));
  check('★★ release job 이 릴리스를 만든다', /gh release create/.test(릴리스));
  check('★★ 쓰기 열쇠는 release 에만 있다 — 검사를 돌리는 publish 는 읽기만',
    /contents: *read/.test(발행) && !/contents: *write/.test(발행) && /contents: *write/.test(릴리스));
  check('★ release 의 checkout 이 열쇠를 안 남긴다', /persist-credentials: *false/.test(릴리스));
  check('★ 태그가 없으면 만들지 않는다 (--verify-tag)', /--verify-tag/.test(릴리스));
  check('★★ Latest 판정은 도구가 한다 (아래 5 에서 직접 부른다)',
    /latest=\$\(node tools\/release-notes\.mjs "\$ver" --latest-flag "\$cur"\)/.test(릴리스) && /"\$latest"/.test(릴리스));
  check('★★ 지금 Latest 를 묻다 난 오류를 「릴리스 없음」 으로 삼키지 않는다',
    !/gh release view --json[^\n]*(2>\/dev\/null|\|\| *true)/.test(릴리스) && /release not found/.test(릴리스) && /exit 1/.test(릴리스));
  check('★★ 본문은 저장소 안의 도구로 뽑는다', /node tools\/release-notes\.mjs/.test(릴리스));
}

// ── 2. 본문 ─────────────────────────────────────────────────────────────
trace('2-절뽑기');
{
  const 글 = [
    '# 2.0 줄기',
    '',
    '## 2.0.3',
    '',
    '**셋째 제목**',
    '',
    '본문 [둘](#202) · [확장](../extend.md#끝난-까닭) · [밖](https://example.com/x) · [옛](1.x.md)',
    '',
    '```md',
    '## 9.9.9',
    '[보기](보기.md)',
    '```',
    '',
    '울타리 뒤 글',
    '',
    '***',
    '',
    '## 2.0.2 — 부제 단 머리',
    '',
    '**둘째 제목**',
    '',
    '## 1부 · 안쪽',
    '',
    '안쪽 글',
    '',
    '---',
    '',
    '## 2.0.1',
    '',
    '**첫째 제목**',
  ].join('\n');

  const 셋 = 절뽑기(글, '2.0.3') ?? [];
  check('★★ 그 판 절의 첫 줄이 제목이다', 셋[0] === '**셋째 제목**', JSON.stringify(셋[0]));
  check('★★ 부제 단 다음 판 머리(`## 2.0.2 — …`)에서도 끊긴다',
    !셋.some((l) => l.includes('2.0.2') || l.includes('둘째')), 셋.join(' / '));
  check('★★ 코드 울타리 안의 `## 9.9.9` 에서 안 끊긴다', 셋.includes('## 9.9.9') && 셋.includes('울타리 뒤 글'), 셋.join(' / '));
  check('★ 판 사이 가름줄(***)은 안 가져온다', 셋.at(-1) === '울타리 뒤 글', JSON.stringify(셋.at(-1)));

  const 둘 = 절뽑기(글, '2.0.2') ?? [];
  check('★★ 부제 단 머리로도 그 판을 찾는다', 둘[0] === '**둘째 제목**', JSON.stringify(둘[0]));
  check('★★★ 판 안의 `## 1부` 에서 안 끊긴다 (2.0.0 꼴)', 둘.includes('## 1부 · 안쪽') && 둘.includes('안쪽 글'),
    둘.join(' / '));
  check('★★ 그러고도 다음 판 머리에서는 끊긴다', !둘.some((l) => l.includes('첫째')), 둘.join(' / '));
  check('★ 판 사이 가름줄(---)은 안 가져온다', 둘.at(-1) === '안쪽 글', JSON.stringify(둘.at(-1)));

  check('★ 없는 판이면 null', 절뽑기(글, '2.0.9') === null);
  check('★ 울타리 안에만 있는 판은 없는 판이다', 절뽑기(글, '9.9.9') === null);
  check('★ CRLF 로 저장된 노트도 같게 뽑는다',
    JSON.stringify(절뽑기(글.replace(/\n/g, '\r\n'), '2.0.3')) === JSON.stringify(셋));
}

trace('3-링크');
{
  const 저장소 = 'https://github.com/o/r';
  const 풀기 = (줄) => 링크풀기(줄, { 판: '2.0.3', 문서길: 'docs/ko/releases/2.0.md', 저장소 });
  const 바탕 = `${저장소}/blob/v2.0.3/`;
  check('★★ 같은 문서 안 앵커는 그 판 태그의 문서로',
    풀기('[둘](#202)') === `[둘](${바탕}docs/ko/releases/2.0.md#202)`, 풀기('[둘](#202)'));
  check('★★ 위 폴더 문서도 제 자리로',
    풀기('[확장](../extend.md#끝)') === `[확장](${바탕}docs/ko/extend.md#끝)`, 풀기('[확장](../extend.md#끝)'));
  check('★ 옆 문서는 같은 폴더로', 풀기('[옛](1.x.md)') === `[옛](${바탕}docs/ko/releases/1.x.md)`, 풀기('[옛](1.x.md)'));
  check('★ 바깥 주소는 그대로', 풀기('[밖](https://example.com/x)') === '[밖](https://example.com/x)');
  check('★ 괄호 든 바깥 주소도 그대로',
    풀기('[위키](https://ko.wikipedia.org/wiki/F_(b))') === '[위키](https://ko.wikipedia.org/wiki/F_(b))');
  check('★ 괄호 든 상대 주소가 중간에 안 잘린다',
    풀기('[패치](n_(2024).md)') === `[패치](${바탕}docs/ko/releases/n_(2024).md)`, 풀기('[패치](n_(2024).md)'));
  check('★★ 그림은 raw 로 건다 (blob 은 그림이 아니라 HTML 쪽)',
    풀기('![화면](../../assets/a.png)') === `![화면](${저장소}/raw/v2.0.3/docs/assets/a.png)`, 풀기('![화면](../../assets/a.png)'));
  check('★ 저장소 뿌리 기준 주소(/…)는 뿌리에서 푼다',
    풀기('[안내](/docs/ko/guide.md)') === `[안내](${바탕}docs/ko/guide.md)`, 풀기('[안내](/docs/ko/guide.md)'));
  check('★★ 한 줄 코드 안의 링크 문법은 안 건드린다',
    풀기('보기 `[설정](config.md)` 와 [옛](1.x.md)') === `보기 \`[설정](config.md)\` 와 [옛](${바탕}docs/ko/releases/1.x.md)`,
    풀기('보기 `[설정](config.md)` 와 [옛](1.x.md)'));

  check('★ repository 주소에서 git+ 와 .git 을 뗀다',
    저장소주소({ repository: { type: 'git', url: 'git+https://github.com/o/r.git' } }) === 저장소);
  check('★ npm 줄임꼴(o/r · github:o/r)도 주소로 푼다',
    저장소주소({ repository: 'o/r' }) === 저장소 && 저장소주소({ repository: 'github:o/r' }) === 저장소);
}

trace('5-최신깃발');
{
  // 옛 태그를 뒤늦게 밀었을 때 Latest 를 뺏기지 않는가. 글자로 견주면 1.9.0 이
  // 1.10.0 보다 크다 — 그 자리를 따로 잰다.
  const 표 = [
    ['2.0.3', 'v2.0.2', '--latest', '새 판'],
    ['1.18.0', 'v2.0.3', '--latest=false', '옛 태그를 뒤늦게 밈'],
    ['1.10.0', 'v1.9.0', '--latest', '자릿수가 늘어남 (글자 비교면 틀림)'],
    ['1.9.0', 'v1.10.0', '--latest=false', '자릿수가 줄어듦 (글자 비교면 틀림)'],
    ['2.0.3', '', '--latest', '릴리스가 하나도 없음'],
    ['2.0.3', 'v2.0.3', '--latest', '같은 판'],
  ];
  for (const [판, 지금, 기대, 뜻] of 표) {
    const 받음 = 최신깃발(판, 지금);
    check(`★★ ${뜻}: ${판} · 지금 ${지금 || '(없음)'} → ${기대}`, 받음 === 기대, 받음);
  }
  let 던짐 = false;
  try { 최신깃발('2.0.3', 'nightly'); } catch { 던짐 = true; }
  check('★ 못 읽는 Latest 태그면 추측하지 않고 멈춘다', 던짐);

  const 도구 = join(repo, 'tools', 'release-notes.mjs');
  const 옛 = spawnSync(process.execPath, [도구, '1.18.0', '--latest-flag', 'v2.0.3'], { encoding: 'utf8' });
  check('★★ 명령으로 불러도 같다 (워크플로가 부르는 꼴)', 옛.status === 0 && 옛.stdout === '--latest=false\n',
    `${옛.status} ${JSON.stringify(옛.stdout)} ${옛.stderr}`);
  const 빈 = spawnSync(process.execPath, [도구, '2.0.3', '--latest-flag', ''], { encoding: 'utf8' });
  check('★ 빈 Latest 를 넘기면 --latest', 빈.status === 0 && 빈.stdout === '--latest\n', `${빈.status} ${빈.stdout}`);
}

trace('4-지금판');
{
  let 결과 = null;
  let 까닭 = '';
  try { 결과 = 릴리스글(판); } catch (e) { 까닭 = e.message; }
  check(`★★★ 지금 판(${판})의 릴리스 글을 뽑을 수 있다`, !!결과, 까닭);
  if (결과) {
    check('★★ 제목이 「판 — 한 줄」 이다', 결과.제목.startsWith(`${판} — `) && 결과.제목.length > 판.length + 5, 결과.제목);
    const 남은상대 = 결과.본문.match(/\]\((?![a-z][a-z0-9+.-]*:)[^)\s]+\)/gi) ?? [];
    check('★★ 본문의 링크가 전부 절대 주소다 (릴리스 화면에서 안 끊긴다)', 남은상대.length === 0, 남은상대.join(' '));
    // 도구의 판 머리 무늬를 베끼지 않고 더 넓게 본다 — 무늬가 같으면 같은 자리를 같이 놓친다.
    check('★ 본문이 다른 판 절을 안 끌고 온다', !/^#{1,2} *v?\d+\.\d+/m.test(결과.본문),
      /^#{1,2} *v?\d+\.\d+.*$/m.exec(결과.본문)?.[0] ?? '');
  }

  // 워크플로가 부르는 그대로 불러 본다 — 가져와서 부르는 것과 명령으로 부르는
  // 것은 다른 길이다 (명령 쪽은 「이 파일이 직접 불렸나」 를 가려야 돈다).
  const 도구 = join(repo, 'tools', 'release-notes.mjs');
  const 제목 = spawnSync(process.execPath, [도구, 판, '--title'], { encoding: 'utf8' });
  check('★★ 명령으로 부르면 제목 한 줄을 낸다', 제목.status === 0 && 제목.stdout === `${결과?.제목}\n`,
    `${제목.status} ${JSON.stringify(제목.stdout)} ${제목.stderr}`);
  const 본문 = spawnSync(process.execPath, [도구, 판], { encoding: 'utf8' });
  check('★ 명령으로 부르면 본문을 낸다', 본문.status === 0 && 본문.stdout === 결과?.본문, `${본문.status} ${본문.stderr}`);
  const 틀림 = spawnSync(process.execPath, [도구, '9.9.9'], { encoding: 'utf8' });
  check('★★ 노트가 없는 판이면 빈 본문 대신 실패로 끝난다', 틀림.status !== 0 && !틀림.stdout, `${틀림.status} ${틀림.stderr.trim()}`);
}

// ── 마무리 ──────────────────────────────────────────────────────────────
const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\nGitHub 릴리스는 npm 다음  ${D}(두 곳이 다른 판을 최신이라 하면 안 된다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

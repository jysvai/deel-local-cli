/**
 * hwpx 만들기 검사 — 글 → 한글 문서.
 *
 * ── 무엇을 잴 수 있고 무엇을 못 재나 ────────────────────────────────────
 *
 * **한글이 이 파일을 여는가는 여기서 못 잰다.** 이 자리에 한글이 없다.
 * 그건 감출 것이 아니라 적어 둘 것이라, 이 머리말에 적는다.
 *
 * 대신 잴 수 있는 것을 다 잰다.
 *
 *   · 우리 읽개가 되읽는다 — 규격 구조가 제 앞뒤로 맞는다는 뜻이다.
 *     이 읽개는 진짜 한글이 만든 hwpx 를 읽는 그 코드다(tools/docs.js).
 *   · ZIP 규약 — mimetype 이 맨 앞이고 안 눌려 있다.
 *   · 규격이 요구하는 파일이 다 있다.
 *   · XML 이 깨질 자리 — 표기 문자와 제어문자.
 *
 * 되읽기가 「한글에서 열린다」 를 증명하지는 않는다. 다만 구조가 어긋나면
 * 되읽기가 먼저 깨지므로, 못 잡는 것이 줄기는 한다.
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hwpx만들기, 글읽기, 만든말, 문단수최대, 문단최대 } from '../src/tools/hwpxwrite.js';
import { readZip } from '../src/pack/zip.js';
import { readDoc, toText as docText, 문서는못고침 } from '../src/tools/docs.js';
import { runTool } from '../src/tools/index.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-hwpxw-'));

// ══ 1. 글 읽기 ═════════════════════════════════════════════════════════
trace('1-글읽기');
{
  const r = 글읽기('# 큰 제목\n\n첫 문단입니다.\n이어지는 줄.\n\n## 작은 제목\n\n- 하나\n- 둘\n\n3. 셋\n');
  const 갈래들 = r.문단들.map((p) => p.갈래).join(' ');
  check('제목 단계를 읽는다', 갈래들.includes('제목1') && 갈래들.includes('제목2'), 갈래들);
  /*
   * 이어지는 줄을 한 문단으로 붙인다. 마크다운의 규칙이고, 한글에서도 줄마다
   * 문단을 끊으면 줄 간격이 통째로 어색해진다.
   */
  check('★ 이어지는 줄은 한 문단이다',
    r.문단들.some((p) => p.글 === '첫 문단입니다. 이어지는 줄.'),
    JSON.stringify(r.문단들.map((p) => p.글)));
  check('글머리표를 옮긴다', r.문단들.filter((p) => p.갈래 === '글머리').length === 3,
    String(r.문단들.filter((p) => p.갈래 === '글머리').length));
  check('★ 번호는 번호로 남는다', r.문단들.some((p) => p.글 === '3. 셋'),
    JSON.stringify(r.문단들.map((p) => p.글)));
  check('가운뎃점을 쓴다', r.문단들.some((p) => p.글 === '· 하나'), '');

  /*
   * 표는 줄 글로 편다. 그리고 **몇 개였는지 센다** — 조용히 바꿔치기하면
   * 사람은 표가 글이 된 것을 문서를 열어 보고서야 안다.
   */
  const t = 글읽기('| 항목 | 값 |\n|---|---|\n| 가 | 1 |\n| 나 | 2 |\n');
  check('★★ 표를 셌다', t.표몇개 === 1, String(t.표몇개));
  check('★ 표 줄이 글로 남는다', t.문단들.some((p) => p.글.includes('항목') && p.글.includes('값')),
    JSON.stringify(t.문단들.map((p) => p.글)));
  check('  구분선은 안 남는다', !t.문단들.some((p) => /---/.test(p.글)), '');

  check('빈 줄만 있으면 문단이 없다', 글읽기('\n\n  \n').문단들.length === 0, '');
}

// ══ 2. 넘치는 것은 자르고 말한다 ═══════════════════════════════════════
trace('2-자르기');
{
  const 많이 = 글읽기(Array.from({ length: 문단수최대 + 20 }, (_, i) => `줄 ${i}`).join('\n\n'));
  check('★ 문단 수 상한이 있다', 많이.문단들.length === 문단수최대, String(많이.문단들.length));
  check('★★ 그리고 몇 개를 잘랐는지 말한다', 많이.잘림 === 20, String(많이.잘림));

  const 긴것 = 글읽기('가'.repeat(문단최대 + 100));
  check('★ 긴 문단도 자른다', 긴것.문단들[0].글.length <= 문단최대 + 10, String(긴것.문단들[0].글.length));
  check('  자른 자리를 적는다', /잘림/.test(긴것.문단들[0].글), '');

  const 말 = 만든말({ 문단수: 3, 표몇개: 2, 잘림: 5 }, 'a.hwpx');
  check('★★ 바꿔치기한 것을 사람에게 말한다', /표 2개/.test(말) && /5개/.test(말), 말);
}

// ══ 3. ZIP 규약 ════════════════════════════════════════════════════════
trace('3-zip규약');
{
  const r = hwpx만들기('# 제목\n\n본문.\n');
  const z = readZip(r.buf);
  const 이름들 = [...z.files.keys()];

  /*
   * `mimetype` 은 맨 앞에, 안 눌러서. ZIP 을 안 풀고도 앞머리만 보고 무슨
   * 파일인지 알게 하려는 규약이다.
   */
  check('★★ mimetype 이 맨 앞이다', 이름들[0] === 'mimetype', 이름들.slice(0, 3).join(' '));
  check('★★ 그리고 안 눌려 있다', r.buf.readUInt16LE(8) === 0, String(r.buf.readUInt16LE(8)));
  check('  내용이 규격 그대로다', z.files.get('mimetype')?.toString('utf8') === 'application/hwp+zip',
    z.files.get('mimetype')?.toString('utf8'));

  // 규격이 요구하는 것이 다 있어야 한다. 하나만 빠져도 한글은 파일을 안 연다.
  for (const 있어야할것 of [
    'version.xml', 'META-INF/container.xml', 'META-INF/manifest.xml',
    'Contents/content.hpf', 'Contents/header.xml', 'Contents/section0.xml', 'settings.xml',
  ]) {
    check(`  ${있어야할것} 이 있다`, z.files.has(있어야할것), 이름들.join(' '));
  }
  /*
   * 미리보기 글이 있어야 사내 공유폴더에서 **검색이 걸린다.** 문서를 만들어
   * 주는 값의 절반이 거기 있다.
   */
  check('★ 미리보기 글도 담는다', z.files.get('Preview/PrvText.txt')?.toString('utf8').includes('제목'), '');
}

// ══ 4. 우리 읽개가 되읽는다 ════════════════════════════════════════════
trace('4-되읽기');
{
  /*
   * 이 읽개는 **진짜 한글이 만든 hwpx 를 읽는 그 코드**다(tools/docs.js).
   * 그게 되읽는다는 것은 구조가 제 앞뒤로 맞는다는 뜻이다. 한글이 연다는
   * 증명은 아니지만, 어긋나면 여기서 먼저 깨진다.
   */
  const 글 = '# 주간 보고\n\n이번 주에 한 일입니다.\n이어지는 줄.\n\n## 다음 주\n\n- 첫째\n- 둘째\n';
  const r = hwpx만들기(글);
  const 자리 = join(root, '보고.hwpx');
  writeFileSync(자리, r.buf);

  const back = readDoc(자리);
  check('★★ 우리 읽개가 되읽는다', back.ok === true, back.error ?? '');
  const { text } = docText(back.덩이들);
  check('★★ 제목이 그대로다', text.includes('주간 보고') && text.includes('다음 주'), text.slice(0, 80));
  check('★★ 본문이 그대로다', text.includes('이번 주에 한 일입니다. 이어지는 줄.'), text.slice(0, 120));
  check('★ 글머리표도 그대로다', text.includes('· 첫째'), text.slice(0, 160));
  check('문단 수가 맞는다', r.문단수 === 5, String(r.문단수));
  check('제목을 첫 제목 줄에서 딴다', r.제목 === '주간 보고', r.제목);
}

// ══ 5. XML 이 깨질 자리 ════════════════════════════════════════════════
trace('5-xml깨짐');
{
  /*
   * 표기 문자 하나가 XML 을 통째로 못 쓰게 만든다. 그리고 그 실패는 「손상된
   * 문서」 한 줄로만 나타나서, 무엇 때문인지 알 길이 없다.
   */
  const 자리 = join(root, '표기.hwpx');
  writeFileSync(자리, hwpx만들기('a < b & c > d "따옴표"\n').buf);
  const back = readDoc(자리);
  check('★★ < & > 가 있어도 깨지지 않는다', back.ok === true, back.error ?? '');
  check('★★ 그리고 글자가 그대로 돌아온다',
    docText(back.덩이들).text.includes('a < b & c > d'), docText(back.덩이들).text);

  /*
   * 제어문자는 XML 1.0 이 아예 못 담는다. 모델이 터미널 출력을 그대로 옮겨
   * 적으면 ESC(0x1B)가 딸려 오는데, 남겨 두면 한글이 **파일 전체**를 안 연다.
   */
  const 자리2 = join(root, '제어.hwpx');
  const 더러운글 = '앞\x1b[31m빨강 널\x00종\n';
  writeFileSync(자리2, hwpx만들기(더러운글).buf);
  const back2 = readDoc(자리2);
  check('★★ 제어문자가 섞여도 깨지지 않는다', back2.ok === true, back2.error ?? '');
  const 나온글 = docText(back2.덩이들).text;
  check('★★ 제어문자는 걷어낸다',
    !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(나온글), JSON.stringify(나온글));
  check('  글자는 남는다', 나온글.includes('빨강'), 나온글);

  // 한글·이모지가 온전해야 한다. UTF-8 로 담고 있는지의 문제다.
  const 자리3 = join(root, '한글.hwpx');
  writeFileSync(자리3, hwpx만들기('가나다 漢字 🙂 café\n').buf);
  check('★ 한글·한자·이모지가 온전하다',
    docText(readDoc(자리3).덩이들).text.includes('가나다 漢字 🙂 café'),
    docText(readDoc(자리3).덩이들).text);
}

// ══ 6. Write 도구로 (새로 만드는 것만) ═════════════════════════════════
trace('6-Write도구');
{
  const ctx = {
    scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set(),
  };
  const r = await runTool('Write', { file_path: '문서/보고서.hwpx', content: '# 제목\n\n본문.\n' }, ctx);
  check('★★ Write 로 hwpx 를 만든다', !r.error && existsSync(join(root, '문서/보고서.hwpx')), r.error ?? '');
  check('  없는 폴더도 만들어 준다', existsSync(join(root, '문서')), '');
  check('  되돌리기에 잡히게 changed 를 준다', !!r.changed, JSON.stringify(r));
  check('★ 만든 것이 진짜 hwpx 다', readDoc(join(root, '문서/보고서.hwpx')).ok === true, '');

  /*
   * seen 에 안 올린다. seen 은 「Edit 로 고쳐도 되는 것을 읽어 뒀다」 는
   * 표인데, hwpx 는 만든 다음에도 못 고친다. 올려 두면 모델이 Edit 를 부르고
   * 거절당하고 또 부른다.
   */
  check('★★ seen 에는 안 올린다 — 고칠 물건이 아니다',
    !ctx.seen.has(join(root, '문서/보고서.hwpx')), '');

  /*
   * ── 여기가 이 파일에서 제일 중요한 검사 ──────────────────────────
   *
   * 덮어쓰기는 여전히 안 된다. 「글로 왕복시키면 반드시 뭔가 잃는데, 잃은
   * 채로 저장된 문서는 겉보기에 멀쩡해서 알아차렸을 때는 원본이 없다」 가
   * 그대로 서 있어야 한다. 새로 만드는 자리만 연 것이다.
   */
  const 덮 = await runTool('Write', { file_path: '문서/보고서.hwpx', content: '다른 내용' }, ctx);
  check('★★ 있는 hwpx 는 여전히 못 덮어쓴다', !!덮.error, JSON.stringify(덮).slice(0, 80));
  check('★★ 그리고 새로 만드는 길을 알려 준다', /새로 만드는 것은 됩니다/.test(덮.error ?? ''), 덮.error ?? '');

  // 고치기도 그대로 막힌다.
  const 고 = await runTool('Edit', { file_path: '문서/보고서.hwpx', old_string: 'a', new_string: 'b' }, ctx);
  check('★ Edit 도 그대로 막힌다', !!고.error, 고.error ?? '');

  // docx·pptx 는 새로 만드는 길도 없다 — 우리가 못 만든다.
  const d = await runTool('Write', { file_path: '새것.docx', content: 'x' }, ctx);
  check('★★ docx 는 새로 만드는 것도 안 된다', !!d.error, d.error ?? '');
  check('  그리고 hwpx 안내를 안 한다', !/새로 만드는 것은 됩니다/.test(d.error ?? ''), d.error ?? '');
  check('  대신 글 파일로 내라고 한다', /글 파일/.test(d.error ?? ''), d.error ?? '');

  check('안내문이 hwpx 와 docx 를 갈라 적는다',
    /새로 만드는 것은 됩니다/.test(문서는못고침('a.hwpx')) && !/새로 만드는 것은 됩니다/.test(문서는못고침('a.docx')), '');
}

rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\nhwpx 만들기  ${D}(글 → 한글 문서 · 새로 만드는 것만)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패`);
console.log(`  ${D}※ 한글이 이 파일을 여는지는 여기서 못 잽니다 — 이 자리에 한글이 없습니다.${X}\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

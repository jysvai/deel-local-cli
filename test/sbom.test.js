// 심사 담당자가 **읽지 않고 넣을 수 있는** 서류가 나오는가.
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// `deel audit` 이 내놓는 반입심사서.txt 는 사람이 읽는 글이다. 그건 그대로
// 값이 있지만, 요즘 반입 심사는 사람만 보는 절차가 아니다 — 보안팀은 SBOM 을
// **스캐너에 먹여서** 취약점 목록을 뽑고, 운영팀은 감사기록 사양을 보고
// SIEM 수집 규칙을 짠다. 사람이 읽는 글은 그 어느 쪽에도 못 들어간다.
//
// 여기서 재는 것 중 제일 중요한 것은 **서류가 사실과 어긋나지 않는가** 이다.
// 손으로 적은 목록은 반드시 어긋나고, 어긋난 심사 서류는 없느니만 못하다 —
// 담당자가 한 번 틀린 것을 발견하면 나머지도 안 믿는다.
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audit, packSelf, repoRoot } from '../src/pack/selfpack.js';
import { sbom, 심사명세, 통신명세, 감사명세, 명세요약, CDX판 } from '../src/pack/sbom.js';
import { readZip } from '../src/pack/zip.js';
import { Audit } from '../src/safety/audit.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const a = audit(repoRoot());
const 때 = new Date('2026-08-26T00:00:00.000Z');

trace('1-SBOM');

// ── SBOM ────────────────────────────────────────────────────────────────
//
// CycloneDX 는 스캐너가 읽는 규격이다. 우리가 이름을 지어내면 그 순간 아무
// 도구도 못 읽는 파일이 된다.
{
  const b = sbom(a, { at: 때, serial: '00000000-0000-4000-8000-000000000000' });

  check('CycloneDX 라고 밝힌다', b.bomFormat === 'CycloneDX' && b.specVersion === CDX판,
    `${b.bomFormat} ${b.specVersion}`);
  check('일련번호가 urn:uuid 모양이다', /^urn:uuid:[0-9a-f-]{36}$/.test(b.serialNumber), b.serialNumber);
  check('만든 때를 ISO 로 적는다', b.metadata.timestamp === 때.toISOString(), b.metadata.timestamp);

  check('제 이름과 판을 적는다', b.metadata.component.name === a.name && b.metadata.component.version === a.version,
    `${b.metadata.component.name}@${b.metadata.component.version}`);
  check('purl 을 붙인다 — 스캐너가 이걸로 찾는다',
    b.metadata.component.purl === `pkg:npm/${a.name}@${a.version}`, b.metadata.component.purl);
  check('라이선스를 적는다', b.metadata.component.licenses?.[0]?.license?.id === a.license,
    JSON.stringify(b.metadata.component.licenses));

  /*
   * 0개를 0개라고 적는다.
   *
   * dependencies 를 아예 빼면 스캐너가 "안 적어 낸 것" 과 "없는 것" 을
   * 구별하지 못한다. 빈 배열이라야 '없다' 가 주장으로 남는다.
   */
  check('의존성 칸이 아예 없지 않고 비어 있다',
    Array.isArray(b.dependencies) && b.dependencies.length === 1 && Array.isArray(b.dependencies[0].dependsOn)
      && b.dependencies[0].dependsOn.length === 0,
    JSON.stringify(b.dependencies));
  check('의존성 개수를 속성으로도 적는다',
    b.metadata.properties.some((p) => p.name === 'deel:dependencies' && p.value === String(a.deps.length)),
    JSON.stringify(b.metadata.properties));

  check('파일마다 부품 하나', b.components.length === a.files.length,
    `${b.components.length} / ${a.files.length}`);
  check('전부 SHA-256 이 붙어 있다',
    b.components.every((cmp) => cmp.hashes?.[0]?.alg === 'SHA-256' && /^[0-9a-f]{64}$/.test(cmp.hashes[0].content)),
    JSON.stringify(b.components[0]?.hashes));
  check('해시가 진짜 그 파일의 것이다', (() => {
    const 하나 = b.components.find((cmp) => cmp.name === 'package.json');
    const 원본 = a.files.find((f) => f.path === 'package.json');
    return 하나 && 원본 && 하나.hashes[0].content === 원본.sha;
  })());
  check('ACP 도 부품 목록에 들어 있다', b.components.some((cmp) => cmp.name === 'src/acp/serve.js'),
    b.components.filter((cmp) => cmp.name.startsWith('src/acp')).map((cmp) => cmp.name).join(' '));

  // JSON 으로 오갈 수 있어야 한다. 못 하면 파일로 못 낸다.
  check('JSON 으로 나갔다 들어온다', (() => {
    try { return JSON.parse(JSON.stringify(b)).components.length === b.components.length; } catch { return false; }
  })());
}

trace('2-통신명세');

// ── 통신 목록 ───────────────────────────────────────────────────────────
//
// 정책만 적으면 믿을 근거가 없고, 자리만 적으면 무슨 뜻인지 알 수 없다.
// 둘을 같이 실어야 담당자가 확인할 수 있다.
{
  const t = 통신명세(a);
  check('나가는 길을 갈래로 나눠 적는다', (t.나가는길?.length ?? 0) >= 3,
    JSON.stringify(t.나가는길?.map((x) => x.갈래)));
  check('갈래마다 언제·어디로·무엇이·막는법을 다 적는다',
    t.나가는길.every((x) => x.갈래 && x.언제 && x.어디로 && x.무엇이 && x.막는법),
    JSON.stringify(t.나가는길[0]));

  /*
   * 자리는 소스에서 찾은 것이라야 한다.
   *
   * 손으로 적으면 코드가 옮겨 다니는 동안 서류만 옛 자리를 가리키게 된다.
   * 담당자가 그 줄을 열어 보고 아무것도 없으면 나머지도 안 믿는다.
   */
  const 자리들 = t.나가는길.flatMap((x) => x.소스 ?? []);
  check('소스 자리를 파일:줄 로 짚어 준다', 자리들.length > 0 && 자리들.every((s) => /^[\w./-]+:\d+$/.test(s)),
    JSON.stringify(자리들.slice(0, 3)));
  check('그 줄이 진짜 있다', (() => {
    const [파일, 줄] = 자리들[0].split(':');
    const 줄들 = readFileSync(join(repoRoot(), 파일), 'utf8').split(/\r?\n/);
    return 줄들[Number(줄) - 1] != null;
  })(), 자리들[0]);

  check('여는 포트 수를 실제 값으로 적는다', t.여는포트.개수 === (a.calls?.listen?.length ?? 0),
    `${t.여는포트.개수} / ${a.calls?.listen?.length}`);
  check('문자열 실행은 0 이어야 한다', t.문자열실행.개수 === 0, String(t.문자열실행.개수));
  check('자물쇠를 걸면 무엇이 닫히는지 적는다', (t.offline일때?.length ?? 0) >= 3,
    JSON.stringify(t.offline일때));
  // 막을 수 없는 것을 막았다고 말하지 않는다 — 이 프로젝트의 규칙이다.
  check('못 막는 것은 못 막는다고 적는다', t.offline일때.some((s) => /못 막/.test(s)),
    JSON.stringify(t.offline일때));
}

trace('3-감사명세');

// ── 감사 사양이 진짜와 어긋나지 않는가 ──────────────────────────────────
//
// 여기가 이 검사의 핵심이다. 감사 사양만은 손으로 적었다. 손으로 적은 것은
// 반드시 어긋나므로, 진짜 기록과 대조한다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-sbom-'));
  const 감사 = new Audit(방);
  const 사양 = 감사명세();

  const 줄들 = {
    turn: 감사.turn('검사용 한마디'),
    tool: 감사.tool('Read', { file_path: 'a.js' }, { summary: '3줄' }),
    blocked: 감사.blocked('위험한 명령', 'rm -rf /'),
    undo: 감사.undo({ files: 1, turns: 1 }),
  };

  check('줄마다 있는 칸이 진짜로 다 있다',
    사양.줄마다.every((칸) => Object.hasOwn(줄들.tool, 칸.칸)),
    `${JSON.stringify(사양.줄마다.map((x) => x.칸))} vs ${JSON.stringify(Object.keys(줄들.tool))}`);

  for (const 종 of 사양.종류) {
    const 진짜 = 줄들[종.kind];
    check(`${종.kind} 기록이 실제로 남는다`, !!진짜, JSON.stringify(Object.keys(줄들)));
    if (!진짜) continue;
    const 없는칸 = (종.칸 ?? []).filter((k) => !Object.hasOwn(진짜, k));
    check(`${종.kind} 의 칸 목록이 진짜와 맞는다`, 없는칸.length === 0,
      `없는 칸: ${없는칸.join(' ')} · 진짜: ${Object.keys(진짜).join(' ')}`);
  }

  // 사양에 없는 종류가 진짜로 남고 있으면 그것도 어긋난 것이다.
  const 적은종류 = new Set(사양.종류.map((x) => x.kind));
  check('사양에 적은 종류로 다 덮인다',
    Object.keys(줄들).every((k) => 적은종류.has(k)),
    `${[...적은종류].join(' ')} / ${Object.keys(줄들).join(' ')}`);

  check('어디에 쌓이는지 적는다', /audit\.jsonl/.test(사양.자리), 사양.자리);
  check('무슨 형식인지 적는다', /JSON Lines/i.test(사양.형식), 사양.형식);
  check('안 남기는 것도 적는다', (사양.안남기는것?.length ?? 0) >= 2, JSON.stringify(사양.안남기는것));
  check('열쇠는 안 남긴다고 못 박는다', 사양.안남기는것.some((s) => /열쇠|암호/.test(s)),
    JSON.stringify(사양.안남기는것));

  rmSync(방, { recursive: true, force: true });
}

trace('4-한덩이');

// ── 한 덩이로 묶었을 때 ─────────────────────────────────────────────────
{
  const m = 심사명세(a, { at: 때 });
  check('판 번호가 package.json 과 같다', m.판 === a.version, `${m.판} / ${a.version}`);
  check('의존성을 그대로 싣는다', JSON.stringify(m.의존성.dependencies) === JSON.stringify(a.deps));
  check('의존성이 0 이면 그렇다고 한마디 한다', /남의 코드를 함께 들여오지 않/.test(m.의존성.한마디),
    m.의존성.한마디);
  check('파일 목록에 해시가 있다', m.파일.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  check('통신과 감사가 다 들어 있다', !!m.통신?.나가는길 && !!m.감사기록?.종류);

  const 요약 = 명세요약(m);
  check('사람이 읽을 요약도 나온다', /SBOM 부품/.test(요약) && /감사기록/.test(요약), 요약.slice(0, 60));
  check('요약이 이상한 값으로 안 죽는다', typeof 명세요약(null) === 'string' && typeof 명세요약({}) === 'string');

  // 외부 모듈이 있으면 있다고 말해야 한다. 없을 때만 안심시키면 안 된다.
  const 가짜 = { ...a, deps: ['left-pad'], 외부모듈: ['src/x.js → left-pad'] };
  check('외부 모듈이 있으면 확인하라고 말한다', /확인/.test(심사명세(가짜).의존성.한마디),
    심사명세(가짜).의존성.한마디);
}

trace('5-zip에들어가나');

// ── 진짜 zip 을 만들어 열어 본다 ────────────────────────────────────────
//
// 만드는 함수가 맞아도 zip 에 안 들어가면 담당자 손에는 아무것도 안 간다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-pack-'));
  const 자리 = join(방, '반입.zip');
  const r = packSelf(자리, { at: 때 });
  // readZip 은 이름→내용 Map 을 돌려준다.
  const 안 = readZip(readFileSync(자리)).files;
  const 이름들 = [...안.keys()];

  check('사람이 읽는 심사서가 들어 있다', 이름들.includes('반입심사서.txt'), 이름들.slice(0, 5).join(' '));
  check('SBOM 이 들어 있다', 이름들.includes('sbom.cdx.json'));
  check('심사명세가 들어 있다', 이름들.includes('심사명세.json'));

  const 꺼낸SBOM = JSON.parse(안.get('sbom.cdx.json').toString('utf8'));
  check('꺼낸 SBOM 이 제대로 된 CycloneDX', 꺼낸SBOM.bomFormat === 'CycloneDX'
    && 꺼낸SBOM.components.length === a.files.length,
    `${꺼낸SBOM.components?.length} / ${a.files.length}`);

  /*
   * 서류에 적힌 해시가 **같은 zip 안에 든 파일**의 해시여야 한다.
   *
   * 이게 어긋나면 서류가 거짓말을 하는 것이고, 담당자가 확인하는 순간 들킨다.
   */
  const 안의파일 = new Map([...안].filter(([n]) => n.startsWith('deel/')).map(([n, d]) => [n.slice(5), d]));
  const 어긋난것 = [];
  for (const cmp of 꺼낸SBOM.components) {
    const buf = 안의파일.get(cmp.name);
    if (!buf) { 어긋난것.push(`${cmp.name} 없음`); continue; }
    const { createHash } = await import('node:crypto');
    if (createHash('sha256').update(buf).digest('hex') !== cmp.hashes[0].content) 어긋난것.push(cmp.name);
  }
  check('SBOM 의 해시가 zip 안의 진짜 파일과 맞는다', 어긋난것.length === 0,
    어긋난것.slice(0, 3).join(' · '));

  const 읽어주세요 = 안.get('읽어주세요.txt').toString('utf8');
  check('읽어주세요에 세 장을 다 안내한다',
    /sbom\.cdx\.json/.test(읽어주세요) && /심사명세\.json/.test(읽어주세요), 읽어주세요.slice(-260));
  check('손으로 적은 값이 아니라고 밝힌다', /손으로 적은 값이 아/.test(읽어주세요));
  check('묶은 결과를 돌려준다', r.files === 안.size, `${r.files} / ${안.size}`);

  rmSync(방, { recursive: true, force: true });
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n심사 서류 검사  ${D}(스캐너에 넣을 수 있는가 · 사실과 어긋나지 않는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

/**
 * README 를 얇게 만든다 — 안쪽 이야기를 docs/ 로 옮긴다.
 *
 * ── 왜 ──────────────────────────────────────────────────────────────────
 *
 * README 가 2,800줄이 되면 아무도 안 읽는다. 처음 온 사람은 "이게 뭐고 내
 * 소스가 어디로 가나" 만 알면 되는데, 그 답이 `Append` 설명과 릴리스 노트
 * 사이에 묻힌다.
 *
 * 다행히 이 문서는 처음부터 **요약 + `▸ 자세히`** 로 짜여 있었다. 그래서 잘라
 * 붙일 자리를 새로 정할 필요가 없다 — 접어 둔 `<details>` 가 그대로 한 쪽이
 * 된다. 요약은 README 에 남고, 펼쳐야 보이던 것은 docs/ 로 간다. 접혀 있어서
 * 안 보이던 것이라 README 에서 사라지는 글은 없다.
 *
 *   node tools/split-docs.mjs
 *
 * 여러 번 돌려도 같은 결과다(이미 옮긴 절은 `<details>` 가 없어 건너뛴다).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

/*
 * 어느 절의 안쪽이 어느 쪽으로 가나.
 *
 * 절 하나에 파일 하나씩 만들면 스무 개가 넘는다 — 그건 나눈 것이 아니라
 * 흩은 것이다. 같이 읽을 것끼리 묶는다.
 */
const 묶음 = [
  {
    쪽: 'models',
    제목: { ko: '모델 다루기', en: 'Models' },
    한줄: {
      ko: '여러 모델을 오가며 쓰기 · 급과 창 크기 · 국산 모델 이름표 · 프로젝트 읽기',
      en: 'Moving between models, grade and window size, Korean-model presets, project detection',
    },
    kos: ['로컬 모델 여러 개 쓰기'],
    ens: ['Multiple local runtimes'],
  },
  {
    쪽: 'interface',
    제목: { ko: '화면과 조작', en: 'The screen' },
    한줄: {
      ko: '명령 · 입력칸 · 작업 모드 · 쉬움과 개발자 · 무엇을 묻고 무엇을 그냥 하나',
      en: 'Commands, the input box, work modes, simple vs developer, what it asks about',
    },
    kos: ['대화 중 명령', '작업 모드', '쉬움 · 개발자'],
    ens: ['Slash commands', 'Work modes', 'Simple vs developer'],
  },
  {
    쪽: 'tools',
    제목: { ko: '도구 자세히', en: 'Tools in depth' },
    한줄: {
      ko: 'Outline · Verify · Task · Jobs · Append · Def/Refs · 편집 매칭 · 진단',
      en: 'Outline, Verify, Task, Jobs, Append, Def/Refs, edit matching, diagnostics',
    },
    kos: ['도구'],
    ens: ['Tools'],
  },
  {
    쪽: 'documents',
    제목: { ko: '한글 문서와 엑셀', en: 'Korean documents and Excel' },
    한줄: {
      ko: 'hwpx·docx·pptx 를 글로 · 인코딩을 읽은 그대로 · 엑셀을 CSV 로',
      en: 'hwpx/docx/pptx as text, encoding written back as read, Excel as CSV',
    },
    kos: ['한글 문서와 엑셀'],
    ens: ['Korean text and Excel'],
  },
  {
    쪽: 'extend',
    제목: { ko: '늘려 쓰기', en: 'Extending' },
    한줄: {
      ko: '스킬 · 플러그인 · 밖에서 도구 붙이기(MCP) · 에디터 안에서 쓰기(ACP)',
      en: 'Skills, plugins, tools from outside (MCP), inside your editor (ACP)',
    },
    kos: ['스킬·플러그인', '밖에서 도구 붙이기 (MCP)', '에디터 안에서 쓰기 (ACP)'],
    ens: ['Skills and plugins', 'Attaching tools from outside (MCP)', 'Inside your editor (ACP)'],
  },
  {
    쪽: 'tuning',
    제목: { ko: '속도와 씀씀이', en: 'Speed and spend' },
    한줄: {
      ko: '단계별 추론 강도 · 프리픽스 캐시 · 컨텍스트 길이 · 한 번에 받을 답 길이',
      en: 'Per-stage effort, the prefix cache, context length, reply-length cap',
    },
    kos: ['추론 강도'],
    ens: ['Reasoning effort'],
  },
  {
    쪽: 'safety',
    제목: { ko: '안전망과 사내 반입', en: 'Safety and corporate review' },
    한줄: {
      ko: '되돌리기 · 작업 범위 · 감사기록 · 반입 심사 서류(SBOM·통신 목록)',
      en: 'Undo, working scope, the audit log, the review package (SBOM, egress list)',
    },
    kos: ['안전망', '사내 반입'],
    ens: ['Safety', 'Corporate review package'],
  },
  {
    쪽: 'config',
    제목: { ko: '설정', en: 'Configuration' },
    한줄: {
      ko: '붙는 서버 · 환경변수 · 실행 옵션 · 프로젝트 규칙',
      en: 'Servers, environment variables, run flags, project rules',
    },
    kos: ['설정'],
    ens: ['Configuration'],
  },
  {
    쪽: 'develop',
    제목: { ko: '개발', en: 'Development' },
    한줄: {
      ko: '검사 돌리기 · 어디를 밟았는지 · 폴더 구조',
      en: 'Running the tests, coverage, the folder layout',
    },
    kos: ['개발'],
    ens: ['Development'],
  },
  {
    쪽: 'releases',
    제목: { ko: '릴리스 노트', en: 'Release notes' },
    한줄: {
      ko: '판마다 무엇이 어떻게 바뀌었나',
      en: 'What changed in each version, and why',
    },
    kos: ['릴리스 노트'],
    ens: ['Release notes'],
  },
];

const 말들 = {
  ko: { 파일: 'README.md', 되돌아: '← README 로', 자세히: '자세히', 읽기: '읽기' },
  en: { 파일: 'README.en.md', 되돌아: '← back to README', 자세히: 'More', 읽기: 'read' },
};

/** `<b>자세히</b> — A · B` 에서 글자만. 링크 이름표로 쓴다. */
function 이름표(s) {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * GitHub 가 제목에서 만드는 닻 이름. 한글은 그대로 남는다.
 *
 * 빈칸 하나가 하이픈 하나다. 여러 칸을 하나로 줄이면 안 된다 —
 * `쉬움 · 개발자` 의 닻은 `쉬움--개발자` 이지 `쉬움-개발자` 가 아니다.
 * (가운뎃점이 지워지고 그 자리에 빈칸 둘이 남는다.)
 */
function 닻(제목) {
  return 제목
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/ /g, '-');
}

function 나누기(말) {
  const 설정 = 말들[말];
  const 줄 = readFileSync(설정.파일, 'utf8').split('\n');

  // 절 경계부터 잡는다.
  const 절 = [];
  줄.forEach((s, i) => { if (/^## /.test(s)) 절.push({ 이름: s.slice(3).trim(), 시작: i }); });
  절.forEach((s, i) => { s.끝 = i + 1 < 절.length ? 절[i + 1].시작 : 줄.length; });

  const 옮긴것 = new Map();  // 절 이름 → { 쪽, 이름표, 내용 }
  const 지울줄 = new Set();
  const 넣을것 = new Map();  // 줄 번호 → 대신 넣을 글

  for (const m of 묶음) {
    const 이름들 = 말 === 'ko' ? m.kos : m.ens;
    for (const 절이름 of 이름들) {
      const s = 절.find((x) => x.이름 === 절이름);
      if (!s) { console.warn(`  ! 못 찾음: ${절이름}`); continue; }

      const 덩이들 = [];
      let 깊이 = 0;
      let 시작 = -1;
      for (let i = s.시작; i < s.끝; i += 1) {
        if (/^<details>/.test(줄[i])) { if (깊이 === 0) 시작 = i; 깊이 += 1; }
        else if (/^<\/details>/.test(줄[i])) {
          깊이 -= 1;
          if (깊이 === 0) { 덩이들.push({ 시작, 끝: i }); 시작 = -1; }
        }
      }
      if (!덩이들.length) continue;

      const 조각 = [];
      for (const d of 덩이들) {
        const 요약 = 이름표(줄[d.시작 + 1] ?? '');
        const 속 = 줄.slice(d.시작 + 2, d.끝);
        조각.push({ 요약, 속 });
        for (let i = d.시작; i <= d.끝; i += 1) 지울줄.add(i);
      }
      // 첫 덩이 자리에 링크 한 줄을 남긴다.
      const 이름목록 = 조각.map((x) => x.요약).join(' · ');
      const 보임 = 이름목록.replace(new RegExp(`^${설정.자세히}\\s*[—-]\\s*`), '');
      넣을것.set(덩이들[0].시작, [
        `> **${설정.자세히}** — ${보임}`,
        '>',
        `> **[${m.제목[말]} ${설정.읽기} →](docs/${말}/${m.쪽}.md#${닻(절이름)})**`,
      ]);
      옮긴것.set(절이름, { m, 조각 });
    }
  }

  // ── docs 쪽 쓰기 ──────────────────────────────────────────────────────
  mkdirSync(`docs/${말}`, { recursive: true });
  for (const m of 묶음) {
    const 이름들 = 말 === 'ko' ? m.kos : m.ens;
    const 있는것 = 이름들.map((n) => [n, 옮긴것.get(n)]).filter(([, v]) => v);
    if (!있는것.length) continue;

    const 글 = [
      `[${설정.되돌아}](../../${설정.파일})`,
      '',
      `# ${m.제목[말]}`,
      '',
      `${m.한줄[말]}`,
      '',
      '---',
      '',
    ];
    for (const [절이름, v] of 있는것) {
      글.push(`## ${절이름}`, '');
      for (const 조각 of v.조각) {
        if (v.조각.length > 1 || /^\S/.test(조각.요약)) {
          const 소제목 = 조각.요약.replace(new RegExp(`^${설정.자세히}\\s*[—-]\\s*`), '');
          if (소제목 && 소제목 !== 조각.요약) 글.push(`<sub>${소제목}</sub>`, '');
          else if (소제목) 글.push(`### ${소제목}`, '');
        }
        글.push(...조각.속, '');
      }
      글.push('---', '');
    }
    글.push(`[${설정.되돌아}](../../${설정.파일})`, '');
    writeFileSync(`docs/${말}/${m.쪽}.md`, 글.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8');
    console.log(`  ${`docs/${말}/${m.쪽}.md`.padEnd(24)} ${있는것.length}개 절`);
  }

  // ── README 다시 쓰기 ──────────────────────────────────────────────────
  const 남길것 = [];
  for (let i = 0; i < 줄.length; i += 1) {
    if (넣을것.has(i)) 남길것.push(...넣을것.get(i));
    if (지울줄.has(i)) continue;
    남길것.push(줄[i]);
  }
  const 새글 = 남길것.join('\n').replace(/\n{3,}/g, '\n\n');
  writeFileSync(설정.파일, 새글, 'utf8');
  console.log(`  ${설정.파일} ${줄.length}줄 → ${새글.split('\n').length}줄`);
}

for (const 말 of ['ko', 'en']) {
  console.log(`\n[${말}]`);
  나누기(말);
}

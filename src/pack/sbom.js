// 심사 담당자가 **읽지 않고 넣을 수 있는** 서류.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────
//
// `deel audit` 이 내놓는 반입심사서.txt 는 사람이 읽는 글이다. 그건 그대로
// 값이 있지만, 사내 반입 심사는 사람만 보는 절차가 아니다. 요즘은 보안팀이
// **SBOM 을 스캐너에 먹여서** 취약점 목록을 뽑는다. 사람이 읽는 글은 거기에
// 못 들어간다.
//
// 2026년 4월 20일 전자금융감독규정 시행세칙 개정으로 금융권 망분리 예외가
// 열렸다. 그 문이 열린 자리에서 제일 먼저 요구되는 것이 이 세 가지다.
//
//   SBOM        무엇으로 만들어졌나 — 표준 형식(CycloneDX)으로
//   통신 목록    어디로 나가나 — 소스에서 찾은 자리와 정책을 함께
//   감사 사양    무엇이 기록되나 — 이걸 알아야 SIEM 에 넣을 수 있다
//
// ── 지어내지 않는다 ────────────────────────────────────────────────────
//
// 여기 적히는 값은 전부 selfpack.js 의 audit() 이 **소스를 실제로 훑어** 얻은
// 것이다. 손으로 적은 목록을 두면 반드시 어긋나고, 어긋난 심사 서류는 없느니만
// 못하다 — 담당자가 한 번 틀린 것을 발견하면 나머지도 안 믿는다.
//
// 감사 사양만은 손으로 적었다. 그래서 그것이 진짜와 어긋나지 않는지를
// 검사에서 확인한다 (test/sbom.test.js) — Audit 이 실제로 남긴 줄에 여기
// 적어 둔 칸이 다 있는지 본다.
import { randomUUID } from 'node:crypto';

/** 우리가 내놓는 SBOM 규격. 스캐너가 이 숫자를 보고 읽는 법을 정한다. */
export const CDX판 = '1.5';

/**
 * CycloneDX SBOM.
 *
 * 의존성이 0개인 물건의 SBOM 은 거의 빈 문서가 된다. 그래서 파일 하나하나를
 * `type: "file"` 부품으로 싣고 SHA-256 을 붙인다 — 규격이 허락하는 쓰임이고,
 * 담당자가 받은 zip 이 우리가 만든 그것인지 **기계로** 확인할 수 있게 된다.
 *
 * @param {object} a    selfpack.js 의 audit()
 * @param {object} o
 * @param {Date}   o.at        만든 때 (검사가 고정할 수 있게)
 * @param {string} o.serial    문서 일련번호 (검사가 고정할 수 있게)
 */
export function sbom(a, { at = new Date(), serial = null } = {}) {
  const purl = `pkg:npm/${a.name}@${a.version}`;
  const 본체 = {
    type: 'application',
    'bom-ref': purl,
    name: a.name,
    version: a.version,
    purl,
    licenses: a.license ? [{ license: { id: a.license } }] : [],
    description: '로컬 모델·사내 게이트웨이 전용 코딩 에이전트 CLI',
  };

  return {
    bomFormat: 'CycloneDX',
    specVersion: CDX판,
    serialNumber: `urn:uuid:${serial ?? randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: at.toISOString(),
      component: 본체,
      tools: [{ vendor: 'deel', name: 'deel pack', version: a.version }],
      properties: [
        { name: 'deel:runtime', value: `node ${a.node}` },
        { name: 'deel:dependencies', value: String(a.deps.length) },
        { name: 'deel:devDependencies', value: String(a.devDeps.length) },
        { name: 'deel:installScripts', value: a.lifecycle.length ? a.lifecycle.join(',') : 'none' },
      ],
    },
    // 파일마다 하나씩. 담긴 것이 담겨야 할 것과 같은지 여기서 대조한다.
    components: a.files.map((f) => ({
      type: 'file',
      'bom-ref': `file:${f.path}`,
      name: f.path,
      hashes: [{ alg: 'SHA-256', content: f.sha }],
      properties: [{ name: 'deel:bytes', value: String(f.bytes) }],
    })),
    /*
     * 0개를 0개라고 적는다.
     *
     * dependencies 를 아예 빼면 스캐너가 "안 적어 낸 것" 과 "없는 것" 을
     * 구별하지 못한다. 빈 배열을 명시하면 '없다' 가 주장으로 남는다.
     */
    dependencies: [{ ref: purl, dependsOn: [] }],
  };
}

/**
 * 나가는 길.
 *
 * 소스에서 찾은 자리와, 그 자리에 걸어 둔 정책을 같이 싣는다. 정책만 적으면
 * 믿을 근거가 없고, 자리만 적으면 무슨 뜻인지 알 수 없다.
 */
export function 통신명세(a) {
  const 자리 = (id) => (a.calls?.[id] ?? []).map((x) => `${x.file}:${x.line}`);
  return {
    나가는길: [
      {
        갈래: '모델 게이트웨이',
        언제: '사람이 한마디 할 때마다',
        어디로: 'deel setup 에서 정한 주소 딱 한 곳',
        무엇이: '오간 말과, 모델이 읽은 파일 내용',
        막는법: 'src/safety/network.js 가 요청마다 허용 목록을 확인합니다. 목록에 없으면 요청 자체를 만들지 않습니다.',
        프록시: 'HTTPS_PROXY(또는 설정의 proxy)가 있으면 그 프록시를 거칩니다(CONNECT 터널). 목적지 허용 목록은 그대로이고, 이 컴퓨터 안 주소는 프록시를 안 탑니다.',
        소스: 자리('net'),
      },
      {
        갈래: '웹 읽기 (WebFetch)',
        언제: '모델이 그 도구를 부를 때만',
        어디로: '모델이 고른 주소. 이 컴퓨터·사내망 대역은 거절합니다',
        무엇이: '아무것도 — GET 만 쓰므로 본문을 실어 보내지 않습니다',
        막는법: '--offline 이면 통째로 막힙니다.',
        소스: 자리('net'),
      },
      {
        갈래: '플러그인 받기',
        언제: '사람이 /plugin install 을 칠 때만',
        어디로: 'github.com',
        무엇이: '아무것도',
        막는법: '--offline 이면 통째로 막힙니다.',
        소스: 자리('net'),
      },
    ],
    여는포트: {
      개수: (a.calls?.listen ?? []).length,
      쓰임: '만든 웹을 그 자리에서 띄워 보는 /preview 하나뿐입니다. 127.0.0.1 에만 붙고 명령이 끝나면 닫습니다.',
      소스: 자리('listen'),
    },
    바깥명령: {
      개수: (a.calls?.exec ?? []).length,
      쓰임: '사람·모델이 지시한 명령, MCP 서버 띄우기, 플러그인 받을 때의 git.',
      소스: 자리('exec'),
    },
    문자열실행: {
      개수: (a.calls?.eval ?? []).length,
      쓰임: '없어야 정상입니다.',
      소스: 자리('eval'),
    },
    // 자물쇠를 걸면 무엇이 닫히는가. 담당자가 제일 자주 묻는 것이다.
    offline일때: [
      '웹 읽기(WebFetch)가 막힙니다.',
      '플러그인 받기가 막힙니다.',
      'MCP 서버를 띄우지 않습니다 — 자식 프로세스가 어디로 나가는지 우리는 못 막습니다.',
      '모델 게이트웨이는 그대로 씁니다. 그 주소가 이 컴퓨터 안이면 아무것도 밖으로 안 나갑니다.',
    ],
  };
}

/**
 * 감사기록 사양.
 *
 * 이걸 안 주면 담당자가 "로그가 남긴 남나요" 만 확인하고 끝난다. 칸 이름과
 * 뜻을 주면 그대로 SIEM 수집 규칙을 짤 수 있다 — '자율 실행을 허가할 수
 * 있는가' 의 답이 대개 여기서 갈린다.
 *
 * 손으로 적은 목록이라 진짜와 어긋날 수 있다. 그래서 검사가 Audit 이 실제로
 * 남긴 줄과 대조한다.
 */
export function 감사명세() {
  return {
    자리: '<작업폴더>/.deel/audit.jsonl',
    형식: 'JSON Lines (UTF-8, 한 줄에 기록 하나)',
    쌓이는법: '덧붙이기만 합니다. 지우거나 고치지 않습니다.',
    보관: 'deel 이 지우지 않습니다. 보관 기간은 조직 정책대로 두시면 됩니다.',
    줄마다: [
      { 칸: 'at', 뜻: '언제 (ISO 8601, UTC)' },
      { 칸: 'session', 뜻: '어느 대화인지. 켠 시각으로 만든 번호' },
      { 칸: 'kind', 뜻: '무슨 기록인지 — 아래 목록' },
    ],
    종류: [
      { kind: 'turn', 뜻: '사람이 시킨 말', 칸: ['text'], 비고: '앞 500자만 남습니다' },
      { kind: 'tool', 뜻: '도구를 부른 것', 칸: ['tool', 'target', 'ok', 'note'], 비고: 'target 은 파일 경로·명령·찾을 말' },
      { kind: 'blocked', 뜻: '안전장치가 막은 것', 칸: ['why', 'what'], 비고: '막힌 명령이 그대로 남습니다' },
      { kind: 'undo', 뜻: '되돌린 것', 칸: ['files', 'turns'] },
    ],
    안남기는것: [
      '열쇠·암호. 설정의 apiKey 도, 엑셀 암호도 기록에 안 들어갑니다.',
      '파일 내용 전체. 무엇을 만졌는지는 남고 무엇이 적혔는지는 안 남습니다.',
      '모델이 한 답. 그건 대화 기록(.deel/sessions)에 따로 남습니다.',
    ],
  };
}

/**
 * 세 가지를 한 덩이로. zip 에 이대로 들어간다.
 */
export function 심사명세(a, { at = new Date() } = {}) {
  return {
    만든것: a.name,
    판: a.version,
    라이선스: a.license,
    실행환경: `Node ${a.node} (표준 내장 기능만)`,
    만든때: at.toISOString(),
    의존성: {
      dependencies: a.deps,
      devDependencies: a.devDeps,
      설치스크립트: a.lifecycle,
      소스의외부import: a.외부모듈,
      한마디: a.deps.length === 0 && a.외부모듈.length === 0
        ? '남의 코드를 함께 들여오지 않습니다. node: 내장과 자기 파일만 부릅니다.'
        : '외부 모듈이 있습니다 — 위 목록을 확인하세요.',
    },
    통신: 통신명세(a),
    감사기록: 감사명세(),
    파일: a.files.map((f) => ({ 경로: f.path, 바이트: f.bytes, sha256: f.sha })),
  };
}

/** 사람이 읽을 짧은 요약. 화면에 찍는 자리에서 쓴다. */
export function 명세요약(명세) {
  const m = 명세 ?? {};
  return [
    `SBOM 부품     ${(m.파일?.length ?? 0).toLocaleString()}개 (전부 SHA-256 붙임)`,
    `의존성        ${(m.의존성?.dependencies?.length ?? 0)}개 · 설치 스크립트 ${(m.의존성?.설치스크립트?.length ?? 0)}개`,
    `나가는 길     ${(m.통신?.나가는길?.length ?? 0)}갈래 · 여는 포트 ${(m.통신?.여는포트?.개수 ?? 0)}곳`,
    `감사기록      ${(m.감사기록?.종류?.length ?? 0)}종류 · ${m.감사기록?.자리 ?? ''}`,
  ].join('\n');
}

/**
 * MCP(Model Context Protocol) 서버 붙이기 — stdio 규격, 그리고 streamable HTTP (2.1.3).
 *
 * 무엇인가:
 *   도구를 **코드를 안 고치고** 밖에서 붙이는 규격이다. 사내 위키 검색기,
 *   사내 이슈 트래커, DB 조회기 같은 것을 각 팀이 MCP 서버로 만들어 두면
 *   deel 은 그걸 그대로 도구로 쓴다. 우리가 매번 도구를 새로 만들지 않아도 된다.
 *
 * 왜 의존성 없이 되나:
 *   stdio 규격은 자식 프로세스의 stdin/stdout 에 **줄 단위 JSON-RPC 2.0** 을
 *   주고받는 것이 전부다. child_process 와 JSON 이면 된다. SDK 가 필요 없다.
 *
 * ── 안전에 대해 ────────────────────────────────────────────────────────
 *
 * MCP 서버는 **남의 프로그램**이다. 이 프로젝트가 존재하는 이유가 '미승인 SW
 * 반입 금지' 인데, MCP 를 아무렇게나 켜면 그 선을 우리 손으로 무너뜨리는 셈이다.
 * 그래서:
 *
 *   1) **기본은 꺼져 있다.** .deel/mcp.json 에 사람이 직접 적어야만 뜬다.
 *   2) **--offline 이면 아예 안 띄운다.** 자식 프로세스가 어디로 나가는지
 *      우리는 못 막는다. 막을 수 없는 것을 막았다고 말하지 않는다.
 *   3) **감사기록에 남긴다.** 무엇을 띄웠고 무엇을 불렀는지.
 *   4) **작업 범위 밖이다.** MCP 서버는 우리 scope 를 안 지킨다 —
 *      제 마음대로 파일을 읽고 쓸 수 있다. /mcp 화면에서 그렇다고 말한다.
 *
 * ── HTTP 로 붙는 서버 (2.1.3) ─────────────────────────────────────────
 *
 * 사내 MCP 서버는 점점 **주소 하나**로 온다 — 팀마다 띄워 둔 위키·이슈 서버에 `url` 로
 * 붙는다. 그런 줄을 「url 로 붙는 서버는 아직 못 붙입니다」 로 돌려보냈다.
 *
 * 이제 붙는다. 다만 새 문을 내지 않는다 — 요청은 전부 backend/http.js 의 원시요청 으로
 * 나가고, 그러니 **문지기(safety/network.js)를 한 홉마다 지난다.** 적어 둔 그 집만 요청하는
 * 동안 잠깐 열고(allowTemporarily) 닫는다. 그래서 stdio 와 달리 오프라인 잠금 중에도
 * 막을 수 있다 — 이 컴퓨터 안(사내망 포함, 문지기와 같은 잣대)이면 붙고, 밖이면 안 붙는다.
 * 프록시 · 우리 인증서(mTLS) · 되돌림 검사도 모델 창구와 같은 길을 탄다.
 *
 * 규격은 initialize 로 인사하는 streamable HTTP(2025-03-26 ~ 2025-11-25)다. 인사 없이
 * 부르는 새 규격(2026-07-28)만 받는 서버는 인사에 받는 규격을 적어 돌려주고, 그 말을 그대로
 * 보여 준다. 옛 HTTP+SSE 규격(`"type": "sse"`)은 받지 않는다.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, normalize, isAbsolute, resolve } from 'node:path';
import { VERSION } from '../version.js';
// 남의 저장소에 딸려 온 mcp.json 으로 남의 프로그램을 띄우지 않는다 (다붙이기 머리말).
import { 믿나, BOM떼기 } from '../safety/trust.js';
// 신호로 끝날 때도 띄운 서버를 거둔다 — 손은 한 자리에만 단다 (reap.js 머리말).
import { 신호에거두기 } from '../reap.js';
// HTTP 로 붙는 서버도 나가는 문은 하나다 (위 머리말).
import { 원시요청, 몸읽기 } from './http.js';
import { allowTemporarily, isLocalHost } from '../safety/network.js';

// 붙는 데 이만큼 넘게 걸리면 포기한다. 시작이 느려지면 안 쓰게 된다.
const 붙기제한 = 8000;
// 쓰던 서버가 저 혼자 죽으면 한 세션에 이만큼까지 다시 띄운다 (MCP서버.깨우기 머리말).
export const 되살리기최대 = 2;
// 도구 하나 부르고 이만큼 기다린다.
export const 부르기제한 = 60000;
// 한 서버에서 받을 도구 수. 스키마가 통째로 매 요청에 실리므로 무한정 받으면
// 컨텍스트가 조용히 줄어든다. 넘으면 **넘었다고 말하고** 자른다.
export const 도구최대 = 24;
// 한 줄(JSON 한 통)의 최대 크기. 미친 서버가 stdout 을 쏟아부어도 안 죽게.
const 줄최대 = 4 * 1024 * 1024;
// tools/list 를 몇 쪽까지 따라갈까. 끝없이 다음 쪽을 주는 서버에 붙들리지 않게.
const 목록쪽최대 = 10;
// 서버가 낸 프롬프트를 이만큼까지 받는다 (2.1.3). 슬래시 명령으로 서므로 끝없으면 /mcp 가 덮인다.
export const 프롬프트최대 = 50;
// 자료(resource) 목록을 이만큼까지 모델에게 싣는다.
const 자료최대 = 200;
/*
 * 서버가 자료(resources)를 낸다고 하면 붙이는 **우리** 도구의 이름 (2.1.3).
 *
 * MCP 의 자료는 도구가 아니라 읽을거리다 — 문서 서버가 제 문서를 `docs://…` 로 내놓는 식이다.
 * 도구로만 부를 수 있는 모델에게 그 길을 하나 낸다. 서버에 같은 이름의 제 도구가 있으면 그쪽이 이긴다.
 */
export const 자료도구이름 = 'read_resource';
const 자료도구정의 = () => ({
  name: 자료도구이름,
  description: 'Read a resource this MCP server exposes (documents, files, records). Call without uri to list what is available.',
  inputSchema: { type: 'object', properties: { uri: { type: 'string', description: 'URI of the resource to read. Omit to list resources.' } } },
  // 읽기만 한다 — confirm 이 안 묻는다(읽기만하나). 우리가 붙인 것이라는 표는 x-deel 이다.
  annotations: { readOnlyHint: true },
  'x-deel': 'resources',
});

export const 설정자리 = (root) => join(root, '.deel', 'mcp.json');

/*
 * ── 도구 목록을 적어 둔다 (지연 로딩) ─────────────────────────────────
 *
 * 여태는 켤 때 적힌 서버를 **전부** 띄웠다. 그래야 모델에게 넘길 도구 목록을
 * 알 수 있으니까. 그런데 그 목록은 **거의 안 바뀐다.** 사내 위키 검색기의
 * 도구 이름은 지난달에도 같았고 다음달에도 같을 것이다.
 *
 * 그 변하지 않는 것을 알자고 매번 서버 네다섯 대를 띄우고, 악수를 두 번씩
 * 하고, 사람은 그동안 빈 화면을 본다. 서버 넷이면 2초가 넘고, 그건 `deel` 을
 * 칠 때마다다.
 *
 * 그래서 목록을 적어 둔다. 다음부터는 **그 도구를 정말 부를 때** 띄운다.
 *
 * 적어 둔 것이 진짜와 어긋나는 자리를 세 겹으로 막는다.
 *
 *   1) **지문**이 다르면 안 쓴다. 명령·인자·폴더·환경이 한 글자라도 바뀌었으면
 *      다른 서버다. 설정을 고치고 「왜 안 바뀌지」 를 겪는 일이 없어야 한다.
 *   2) **일주일**이 지나면 안 쓴다. 도구가 늘어나는 서버도 있고, 영영 안 띄우면
 *      그걸 영영 모른다. 늘어나지 않는 것을 전제로 깔면 안 된다.
 *   3) 정말 띄운 뒤에 **맞춰 본다.** 다르면 그 자리에서 고쳐 적고, 부른 도구가
 *      없어졌으면 그렇다고 말한다 — 「없는 도구」 로 뭉뚱그리지 않는다.
 */
export const 메모자리 = (root) => join(root, '.deel', 'mcp-tools.json');
/** 적어 둔 목록을 이만큼 지나면 다시 띄워 확인한다. */
export const 메모유효 = 7 * 24 * 60 * 60 * 1000;

/** 이 서버가 「같은 서버」 인가를 가르는 값. */
export function 지문(설정) {
  // HTTP 로 붙는 서버는 주소와 머리말이 곧 그 서버다. stdio 의 재료는 그대로 둔다 — 바꾸면 적어 둔 메모가 다 헌것이 된다.
  const 재료 = 설정.방식 === 'http' ? JSON.stringify(['http', 설정.url, Object.entries(설정.headers ?? {}).sort(([a], [b]) => a.localeCompare(b))]) : JSON.stringify([
    설정.command, 설정.args ?? [], 설정.cwd ?? '',
    Object.entries(설정.env ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  return createHash('sha256').update(재료).digest('hex').slice(0, 16);
}

/** 적어 둔 목록을 읽는다. 못 읽으면 빈 것으로 본다 — 그러면 그냥 띄운다. */
export function 메모읽기(root) {
  try {
    /*
     * BOM 을 뗀다(safety/trust.js 의 BOM떼기). 못 읽으면 빈 것으로 보는 자리라
     * 넘어져도 아무 말이 없다 — 대신 **매번 서버를 다시 띄워서** 지연 로딩이
     * 조용히 꺼진다. 메모를 편집기나 스크립트로 한 번 만지면 앞에 U+FEFF 가 붙는다.
     */
    const j = JSON.parse(BOM떼기(readFileSync(메모자리(root), 'utf8')));
    return j?.servers && typeof j.servers === 'object' ? j.servers : {};
  } catch { return {}; }
}

/**
 * 적어 둔다. 못 적어도 던지지 않는다 — 다음번에 다시 띄우면 그만이다.
 *
 * ── 이미 적혀 있던 것을 지우지 않는다 ──────────────────────────────────
 *
 * 여기가 파일을 **통째로 새로** 썼다. 그런데 부르는 쪽은 이번에 정말 띄운
 * 것만 넘긴다(대기 중인 것은 적은때를 새로 찍으면 「일주일이면 다시 본다」
 * 가 영영 안 오므로 일부러 뺀다). 둘이 합쳐지면 **대기 중이던 서버의 메모가
 * 지워진다.**
 *
 * 서버 A·B 를 쓰다가 B 의 설정만 고치면 — 그 판에서 A 는 대기, B 는 새로
 * 뜸 → A 의 메모가 날아간다. 다음 판에는 A 를 띄우고 B 가 대기 → 이번엔
 * B 가 날아간다. 그 뒤로 **매번 서버 하나가 반드시 즉시 뜬다.** 지연 로딩이
 * 없애려던 기동 지연(위 머리말의 「서버 넷이면 2초」)이 영구히 돌아오는데,
 * 화면에는 ● 하나 ◐ 하나가 떠서 설정을 안 고쳤는데 왜 매번 남의 프로세스가
 * 뜨는지 알 길이 없다.
 *
 * 그래서 **겹쳐 쓴다.** 넘긴 것만 갈아 끼우고 나머지는 적힌 그대로 둔다.
 *
 * @param 남길이름 지금 설정에 있는 서버 이름들. 주면 설정에서 빠진 서버의
 *   메모를 걷는다 — 안 걷으면 지운 서버가 파일에 영영 쌓인다.
 */
export function 메모쓰기(root, 서버들, { 남길이름 = null } = {}) {
  const 있던것 = 메모읽기(root);
  const servers = {};
  for (const [이름, 것] of Object.entries(있던것)) {
    if (남길이름 && !남길이름.includes(이름)) continue;
    servers[이름] = 것;
  }
  for (const s of 서버들) {
    if (!s.도구?.length) continue;   // 못 띄운 것은 안 적는다
    servers[s.이름] = {
      지문: 지문(s.설정),
      적은때: Date.now(),
      정보: s.정보 ?? null,
      잘림: s.잘림 ?? 0,
      도구: s.도구,
      // 프롬프트는 슬래시 명령으로 선다 — 대기 중에도 /mcp 와 /mcp__… 가 알아야 한다 (2.1.3).
      프롬프트: s.프롬프트 ?? [],
    };
  }
  /*
   * 남는 것이 하나도 없어도 **적힌 것이 있었으면 적는다.**
   *
   * 여기서 그냥 돌아섰다. 그런데 이 함수는 적기만 하는 것이 아니라 위에서 설정에서
   * 빠진 서버를 **걷기도** 한다. 걷고 나서 아무것도 안 남는 판(설정의 서버를 다
   * 빼거나, 남은 한 대가 도구 0개로 떴을 때)에서는 그 걷기가 통째로 취소돼서 지운
   * 서버의 메모가 파일에 영영 남았다 — 다음 판에 지연 로딩이 그 이름으로 도구 목록을
   * 도로 세운다. 처음부터 아무것도 안 적혀 있던 때만 안 적는다.
   */
  if (!Object.keys(servers).length && !Object.keys(있던것).length) return false;
  try {
    mkdirSync(join(root, '.deel'), { recursive: true });
    writeFileSync(메모자리(root), JSON.stringify({ version: 1, servers }, null, 2) + '\n', 'utf8');
    return true;
  } catch { return false; }
}

/** 이 설정에 쓸 수 있는 메모인가. 아니면 null — 부르는 쪽은 그러면 띄운다. */
export function 쓸만한메모(메모, 설정, 이제 = Date.now()) {
  if (!메모 || !Array.isArray(메모.도구) || !메모.도구.length) return null;
  if (메모.지문 !== 지문(설정)) return null;
  if (이제 - Number(메모.적은때 ?? 0) >= 메모유효) return null;
  return 메모;
}

/**
 * 설정을 읽는다. Claude Code 의 `mcpServers` 모양을 그대로 받는다 —
 * 이미 쓰던 설정을 복사해 붙일 수 있어야 한다.
 */
export function 설정읽기(root, { env = process.env } = {}) {
  const p = 설정자리(root);
  if (!existsSync(p)) return { 서버들: [], 자리: p, 있음: false };
  let j;
  // BOM 을 뗀다 — 파워셸 5.1 로 저장한 mcp.json 이 「못 읽었습니다」 가 되어 서버가 통째로 안 떴다.
  // 설정·훅·정책은 이미 떼고 있었고 여기만 빠져 있었다(safety/trust.js 의 BOM떼기).
  try { j = JSON.parse(BOM떼기(readFileSync(p, 'utf8'))); } catch (e) {
    return { 서버들: [], 자리: p, 있음: true, 오류: `mcp.json 을 못 읽었습니다: ${e.message}` };
  }
  /*
   * JSON 으로는 멀쩡해도 **표가 아닐** 수 있다 (6회차 Gemini 엠씨피 M5).
   *
   * `null` 은 위 parse 를 지나 `null.mcpServers` 에서 TypeError 로 던졌다 — 이 함수를 부르는
   * 자리가 통째로 넘어진다. `"mcpServers": [ … ]` 는 배열 번호 `0` 이 서버 이름이 됐다.
   * 깨진 JSON 과 같이 「못 읽었습니다」 로 까닭을 돌려준다.
   */
  const 표아님 = (v) => v === null || typeof v !== 'object' || Array.isArray(v);
  if (표아님(j)) return { 서버들: [], 자리: p, 있음: true, 오류: 'mcp.json 을 못 읽었습니다: 맨 바깥이 { … } 표가 아닙니다' };
  const 표 = j.mcpServers ?? j.servers ?? {};
  if (표아님(표)) {
    return { 서버들: [], 자리: p, 있음: true, 오류: 'mcp.json 을 못 읽었습니다: mcpServers 는 { "이름": { "command": … } } 모양의 표여야 합니다' };
  }
  const 서버들 = [];
  /*
   * ── 안 받는 항목도 **적어서 내놓는다** ────────────────────────────────
   *
   * 여기서 그냥 `continue` 했다. 그러면 적어 둔 서버가 화면 어디에도 안
   * 나온다 — 켤 때 뜨는 줄은 붙은 것만 세고(repl.js), `/mcp` 목록도 붙은 것만
   * 세운다. 사람 쪽에서는 **목록이 완전해 보인다.**
   *
   * 이 파일이 제일 흔하게 받는 것이 다른 도구의 설정을 그대로 붙여넣은
   * 것이고, 거기에는 `"type": "sse"` 나 `url` 만 있는 항목이 섞여 있다.
   * 그게 조용히 사라지면 「왜 그 도구가 없지」 를 영영 알 수 없다 — 아래
   * 다붙이기 머리말이 스스로 약속한 바로 그 자리다. 못 뜬 다른 갈래들
   * (오프라인·안 믿는 폴더)은 다 적어서 내놓는데 여기만 안 적었다.
   *
   * `disabled` 는 안 적는다. 그건 사람이 스스로 끈 것이라 알려 줄 것이 없다.
   */
  const 못받은것 = [];
  for (const [이름, v] of Object.entries(표)) {
    if (v?.disabled === true) continue;
    /*
     * ── 무엇으로 붙나 (2.1.3) ─────────────────────────────────────────────
     *
     * stdio(command) 와 streamable HTTP(url) 를 받는다. HTTP 는 나가는 문 하나(backend/http.js)로
     * 나가서 자물쇠가 한 홉마다 본다(파일 머리말). `type` 을 안 적고 `url` 만 적은 것도 HTTP 로
     * 본다 — 다른 도구의 설정은 흔히 그렇게 적는다. 다만 주소가 `/sse` 로 끝나면 옛 HTTP+SSE
     * 규격의 창구라, 붙여 보고 알 수 없는 탈을 내느니 여기서 까닭을 말한다(type 을 적으면 믿는다).
     */
    const 갈래 = typeof v?.type === 'string' ? v.type.trim().toLowerCase() : '';
    const 주소 = v?.url ?? v?.serverUrl;
    const 웹 = /^(?:http|streamable-?http|streamablehttp)$/.test(갈래) || (!갈래 && !v?.command && !!주소);
    if (갈래 === 'sse') {
      못받은것.push({ 이름, 왜: '옛 "sse" 규격(HTTP+SSE)은 못 붙입니다 — stdio(command)와 streamable HTTP("type": "http")를 받습니다' });
      continue;
    }
    if (갈래 && 갈래 !== 'stdio' && !웹) {
      못받은것.push({ 이름, 왜: `"${v.type}" 규격은 못 붙입니다 — stdio(command)와 streamable HTTP("type": "http", url)를 받습니다` });
      continue;
    }
    if (웹 && !갈래 && /\/sse\/?(?:[?#].*)?$/i.test(String(주소))) {
      못받은것.push({ 이름, 왜: '주소(url)가 /sse 로 끝납니다 — 옛 HTTP+SSE 규격의 창구로 보입니다. 서버가 streamable HTTP 도 내면 보통 /mcp 입니다 — 그 주소를 적거나 "type": "http" 를 적어 주세요' });
      continue;
    }
    if (!웹 && !v?.command) {
      못받은것.push({ 이름, 왜: 'command 가 없습니다 — 무엇을 띄울지(command) 나 어디에 붙을지(url) 적어야 합니다' });
      continue;
    }
    /*
     * ── 도로 못 가르는 이름은 안 받는다 (사냥4 W13) ──────────────────────
     *
     * 모델에게는 `mcp__<서버>__<도구>` 로 보이고, 부르면 이름풀기 가 그 이름을 도로
     * 가른다. 서버 이름에 `__` 가 들었거나 `_` 로 시작·끝나면 가르는 자리가 어긋난다 —
     * `my__srv` 의 도구는 「my 서버가 붙어 있지 않습니다」, `_srv` 는 「MCP 도구 이름
     * 꼴이 아닙니다」 가 됐다. 목록에는 멀쩡히 서고 부르면 없다고 하는, 제일 알아채기
     * 어려운 꼴이다. 이름풀기 가 받는 꼴(밑줄 **하나로만** 이은 낱말)과 같은 잣대로 거른다.
     * 이름풀기 를 느슨하게 고치는 대신 여기서 막는 까닭 — 도구 이름에도 `__` 가 올 수 있어
     * (`a_b` 서버의 `c__d`) 어느 쪽 `__` 에서 갈라야 할지 이름만으로는 영영 모른다.
     */
    if (!/^[^_]+(?:_[^_]+)*$/.test(이름)) {
      못받은것.push({ 이름, 왜: '서버 이름에 `__` 가 들었거나 `_` 로 시작·끝납니다 — 모델에게 보이는 mcp__<서버>__<도구> 를 도로 가를 수 없어 부를 수 없습니다. 이름을 바꿔 주세요' });
      continue;
    }
    if (웹) {
      /*
       * `${이름}` 은 환경변수로 편다 — 열쇠를 저장소에 적어 두지 않게 (Claude Code 와 같은 꼴,
       * `${이름:-기본}` 도). 주소와 머리말에서만 편다. 없는 변수를 빈 글로 펴서 보내면 열쇠 없는
       * 요청이 401 로 돌아오고, 사람은 서버를 의심한다 — 없으면 없다고 여기서 말한다.
       */
      const 없는것 = new Set();
      const 펴기 = (글) => String(글).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, 변수, 기본) => {
        const 값 = env?.[변수];
        if (값 != null && 값 !== '') return 값;
        if (기본 !== undefined) return 기본;
        없는것.add(변수);
        return '';
      });
      const url = 펴기(주소);
      const headers = {};
      if (v.headers && typeof v.headers === 'object' && !Array.isArray(v.headers)) {
        for (const [k, 값] of Object.entries(v.headers)) if (값 != null) headers[k] = 펴기(값);
      }
      if (없는것.size) {
        못받은것.push({ 이름, 왜: `환경변수 ${[...없는것].join(' · ')} 가 없습니다 — mcp.json 의 \${…} 를 채울 수 없어 붙지 않습니다` });
        continue;
      }
      /*
       * HTTP 머리말에 못 싣는 것은 여기서 말한다. 한글 이름·값을 그대로 두면 붙을 때 「Cannot convert
       * argument to a ByteString」 한 줄로 넘어진다 — 무엇이 틀렸는지 사람이 읽을 수 없는 말이다.
       */
      const 틀린머리 = Object.entries(headers).find(([k, 값]) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k) || /[^\t\x20-\x7e\x80-\xff]/.test(값));
      if (틀린머리) {
        못받은것.push({ 이름, 왜: `머리말 ${틀린머리[0]} 는 HTTP 머리말에 실을 수 없습니다 — 이름은 영문·숫자·-, 값은 영문 글자만 됩니다(한글·줄바꿈 안 됨)` });
        continue;
      }
      let 읽은주소 = null;
      try { 읽은주소 = new URL(url); } catch { /* 아래에서 말한다 */ }
      if (!읽은주소 || !/^https?:$/.test(읽은주소.protocol)) {
        못받은것.push({ 이름, 왜: `url 이 http(s) 주소가 아닙니다: ${url.slice(0, 120)}` });
        continue;
      }
      서버들.push({ 이름, 방식: 'http', url: 읽은주소.href, headers });
      continue;
    }
    서버들.push({
      이름,
      command: String(v.command),
      args: Array.isArray(v.args) ? v.args.map(String) : [],
      env: v.env && typeof v.env === 'object' ? v.env : null,
      cwd: v.cwd ? String(v.cwd) : root,
    });
  }
  return { 서버들, 못받은것, 자리: p, 있음: true };
}

/*
 * ── 지금 띄워 둔 서버들 ─────────────────────────────────────────────────
 *
 * 여기 왜 명부가 있나. MCP 서버는 붙인 쪽(repl·ACP)이 들고 있을 뿐이라,
 * 프로그램이 어느 길로든 끝나 버리면 **아무도 안 닫는다.** 그러면 사람
 * 컴퓨터에 서버 프로세스가 하나씩 쌓인다 — 작업 관리자를 열기 전에는
 * 모르는 종류의 탈이다.
 *
 * 일감(tools/jobs.js)과 언어 서버(lsp/client.js)에는 이미 이 그물이 있는데
 * 여기만 없었다. 같은 자리, 같은 규칙으로 둔다.
 */
const 띄운것들 = new Set();

/** 검사와 진단이 본다. 지금 살아 있는 서버 수. */
export function 살아있는수() { return 띄운것들.size; }

/**
 * 다 닫는다. 프로그램이 끝날 때와 검사 뒤에 부른다.
 * @returns {number} 닫은 개수
 */
export function 모두닫기() {
  const 것들 = [...띄운것들];
  띄운것들.clear();
  let n = 0;
  for (const s of 것들) { try { s.닫기(); n++; } catch { /* 끝나는 중이라 할 수 있는 게 없다 */ } }
  return n;
}

/*
 * 어떤 길로 끝나든 남기지 않는다. 붙인 쪽이 이미 닫았어도 무해하다.
 *
 * 이름 있는 함수를 그대로 건다 — 이름 없는 화살표로 걸면 그물이 걸려 있는지
 * 검사가 밖에서 확인할 길이 없다. 걷어내도 아무도 모르는 그물은 없는 것과 같다.
 */
process.once('exit', 모두닫기);
신호에거두기(모두닫기);

/**
 * 약속을 기다리되 신호가 오면 **기다리기만** 그만둔다. 약속 자체는 안 끊는다 (부르기 · MB4).
 */
function 끊기며기다리기(약속, signal) {
  if (!signal) return 약속;
  if (signal.aborted) return Promise.reject(new Error('중단했습니다'));
  let 떼기 = () => {};
  const 끊김 = new Promise((_, 실패) => {
    const 손 = () => 실패(new Error('중단했습니다'));
    signal.addEventListener?.('abort', 손, { once: true });
    떼기 = () => signal.removeEventListener?.('abort', 손);
  });
  return Promise.race([약속, 끊김]).finally(() => 떼기());
}

/**
 * 서버 하나와의 연결.
 *
 * 규격은 JSON-RPC 2.0 이다. 줄 하나에 통 하나 — 그래서 줄 단위로 자르면 된다.
 */
export class MCP서버 {
  constructor(설정) {
    this.이름 = 설정.이름;
    this.설정 = 설정;
    this.kid = null;
    this.다음번호 = 1;
    this.기다리는것 = new Map();
    this.찌꺼기 = '';
    this.도구 = [];
    this.정보 = null;
    this.죽음 = null;      // 왜 죽었나 (사람에게 보여 줄 말)
    this.잘림 = 0;         // 도구최대 를 넘어 자른 개수
    this.넘침 = false;     // 한 통이 줄최대 를 넘어 귀를 닫았나 (받음)
    this.셸로띄움 = false; // 윈도우에서 cmd.exe 를 거쳐 띄웠나 (띄울모양 · 닫기)
    /*
     * 적어 둔 목록으로 서 있는 상태 — 아직 안 띄웠다.
     *
     * `살아있나()` 와 갈라 둔다. 저건 「지금 프로세스가 떠 있나」 라는 사실이고
     * 이건 「쓸 수 있나」 라는 판단이다. 하나로 뭉개면 화면이 대기 중인 서버를
     * 「죽었다」 고 적게 되는데, 그건 사람을 없는 탈로 보낸다.
     */
    this.대기 = false;
    /** 깨우는 중인 약속. 도구 둘을 한꺼번에 불러도 한 번만 띄우려는 것이다. */
    this.깨우는중 = null;
    /** 깨우고 나서 목록이 달라졌으면 그 사실. 화면이 이걸 말한다. */
    this.달라짐 = null;
    /*
     * 메모를 어디에 적나. 메모로세우기() 가 넣어 준다.
     *
     * 설정.cwd 로 갈음할 수 없다 — 사람이 cwd 를 따로 적어 두면 그것은
     * 폴더 뿌리가 아니고, 그러면 남의 폴더에 메모를 적는다.
     */
    this.뿌리 = null;
    /** 저 혼자 죽어 다시 띄운 수. 되살리기최대 를 넘으면 더 안 띄운다. */
    this.되살린수 = 0;
    /** 우리가 닫았나(닫기). 닫은 것은 되살리지 않는다. */
    this.닫음 = false;
    /** 인사에서 서버가 고른 규격 판 · 서버가 낸다고 한 것(capabilities) · 서버의 프롬프트 (2.1.3). */
    this.규격 = null;
    this.능력 = {};
    this.프롬프트 = [];
  }

  /** 인사에서 청할 규격 판. stdio 는 예전 그대로 둔다 — 바꾸면 이미 쓰던 서버의 대답 꼴이 달라질 수 있다. */
  get 청할규격() { return '2024-11-05'; }

  /** 서버가 자료를 내서 우리가 read_resource 를 붙였나 (자료도구이름 머리말). */
  get 자료도구붙임() { return this.도구.some((t) => t?.['x-deel'] === 'resources'); }

  살아있나() { return !!this.kid && this.kid.exitCode === null && !this.죽음; }
  /** 지금 도구를 부를 수 있나. 대기 중이면 부르는 순간 뜬다. 저 혼자 죽은 것도 되살린다. */
  쓸수있나() { return this.살아있나() || (this.대기 && !this.죽음) || this.되살릴수있나(); }
  /**
   * 죽었지만 다음 부름에 다시 띄울 것인가 (깨우기 머리말).
   * 우리가 닫은 것(닫음)과 한 세션에 되살리기최대 번을 넘긴 것은 안 띄운다.
   */
  되살릴수있나() { return !!this.죽음 && !this.닫음 && !this.대기 && this.되살린수 < 되살리기최대; }

  /**
   * 적어 둔 목록으로 세워 둔다. **안 띄운다.**
   *
   * 여기서 하는 일은 「이 서버에 이런 도구가 있다고 지난번에 봤다」 를 들고
   * 있는 것뿐이다. 진짜로 뜨는 것은 그 도구를 처음 부를 때다(깨우기).
   */
  메모로세우기(메모, 뿌리 = null) {
    this.뿌리 = 뿌리;
    this.도구 = 메모.도구 ?? [];
    this.정보 = 메모.정보 ?? null;
    this.잘림 = 메모.잘림 ?? 0;
    this.프롬프트 = Array.isArray(메모.프롬프트) ? 메모.프롬프트 : [];
    this.대기 = true;
    return this;
  }

  /**
   * 대기 중이던 서버를 정말 띄운다.
   *
   * 띄운 뒤 목록을 **맞춰 본다.** 적어 둔 것과 다르면 그 사실을 들고 있다가
   * 화면과 부르는 쪽이 말하게 한다 — 조용히 갈아 끼우면, 모델이 방금 부른
   * 도구가 왜 없어졌는지 아무도 설명 못 한다.
   */
  async 깨우기({ timeout = 붙기제한 } = {}) {
    /*
     * 깨우는 중인지를 **먼저** 본다 (6회차 Gemini 엠씨피 MB1).
     *
     * 붙기 첫 줄에서 아이는 이미 떠 있어서, 인사(initialize)에 답이 오기 전에도 `살아있나()` 는
     * 참이다. 그걸 먼저 봤더니 함께 들어온 두 번째 부름이 곧장 true 를 받아 tools/call 을
     * 인사보다 먼저 보냈다 — 모델이 도구를 한꺼번에 둘 부르면 늘 나는 꼴이다.
     */
    if (this.깨우는중) return this.깨우는중;
    if (this.살아있나()) return true;
    /*
     * ── 쓰던 서버가 죽으면 **다음 부름에 다시 띄운다** (2.0.2 · M1 · MB3) ─────────
     *
     * 여기서 `죽음` 이면 곧장 false 였다. 그래서 아래 「죽음 을 지우고 다시 붙는다」 는 한 번도
     * 닿지 않는 줄이었고, 도중에 한 번 넘어진 서버(메모리 부족 · 제 오류로 끝남)는 세션 내내
     * 「죽었습니다」 였다 — 도구가 통째로 사라진 채 대화를 이어 가야 했다.
     *
     * 떠서 쓰던 서버가 **저 혼자** 죽었으면 되살린다. 한 세션에 되살리기최대 번까지만 —
     * 뜨자마자 죽는 서버를 부를 때마다 띄우면 부름마다 붙기제한만큼 멈춘다. 우리가 닫은 것
     * (넘침 · 깨우다 실패 · 끝날 때)은 안 되살린다(되살릴수있나).
     */
    if (this.죽음 && !this.되살릴수있나()) return false;
    const 되살림 = !!this.죽음;
    const 적어둔것 = this.도구.map((t) => t.name).join('\0');
    // 속까지 견주려면 정의를 그대로 들고 있어야 한다 (아래 바뀐것).
    const 적어둔도구 = this.도구;
    this.깨우는중 = (async () => {
      if (되살림) {
        this.되살린수++;
        // 옛 아이를 명부에서 빼고, 받다 만 조각은 버린다 — 새 아이의 첫 줄에 붙으면 안 된다.
        띄운것들.delete(this);
        try { this.kid?.kill(); } catch { /* 이미 죽었다 */ }
        this.찌꺼기 = '';
        this.마지막말 = undefined;
      }
      // 죽음 은 끝냄() 이 남긴다. 다시 붙으려면 지워 두고 시작한다.
      this.죽음 = null;
      const ok = await this.붙기({ timeout });
      this.대기 = false;
      this.깨우는중 = null;
      if (!ok) {
        /*
         * 못 깨웠으면 **거둔다** (사냥4 W12).
         *
         * 켤 때 붙는 길(다붙이기)은 실패하면 닫기() 를 부르는데, 여기는 안 불렀다. 그래서
         * initialize 에 끝내 답을 안 하는 서버는 「못 띄웠습니다」 로 끝난 **뒤에도** 살아
         * 명부에 남았다. 죽음 이 서서 다시 깨울 일도 없으니, 세션 내내 아무도 안 쓰는
         * 남의 프로세스 하나를 붙들고 있는 셈이다.
         */
        this.닫기();
        return false;
      }
      const 지금것 = this.도구.map((t) => t.name).join('\0');
      if (적어둔것 && 지금것 !== 적어둔것) {
        this.달라짐 = {
          늘어난것: this.도구.map((t) => t.name).filter((n) => !적어둔것.split('\0').includes(n)),
          없어진것: 적어둔것.split('\0').filter((n) => !this.도구.some((t) => t.name === n)),
        };
      }
      /*
       * ── 이름은 같은데 **속이 달라진** 도구 ─────────────────────────────
       *
       * 위 맞춰보기는 이름만 본다. 그런데 제일 조용한 어긋남은 이름이 그대로인
       * 쪽이다 — `wiki_search` 가 필수 인자 `repo` 를 새로 받기 시작하면,
       * 적어 둔 옛 스키마를 그대로 모델에게 실어 보내고 모델은 `repo` 없이
       * 부른다. 서버가 기본값으로 넘어가는 구현이면 **엉뚱한 저장소를 검색한
       * 그럴듯한 결과**가 돌아온다. 400 이 나는 것보다 나쁘다.
       */
      const 옛것 = new Map((적어둔도구 ?? []).map((t) => [t.name, JSON.stringify(t.inputSchema ?? null)]));
      const 바뀐것 = this.도구
        .filter((t) => 옛것.has(t.name) && 옛것.get(t.name) !== JSON.stringify(t.inputSchema ?? null))
        .map((t) => t.name);
      if (바뀐것.length) this.달라짐 = { 늘어난것: [], 없어진것: [], ...(this.달라짐 ?? {}), 바뀐것 };
      /*
       * ── 맞춰 본 것을 **적어 둔다** ─────────────────────────────────────
       *
       * 이 파일 머리말이 「정말 띄운 뒤에 맞춰 본다. 다르면 그 자리에서 고쳐
       * 적고」 라고 약속했는데, 「고쳐 적고」 가 없었다. 그래서 옛 목록이
       * **매 실행마다 다시** 모델에게 나갔다 — 지문이 같고 이레가 안 지났으니
       * 다음 판에도 같은 옛것을 쓰고, 같은 실패를 되풀이한다.
       *
       * 여기서 적은때를 새로 찍는 것은 맞다. 방금 **정말로 띄워서** 확인한
       * 목록이라, 이레 시계는 이 순간부터 세는 것이 옳다.
       */
      if (this.뿌리) { try { 메모쓰기(this.뿌리, [this]); } catch { /* 못 적어도 대화는 계속된다 */ } }
      return true;
    })();
    return this.깨우는중;
  }

  /**
   * 길을 연다 — stdio 는 여기서 아이를 띄운다. HTTP 는 열 것이 없다(MCP웹서버 가 갈음한다).
   * @returns {boolean} 못 열었으면 false (까닭은 죽음 에)
   */
  길열기() {
    try {
      // 설정에 적힌 env 만 얹는다. 우리 환경변수를 통째로 넘기면
      // 게이트웨이 열쇠(DEEL_*)까지 남의 프로세스로 넘어간다.
      const 환경 = { ...깨끗한환경(), ...(this.설정.env ?? {}) };
      // 윈도우의 .cmd · 확장자 없이 적은 `npx` 는 그대로는 못 띄운다 (띄울모양 머리말).
      const 모양 = 띄울모양(this.설정.command, this.설정.args, 환경, this.설정.cwd);
      this.셸로띄움 = 모양.셸;
      this.kid = spawn(모양.파일, 모양.인자, {
        cwd: this.설정.cwd,
        env: 환경,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        ...모양.옵션,
      });
    } catch (e) {
      this.죽음 = `띄우지 못했습니다: ${e.message}`;
      return false;
    }
    // 띄운 순간부터 명부에 든다. 악수(initialize)를 못 마쳐도 아이는 이미
    // 떠 있으므로, 여기서 안 적으면 그 아이는 아무도 안 거두는 아이가 된다.
    띄운것들.add(this);

    /*
     * **이 아이의** 소리만 듣는다 (2.0.2 · M1). 되살리면 한 서버에 아이가 둘 거쳐 간다 —
     * 옛 아이의 늦은 'exit' 이 새 아이를 죽음 으로 적거나, 옛 아이의 마지막 조각이 새 아이의
     * 첫 줄에 붙으면 안 된다.
     */
    const 아이 = this.kid;
    const 지금아이 = () => this.kid === 아이;
    아이.on('error', (e) => { if (지금아이()) this.끝냄(`오류: ${e.message}`); });
    아이.on('exit', (code, sig) => { if (지금아이()) this.끝냄(`끝났습니다 (코드 ${code ?? sig})`); });
    아이.stdout.setEncoding('utf8');
    아이.stdout.on('data', (d) => { if (지금아이()) this.받음(d); });
    // 서버가 stderr 에 로그를 쏟는 일이 흔하다. 화면에 흘리면 대화가 뒤덮인다.
    // 마지막 것만 들고 있다가 죽었을 때 원인으로 보여 준다.
    아이.stderr.setEncoding('utf8');
    아이.stderr.on('data', (d) => { if (지금아이()) this.마지막말 = String(d).trim().slice(-400); });
    return true;
  }

  async 붙기({ timeout = 붙기제한 } = {}) {
    if (!this.길열기()) return false;
    const 전체마감 = Date.now() + timeout;

    try {
      const r = await this.보내고기다리기('initialize', this.인사말(), timeout);
      this.정보 = r?.serverInfo ?? null;
      this.규격 = typeof r?.protocolVersion === 'string' ? r.protocolVersion : null;
      this.능력 = r?.capabilities && typeof r.capabilities === 'object' ? r.capabilities : {};
      // HTTP 는 이 알림이 닿은 뒤에 다음 물음을 보내야 한다 — 먼저 도착하면 받지 않는 서버가 있다.
      await this.알림('notifications/initialized', {});
    } catch (e) {
      this.끝냄(`규격 인사에 실패했습니다: ${e.message}`);
      return false;
    }

    try {
      /*
       * ── 목록이 여러 쪽으로 오는 서버 (사냥4 W10) ────────────────────────
       *
       * 규격상 tools/list 는 `nextCursor` 로 다음 쪽이 있다고 알린다. 첫 쪽만 받고
       * 끝냈더니, 도구를 쪽으로 나눠 주는 서버의 뒷쪽 도구가 **조용히** 빠졌다 — 잘림 도
       * 0 이라 /mcp 에도 「다 받았다」 로 보였다. 끝까지 따라가되, 같은 커서를 또 주거나
       * 끝없이 주는 서버에 붙들리지 않게 쪽 수(목록쪽최대)와 시한을 같이 건다. 거기서
       * 멈추면 뒤에 더 있다는 뜻으로 잘림 을 하나 더 센다 — 「다 받았다」 로 안 보이게.
       */
      const 다 = [];
      const 본커서 = new Set();
      const 마감 = Date.now() + timeout;
      let 커서 = null;
      let 덜받음 = false;
      for (let 쪽 = 0; ; 쪽++) {
        let r;
        /*
         * 쪽을 넘기다 탈이 나면 **받아 둔 것까지 버리지는 않는다.**
         *
         * 이 되풀이가 통째로 바깥 try 안에 있어서, 첫 쪽을 다 받아 놓고도 둘째 쪽에서
         * 시한이 지나면 그 예외가 아래 catch 로 가 서버가 통째로 안 붙었다. 쪽을 나눠
         * 주는 것은 대개 도구가 많은 큰 서버다 — 뒷쪽 하나가 늦다고 그 서버의 도구를
         * 한 개도 안 쓰는 것은, 이 파일의 「하나가 안 떠도 나머지는 쓴다」 와 반대다.
         * 받은 데까지 쓰고 뒤에 더 있다고 적는다(잘림). 첫 쪽부터 못 받았으면 받은 것이
         * 없으니 여느 때처럼 통째로 실패다.
         */
        try {
          r = await this.보내고기다리기('tools/list', 커서 ? { cursor: 커서 } : {}, Math.max(1000, 마감 - Date.now()));
        } catch (e) {
          if (!다.length) throw e;
          덜받음 = true;
          break;
        }
        if (Array.isArray(r?.tools)) 다.push(...r.tools);
        const 다음 = typeof r?.nextCursor === 'string' && r.nextCursor ? r.nextCursor : null;
        if (!다음 || 본커서.has(다음)) break;
        if (쪽 + 1 >= 목록쪽최대) { 덜받음 = true; break; }
        본커서.add(다음);
        커서 = 다음;
      }
      this.도구 = 다.slice(0, 도구최대);
      this.잘림 = Math.max(0, 다.length - this.도구.length) + (덜받음 ? 1 : 0);
    } catch (e) {
      /*
       * 도구 없이 자료·프롬프트만 내는 서버는 tools/list 를 모를 수 있다 (2.1.3) — 도구를 낸다고
       * 안 했으면 목록을 못 받은 것이 탈이 아니다. 낸다고 해 놓고 못 주면 여느 때처럼 실패다.
       */
      if (this.능력?.tools || !(this.능력?.resources || this.능력?.prompts)) {
        this.끝냄(`도구 목록을 못 받았습니다: ${e.message}`);
        return false;
      }
      this.도구 = [];
      this.잘림 = 0;
    }

    /*
     * ── 자료와 프롬프트 (2.1.3) ──────────────────────────────────────────
     *
     * 도구만 받고 나머지는 버렸다. 문서 서버는 제 문서를 자료(resources)로, 팀이 다듬은 지시문은
     * 프롬프트로 낸다 — 둘 다 모델도 사람도 닿을 길이 없었다.
     *
     *   자료      read_resource 도구 하나를 붙인다(자료도구이름). 목록은 부를 때 받는다 — 붙을 때
     *             받으면 자료가 수천 개인 서버에서 켤 때마다 기다린다.
     *   프롬프트  목록을 받아 둔다. 사람이 `/mcp__<서버>__<이름>` 으로 부른다(commands.js).
     *
     * 못 받아도 서버는 붙는다 — 곁가지 하나 때문에 도구까지 못 쓰면 안 된다.
     */
    if (this.능력?.resources && !this.도구.some((t) => t?.name === 자료도구이름)) this.도구 = [...this.도구, 자료도구정의()];
    if (this.능력?.prompts) {
      try {
        const { 다 } = await this.목록모으기('prompts/list', 'prompts', 전체마감, 프롬프트최대);
        this.프롬프트 = 다.filter((p) => typeof p?.name === 'string' && /^\S+$/.test(p.name)).slice(0, 프롬프트최대).map((p) => ({
          name: p.name,
          description: typeof p.description === 'string' ? p.description.slice(0, 300) : '',
          arguments: (Array.isArray(p.arguments) ? p.arguments : [])
            .filter((a) => typeof a?.name === 'string' && a.name)
            .map((a) => ({ name: a.name, description: typeof a.description === 'string' ? a.description.slice(0, 200) : '', required: a.required === true })),
        }));
      } catch { this.프롬프트 = []; }
    }
    return true;
  }

  /**
   * 쪽으로 오는 목록을 끝까지 모은다 — tools/list 와 같은 그물(쪽 수 · 같은 커서 · 시한)을 건다.
   * 첫 쪽부터 못 받으면 던진다. 뒷쪽에서 넘어지면 받은 데까지 주고 덜받음 을 세운다.
   */
  async 목록모으기(method, 열쇠, 마감, 상한 = Infinity, signal = null) {
    const 다 = [];
    const 본커서 = new Set();
    let 커서 = null;
    let 덜받음 = false;
    for (let 쪽 = 0; ; 쪽++) {
      let r;
      try {
        r = await this.보내고기다리기(method, 커서 ? { cursor: 커서 } : {}, Math.max(1000, 마감 - Date.now()), signal);
      } catch (e) {
        if (!다.length) throw e;
        덜받음 = true;
        break;
      }
      if (Array.isArray(r?.[열쇠])) 다.push(...r[열쇠]);
      const 다음 = typeof r?.nextCursor === 'string' && r.nextCursor ? r.nextCursor : null;
      if (!다음 || 본커서.has(다음)) break;
      if (쪽 + 1 >= 목록쪽최대 || 다.length >= 상한) { 덜받음 = true; break; }
      본커서.add(다음);
      커서 = 다음;
    }
    return { 다, 덜받음 };
  }

  /** read_resource — uri 가 없으면 목록, 있으면 그 자료의 글 (자료도구이름 머리말). */
  async 자료읽기(args, { timeout = 부르기제한, signal = null } = {}) {
    const uri = typeof args?.uri === 'string' ? args.uri.trim() : '';
    if (!uri) {
      const 마감 = Date.now() + timeout;
      const { 다, 덜받음 } = await this.목록모으기('resources/list', 'resources', 마감, 자료최대, signal);
      // 틀(templates)은 안 내는 서버가 흔하다 — 못 받아도 목록은 준다.
      let 틀 = [];
      try { ({ 다: 틀 } = await this.목록모으기('resources/templates/list', 'resourceTemplates', 마감, 50, signal)); } catch { /* 틀이 없다 */ }
      const 짧게 = (글, n) => { const s = String(글 ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };
      const 줄 = 다.slice(0, 자료최대).filter((r) => typeof r?.uri === 'string').map((r) => [
        r.uri,
        r.name && r.name !== r.uri ? ` — ${짧게(r.name, 80)}` : '',
        r.mimeType ? ` (${r.mimeType})` : '',
        r.description ? `: ${짧게(r.description, 160)}` : '',
      ].join(''));
      const 틀줄 = 틀.slice(0, 50).filter((t) => typeof t?.uriTemplate === 'string')
        .map((t) => `${t.uriTemplate}${t.name ? ` — ${짧게(t.name, 80)}` : ''}${t.description ? `: ${짧게(t.description, 160)}` : ''}`);
      return {
        text: [
          줄.length ? 줄.join('\n') : '(이 서버가 내놓은 자료가 없습니다)',
          덜받음 || 다.length > 자료최대 ? `… 더 있습니다 — ${자료최대}개까지만 적었습니다` : '',
          틀줄.length ? `\n틀 — {…} 를 채운 uri 로 읽습니다:\n${틀줄.join('\n')}` : '',
        ].filter(Boolean).join('\n'),
        isError: false,
      };
    }
    const r = await this.보내고기다리기('resources/read', { uri }, timeout, signal);
    const 글 = (Array.isArray(r?.contents) ? r.contents : []).map((c) => {
      if (typeof c?.text === 'string') return c.text;
      // 바이너리는 싣지 않는다 — base64 는 글자 수만 먹고 모델은 못 읽는다. 있다는 것만 말한다.
      if (typeof c?.blob === 'string') return `[${c.mimeType ?? 'binary'} · ${Math.floor(c.blob.length * 3 / 4).toLocaleString()}바이트 — 글이 아니라 싣지 않습니다: ${c.uri ?? uri}]`;
      return '';
    }).filter(Boolean).join('\n');
    return { text: 글, isError: false };
  }

  /**
   * 프롬프트를 받아 한 덩이 글로 편다 — 사람이 `/mcp__<서버>__<이름>` 으로 부른다 (2.1.3).
   * 대기 중이면 여기서 깨운다(부르기 와 같은 길).
   */
  async 프롬프트받기(이름, 인자 = {}, { timeout = 부르기제한, signal = null } = {}) {
    if (signal?.aborted) throw new Error('중단했습니다');
    if (this.대기 || this.되살릴수있나()) {
      const ok = await 끊기며기다리기(this.깨우기(), signal);
      if (!ok) throw new Error(this.죽음 ?? '띄우지 못했습니다');
    }
    const r = await this.보내고기다리기('prompts/get', { name: 이름, arguments: 인자 ?? {} }, timeout, signal);
    const 조각들 = (Array.isArray(r?.messages) ? r.messages : []).flatMap((m) => (Array.isArray(m?.content) ? m.content : [m?.content]));
    return 조각들
      .map((p) => (p?.type === 'text' ? p.text : p?.type === 'resource' && typeof p.resource?.text === 'string' ? p.resource.text : ''))
      .filter((t) => typeof t === 'string' && t).join('\n\n');
  }

  받음(덩이) {
    // 넘친 뒤로는 받지 않는다 (아래 머리말).
    if (this.넘침) return;
    this.찌꺼기 += 덩이;
    let i = this.찌꺼기.indexOf('\n');
    while (i >= 0) {
      const 줄 = this.찌꺼기.slice(0, i).trim();
      this.찌꺼기 = this.찌꺼기.slice(i + 1);
      if (줄) this.한통(줄);
      i = this.찌꺼기.indexOf('\n');
    }
    /*
     * ── 넘치면 **귀를 닫고 거둔다** (사냥4 W1) ─────────────────────────────
     *
     * 여기는 넘치면 끝냄() 만 부르고 돌아갔다. 그런데 귀(stdout 의 data)는 그대로 열려
     * 있어서 다음 조각이 오면 또 이어 붙였고, 끝냄() 은 두 번째부터 아무것도 안 한다.
     * 줄바꿈 없이 끝없이 쏟는 서버 하나에 버퍼가 몇백 MB 로 자라다 **RangeError 로
     * deel 이 통째로 죽었다** — 남의 프로그램이 멋대로 굴어도 우리는 안 죽는다는 이
     * 파일의 약속이 거기서 깨졌다. 넘친 서버는 쓸 수 없으니 버퍼를 비우고, 더 안 읽고,
     * 프로세스까지 거둔다(닫기).
     */
    if (this.찌꺼기.length > 줄최대) {
      this.넘침 = true;
      this.찌꺼기 = '';
      this.끝냄('한 통이 너무 큽니다 — 규격에 안 맞는 서버입니다');
      try { this.kid?.stdout?.destroy(); } catch { /* 이미 닫혔으면 그만 */ }
      this.닫기();
    }
  }

  한통(줄) {
    let j;
    try { j = JSON.parse(줄); } catch { return; }   // 규격 밖의 잡소리는 버린다
    // `null` · 숫자 한 줄도 JSON 이다. 거기서 j.id 를 읽으면 받는 귀에서 던져 deel 이 죽는다.
    if (!j || typeof j !== 'object') return;
    /*
     * ── 답인지 물음인지는 **method 로** 가른다 (사냥4 W5) ──────────────────
     *
     * JSON-RPC 의 번호는 **양쪽이 따로** 센다. 서버가 우리에게 ping 을 물으면서 제 번호
     * 1 을 쓰면, 그 1 은 우리가 보낸 tools/call 의 1 과 겹친다. 번호만 보고 갈랐더니
     * 서버의 ping 이 우리 물음의 답으로 먹혀 **빈 결과**가 모델에게 갔고, ping 에는 아무도
     * 답을 안 해서 서버는 진짜 답을 끝내 안 줬다. 답에는 method 가 없고 물음에는 있다 —
     * 언어 서버 쪽(lsp/client.js)이 이미 이렇게 가른다.
     */
    if (j.method !== undefined) {
      if (j.id != null) this.물음에답(j);
      return;                                        // 알림은 아직 안 쓴다
    }
    if (j.id == null) return;
    const 기다림 = this.기다리는것.get(j.id);
    if (!기다림) return;
    this.기다리는것.delete(j.id);
    clearTimeout(기다림.타이머);
    // 끝난 자리의 ESC 엿듣기는 떼어 낸다. 안 떼면 한 턴에 도구를 스무 번
    // 부르는 사이 신호 하나에 스무 개가 매달린다 — 노드가 열 개 넘으면
    // 「메모리가 새는 것 같다」 고 경고를 찍는데, 실제로 새는 것이 맞다.
    기다림.끊기그만?.();
    if (j.error) 기다림.실패(new Error(j.error.message ?? '알 수 없는 오류'));
    else 기다림.성공(j.result);
  }

  /**
   * 한 통 보내고 답을 기다린다.
   *
   * signal 은 사람이 누른 ESC 다. 안 받으면 도구 하나 부르는 데 최대 60초
   * (부르기제한)를 기다리는데, 그 60초 동안 ESC 는 아무것도 안 한다 — 화면은
   * 「멈추는 중…」 인데 남의 프로세스의 답을 계속 기다리고 있는 상태다.
   * 그래서 시한과 같은 자리에서 같은 방식으로 푼다: 기다리는 표에서 빼고,
   * 왜 끝났는지를 말로 남기고 끝낸다.
   */
  보내고기다리기(method, params, timeout = 부르기제한, signal = null) {
    return new Promise((성공, 실패) => {
      /*
       * 죽은 것은 세 가지로 알아본다 (6회차 Gemini 엠씨피 MB2). 시그널로 죽은 아이는 exitCode 가
       * null 이라 그것만 보면 지나간다 — 죽은 관에 써 놓고, 아래 시한은 unref 라 아무것도 안 붙든
       * 판에서는 영영 안 풀렸다(검사 프로세스가 「안 끝난 await」 로 끝났다). 끝냄 이 적은 죽음 도 본다.
       */
      if (!this.kid || this.kid.exitCode !== null || this.kid.signalCode !== null || this.죽음) {
        return 실패(new Error(this.죽음 ?? '연결이 없습니다'));
      }
      // 이미 멈췄으면 보내지도 않는다. 보내 놓고 버리면 남의 서버는 그 일을 끝까지 한다.
      if (signal?.aborted) return 실패(new Error('중단했습니다'));
      const id = this.다음번호++;
      const 타이머 = setTimeout(() => {
        this.기다리는것.delete(id);
        끊기그만();
        실패(new Error(`${Math.round(timeout / 1000)}초 안에 답이 없습니다`));
      }, timeout);
      if (타이머.unref) 타이머.unref();
      /*
       * 기다리는 표에서 **반드시** 뺀다.
       *
       * 안 빼면 뒤늦게 온 답이 이미 끝난 약속을 또 푼다. 두 번째 풀기는
       * 조용히 무시되므로 오류는 안 나지만, 표에 죽은 자리가 남아서
       * 끝냄() 이 그것들을 다시 실패시킨다 — 아무도 안 듣는 실패다.
       */
      const 끊겼다 = () => {
        clearTimeout(타이머);
        this.기다리는것.delete(id);
        실패(new Error('중단했습니다'));
      };
      signal?.addEventListener?.('abort', 끊겼다, { once: true });
      const 끊기그만 = () => signal?.removeEventListener?.('abort', 끊겼다);
      this.기다리는것.set(id, { 성공, 실패, 타이머, 끊기그만 });
      try {
        this.kid.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      } catch (e) {
        clearTimeout(타이머);
        this.기다리는것.delete(id);
        끊기그만();
        실패(e);
      }
    });
  }

  알림(method, params) {
    try { this.kid?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); } catch { /* 죽었으면 어차피 끝이다 */ }
  }

  /**
   * 서버가 **우리에게** 묻는 것에 답한다. ping 은 받고, 나머지는 「안 받습니다」 로.
   *
   * 말없이 두면 서버는 그 답을 기다리느라 우리 물음에 답을 안 할 수 있다. 우리는
   * roots·sampling 같은 능력을 안 댔으니(initialize 의 capabilities) 규격대로 -32601 이다.
   */
  물음에답(j) {
    try { this.kid?.stdin?.write(JSON.stringify(물음답(j)) + '\n'); } catch { /* 죽었으면 어차피 끝이다 */ }
  }

  /** 인사말 — 처음 붙을 때와 HTTP 세션이 끝나 다시 인사할 때 같은 것을 보낸다. */
  인사말() {
    return { protocolVersion: this.청할규격, capabilities: { tools: {} }, clientInfo: { name: 'deel', version: VERSION } };
  }

  async 부르기(도구이름, args, { timeout = 부르기제한, signal = null } = {}) {
    // 이미 멈췄으면 깨우지도 않는다 — 안 쓸 서버를 띄워 두는 것이다.
    if (signal?.aborted) throw new Error('중단했습니다');
    /*
     * 대기 중이면 **여기서** 띄운다. 이게 지연 로딩의 전부다.
     *
     * 첫 부름 하나만 붙는 시간을 치르고, 그 뒤로는 여느 때와 똑같다. 켤 때
     * 다 띄우던 값을 「그 도구를 실제로 쓰는 사람」 에게만 물리는 셈이다.
     */
    if (this.대기 || this.되살릴수있나()) {
      /*
       * ── 깨우는 동안에도 ESC 가 먹는다 (2.0.2 · MB4) ──────────────────────────
       *
       * 깨우기에는 신호를 안 넘겼다. 그래서 붙는 동안(붙기제한 8초까지) ESC 가 아무것도 안
       * 했다. 신호를 깨우기에 넘기면 안 된다 — 깨우는 약속은 **같이 부른 도구들이 나눠
       * 기다린다**(MB1). 한 사람의 ESC 가 그 약속을 끊으면 같이 기다리던 부름까지 끊기고,
       * 반쯤 붙은 서버가 죽음 으로 남아 세션 내내 못 쓴다.
       *
       * 그래서 **이 부름만** 기다리기를 그만둔다. 깨우기는 뒤에서 제 길을 가고, 다 뜨면
       * 다음 부름이 곧장 쓴다.
       */
      const ok = await 끊기며기다리기(this.깨우기(), signal);
      if (!ok) throw new Error(this.죽음 ?? '띄우지 못했습니다');
      /*
       * 띄우고 보니 그 도구가 없어졌으면 **그렇다고 말한다.**
       *
       * 여기서 그냥 tools/call 을 보내면 서버가 뭐라고 답할지는 서버 마음이고,
       * 대개는 「unknown tool」 한 줄이다. 그 줄로는 우리가 옛 목록을 들고
       * 있었다는 사실을 아무도 못 읽는다.
       */
      if (!this.도구.some((t) => t.name === 도구이름)) {
        throw new Error(`${this.이름} 서버에 ${도구이름} 이 더는 없습니다`
          + ` — 적어 둔 목록이 옛것이었습니다. 지금 있는 것: ${this.도구.map((t) => t.name).join(' · ') || '(없음)'}`);
      }
    }
    // 우리가 붙인 read_resource 는 서버의 도구가 아니다 — tools/call 이 아니라 resources/* 로 간다.
    if (도구이름 === 자료도구이름 && this.자료도구붙임) return await this.자료읽기(args, { timeout, signal });
    const r = await this.보내고기다리기('tools/call', { name: 도구이름, arguments: args ?? {} }, timeout, signal);
    // 규격상 결과는 content 배열이다. 글만 뽑아 모델에게 넘긴다.
    const 조각 = Array.isArray(r?.content) ? r.content : [];
    /*
     * ── 글이 들어 있는데 한 낱말로 줄이지 않는다 (사냥4 W11) ─────────────────
     *
     * text 가 아닌 조각은 전부 `[갈래]` 로 줄였다. 그런데 박힌 자원(resource)은 제
     * 글(resource.text)을 **통째로** 들고 온다 — 파일 읽기·문서 조회 서버가 흔히 이렇게
     * 준다. 그걸 「[resource]」 한 낱말로 바꿔 모델에게 줬으니, 모델은 받은 것이 없는
     * 줄 알고 같은 도구를 또 불렀다. 그리고 결과를 structuredContent 로만 주는 서버는
     * 빈 글이 됐다(「빈 답」 으로 찍혔다). 둘 다 들어 있는 것을 싣는다.
     */
    const 글 = 조각
      .map((p) => {
        if (p?.type === 'text') return p.text;
        if (p?.type === 'resource') {
          return typeof p.resource?.text === 'string' ? p.resource.text : `[resource ${p.resource?.uri ?? ''}]`;
        }
        if (p?.type === 'resource_link') return `[resource_link ${p.uri ?? ''}]`;
        return p?.type ? `[${p.type}]` : '';
      })
      .filter(Boolean).join('\n');
    // 규격은 structuredContent 를 준 서버에게 같은 것을 text 로도 주라고 **권할** 뿐이다.
    const 구조 = !글 && r?.structuredContent != null ? JSON.stringify(r.structuredContent) : '';
    return { text: 글 || 구조, isError: r?.isError === true };
  }

  끝냄(왜) {
    if (this.죽음) return;
    this.죽음 = this.마지막말 ? `${왜} — ${this.마지막말}` : 왜;
    for (const [, 기다림] of this.기다리는것) {
      clearTimeout(기다림.타이머);
      기다림.끊기그만?.();
      기다림.실패(new Error(this.죽음));
    }
    this.기다리는것.clear();
  }

  닫기() {
    this.닫음 = true;
    this.끝냄('닫았습니다');
    띄운것들.delete(this);
    try {
      this.kid?.stdin?.end();
      /*
       * cmd.exe 를 거쳐 띄운 것(.cmd · npx)은 **나무째** 거둔다 (사냥4 W7 과 같이).
       * kill() 은 cmd.exe 하나만 죽이고 그 밑의 진짜 서버(node …)는 살아남는다 — 도는
       * 동안 닫은 서버가 작업 관리자에 하나씩 쌓인다. taskkill /T 는 부모가 살아 있어야
       * 나무를 따라가므로 kill() 은 그 뒤에 한다. (프로그램이 끝날 때는 libuv 의 job 이
       * 나무째 거둔다 — 이건 도는 동안의 몫이다.)
       */
      const 아이 = this.kid;
      if (this.셸로띄움 && process.platform === 'win32' && 아이?.pid && 아이.exitCode === null) {
        const 뒤에죽이기 = () => { try { 아이.kill(); } catch { /* 이미 죽었다 */ } };
        const 나무 = spawn('taskkill', ['/pid', String(아이.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        나무.once('error', 뒤에죽이기);
        나무.once('exit', 뒤에죽이기);
        나무.unref();
      } else {
        this.kid?.kill();
      }
      // 자식이 살아 있으면 우리 프로그램이 안 끝난다.
      this.kid?.unref?.();
    } catch { /* 이미 죽었다 */ }
  }
}

/**
 * 서버가 우리에게 물은 것의 답. ping 은 받고, 나머지는 「안 받습니다」 로 (MCP서버.물음에답 머리말).
 */
function 물음답(j) {
  return j.method === 'ping'
    ? { jsonrpc: '2.0', id: j.id, result: {} }
    : { jsonrpc: '2.0', id: j.id, error: { code: -32601, message: `deel 은 ${String(j.method).slice(0, 80)} 을(를) 받지 않습니다` } };
}

/** JSON-RPC 오류를 사람 말로. 규격 판이 안 맞으면 서버가 받는 판을 같이 적는다 (파일 머리말의 2026-07-28). */
function 답탈글(error) {
  const 받는것 = Array.isArray(error?.data?.supported) ? error.data.supported.filter((x) => typeof x === 'string').slice(0, 8) : [];
  const 말 = String(error?.message ?? '알 수 없는 오류').slice(0, 300);
  return 받는것.length ? `${말} (서버가 받는 규격: ${받는것.join(', ')} — deel 은 인사로 붙는 규격 2025-11-25 까지 압니다)` : 말;
}

/** HTTP 로 거절당한 까닭을 한 줄로. 흔한 둘(열쇠 · 주소)은 무엇을 볼지까지 말한다. */
function 웹탈글(status, 글, method) {
  const 날글 = String(글 ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  let 말 = '';
  try {
    const j = JSON.parse(글);
    // JSON-RPC 오류({error: {message}})만 오지 않는다 — 앞단 게이트웨이는 OAuth 꼴({error: "invalid_token",
    // error_description}) · {message} 로 거절한다. 그 말을 버리면 「알 수 없는 오류」 만 남는다.
    const e = j?.error;
    말 = e && typeof e === 'object' ? 답탈글(e)
      : [e, j?.error_description, j?.message].filter((x) => typeof x === 'string' && x.trim()).join(' — ').slice(0, 200) || 날글;
  } catch {
    말 = 날글;
  }
  const 볼것 = status === 401 || status === 403
    ? ' — 열쇠(mcp.json 의 headers)를 확인하세요'
    : (status === 404 || status === 405) && method === 'initialize'
      ? ' — 이 주소가 MCP 창구가 아니거나, 옛 HTTP+SSE 규격 서버일 수 있습니다'
      : '';
  return `HTTP ${status}${말 ? ` · ${말}` : ''}${볼것}`;
}

/**
 * SSE 글을 사건별 data 로 가른다. 아직 안 끝난 뒷부분은 남은것 으로 돌려준다.
 *
 * 줄 끝은 셋 다 받는다(\r\n · \n · \r). 조각이 \r 에서 끊기면 다음 조각의 \n 과 한 줄 끝인지
 * 아직 모르므로 붙들어 둔다 — 안 그러면 빈 줄로 읽혀 사건이 반쪽에서 잘린다.
 */
export function SSE가르기(찌꺼기) {
  let 붙들 = '';
  let 글 = String(찌꺼기 ?? '');
  // 줄 끝 바로 뒤의 \r 은 붙들지 않는다 — 뒤에 \n 이 오든 말든 빈 줄이 이미 섰다(사건 끝). 붙들면 \r 만 쓰는
  // 서버의 마지막 답이 다음 조각이 올 때까지 갇힌다.
  if (글.endsWith('\r') && !/[\r\n]\r$/.test(글)) { 붙들 = '\r'; 글 = 글.slice(0, -1); }
  const 덩이 = 글.replace(/\r\n?/g, '\n').split('\n\n');
  const 남은것 = 덩이.pop() + 붙들;
  const 사건들 = [];
  for (const d of 덩이) {
    const data = d.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, ''));
    if (data.length) 사건들.push(data.join('\n'));
  }
  return { 사건들, 남은것 };
}

/*
 * ── HTTP 로 붙는 서버 (2.1.3 · streamable HTTP) ─────────────────────────
 *
 * 물음 하나가 POST 하나다. 답은 두 꼴로 온다 — JSON 한 통, 또는 SSE 흐름(그 안에 서버가 우리에게
 * 묻는 것이 먼저 섞여 올 수 있다). 둘 다 받는다. 인사의 답에 Mcp-Session-Id 가 오면 그 뒤로 늘
 * 싣고, 서버가 그 세션을 버려 404 를 주면 새로 인사하고 **한 번만** 다시 보낸다(규격대로).
 *
 * 아이(프로세스)가 없으니 「살아 있나」 는 길을 열어 두었나다. 물음 하나가 끊기거나 5xx 가 와도
 * 서버를 죽음 으로 적지 않는다 — 그 물음만 실패다. 네트워크가 한 번 흔들린 것으로 세션 내내 도구를
 * 잃으면 안 된다. 죽음 은 인사에 실패했을 때와 우리가 닫았을 때만 선다.
 */
export class MCP웹서버 extends MCP서버 {
  constructor(설정) {
    super(설정);
    this.열림 = false;
    this.세션 = null;
    /** 도는 요청들의 끊개. 닫기 가 한꺼번에 끊는다. */
    this.도는것 = new Set();
    /** 세션이 끝나 다시 인사하는 중인 약속 — 여럿이 한꺼번에 404 를 받아도 인사는 한 번. */
    this.다시인사중 = null;
  }

  get 청할규격() { return '2025-11-25'; }

  살아있나() { return this.열림 && !this.죽음; }

  길열기() {
    this.열림 = true;
    this.세션 = null;
    this.규격 = null;
    // 프로세스는 없지만 명부에 든다 — 끝날 때 모두닫기 가 도는 요청을 끊고 세션을 닫게.
    띄운것들.add(this);
    return true;
  }

  /** 싣는 머리말. 적어 둔 것 위에 규격이 정한 것을 얹는다 — 적어 둔 것이 규격 머리말을 덮지 못한다. */
  머리말() {
    const h = { ...(this.설정.headers ?? {}) };
    for (const k of Object.keys(h)) if (/^(?:content-type|accept|mcp-session-id|mcp-protocol-version)$/i.test(k)) delete h[k];
    h['Content-Type'] = 'application/json';
    h.Accept = 'application/json, text/event-stream';
    if (this.세션) h['Mcp-Session-Id'] = this.세션;
    if (this.규격) h['MCP-Protocol-Version'] = this.규격;
    return h;
  }

  async 보내고기다리기(method, params, timeout = 부르기제한, signal = null) {
    if (!this.열림 || this.죽음) throw new Error(this.죽음 ?? '연결이 없습니다');
    if (signal?.aborted) throw new Error('중단했습니다');
    // 다시 인사하는 중이면 끝나기를 기다린다 — 세션 없이 나간 물음은 서버가 거절한다.
    if (this.다시인사중 && method !== 'initialize') await 끊기며기다리기(this.다시인사중, signal);
    try {
      return await this.보내기({ jsonrpc: '2.0', id: this.다음번호++, method, params }, { timeout, signal });
    } catch (e) {
      if (!e?.세션끝남 || method === 'initialize') throw e;
      await this.다시인사(timeout, signal, e.세션);
      return await this.보내기({ jsonrpc: '2.0', id: this.다음번호++, method, params }, { timeout, signal });
    }
  }

  /**
   * 서버가 세션을 버렸다 — 세션 없이 initialize 부터 다시 한다 (규격).
   *
   * 끝난세션 은 404 를 받은 물음이 싣고 간 세션이다. 같이 나간 물음들의 404 는 저마다 다른 때에 닿는다 —
   * 이미 다른 물음이 새 세션을 받아 왔으면 또 인사하지 않는다(받아 온 세션을 버리게 된다).
   */
  다시인사(timeout, signal, 끝난세션 = this.세션) {
    if (!this.다시인사중 && this.세션 && this.세션 !== 끝난세션) return Promise.resolve();
    if (!this.다시인사중) {
      this.세션 = null;
      this.규격 = null;
      this.다시인사중 = (async () => {
        const r = await this.보내기({ jsonrpc: '2.0', id: this.다음번호++, method: 'initialize', params: this.인사말() }, { timeout });
        this.규격 = typeof r?.protocolVersion === 'string' ? r.protocolVersion : null;
        await this.알림('notifications/initialized', {});
      })().finally(() => { this.다시인사중 = null; });
    }
    return 끊기며기다리기(this.다시인사중, signal);
  }

  /**
   * 한 통을 POST 로 보낸다. 물음이면 답을 기다려 result 를 돌려주고, 알림·답이면 받았다(202)는 것만 본다.
   */
  async 보내기(통, { timeout = 부르기제한, signal = null } = {}) {
    // 닫은 뒤에 늦게 온 알림 · 답(다시 인사의 initialized 따위)이 새 연결을 열지 않게.
    if (!this.열림) throw new Error(this.죽음 ?? '닫았습니다');
    const 물음 = 통.method !== undefined && 통.id != null;
    const url = this.설정.url;
    const 머리 = this.머리말();
    const 실은세션 = this.세션;
    const 손 = new AbortController();
    let 까닭 = null;
    const 끊기 = (왜) => { if (!까닭) 까닭 = 왜; try { 손.abort(); } catch { /* 이미 끊겼다 */ } };
    const 시계 = setTimeout(() => 끊기('시간'), timeout);
    시계.unref?.();
    const 사람 = () => 끊기('사람');
    if (signal?.aborted) 끊기('사람');
    else signal?.addEventListener?.('abort', 사람, { once: true });
    const 칸 = { 끊기 };
    this.도는것.add(칸);
    // 적어 둔 그 집만, 이 물음이 도는 동안만 연다. 오프라인 잠금이면 문지기가 그래도 막는다.
    const 닫기문 = allowTemporarily(url);
    try {
      const r = await 원시요청(url, {
        method: 'POST', headers: 머리, body: JSON.stringify(통),
        timeout, 잠잠: timeout, stream: true, signal: 손.signal,
        // 다른 집으로 되돌리면 안 따라간다 — 열쇠 머리말이 실린 물음이다.
        되돌림: (다음) => {
          if (다음.origin !== new URL(url).origin) throw new Error(`MCP 서버가 다른 곳(${다음.origin})으로 되돌립니다 — 따라가지 않습니다`);
        },
      });
      if (r.error) throw new Error(r.error);
      if (r.되돌림탈) throw new Error(r.되돌림탈);
      if (통.method === 'initialize') {
        const 세션 = r.headers?.get?.('mcp-session-id');
        if (세션) this.세션 = 세션;
      }
      if (!r.ok) {
        const 글 = await Promise.resolve(r.res?.text?.()).catch(() => '');
        // 판정은 이 물음이 **싣고 간** 세션으로 한다 — 지금 세션은 그새 다시 인사한 다른 물음이 비웠거나 바꿨다.
        if (r.status === 404 && 실은세션 && 통.method !== 'initialize') {
          throw Object.assign(new Error('서버가 세션을 끝냈습니다'), { 세션끝남: true, 세션: 실은세션 });
        }
        throw new Error(웹탈글(r.status, 글 ?? '', 통.method));
      }
      if (!물음) { await r.버리기?.(); return null; }
      if (!r.res?.body) throw new Error(`답이 비었습니다 (HTTP ${r.status})`);
      const 갈래 = String(r.headers?.get?.('content-type') ?? '');
      if (/text\/event-stream/i.test(갈래)) return await this.흐름에서답(r.res.body, 통.id);
      const 몸 = await 몸읽기(r.res.body, 줄최대);
      if (몸 == null) throw new Error('한 통이 너무 큽니다 — 규격에 안 맞는 서버입니다');
      let j;
      try { j = JSON.parse(몸.toString('utf8')); } catch {
        throw new Error(`답이 JSON 이 아닙니다 (HTTP ${r.status}${갈래 ? ` · ${갈래}` : ''})`);
      }
      const 답 = this.통보기(Array.isArray(j) ? j : [j], 통.id);
      if (!답) throw new Error('답에 우리 물음의 번호가 없습니다 — 규격에 안 맞는 서버입니다');
      if (답.error) throw new Error(답탈글(답.error));
      return 답.result;
    } catch (e) {
      if (까닭 === '시간') throw new Error(`${Math.round(timeout / 1000)}초 안에 답이 없습니다`);
      if (까닭 === '사람') throw new Error('중단했습니다');
      if (까닭 === '닫음') throw new Error(this.죽음 ?? '닫았습니다');
      throw e;
    } finally {
      clearTimeout(시계);
      signal?.removeEventListener?.('abort', 사람);
      this.도는것.delete(칸);
      닫기문();
    }
  }

  /**
   * 받은 통들에서 우리 답을 고르고, 서버가 우리에게 물은 것에는 답한다 (한통 과 같은 잣대 — method 로 가른다).
   *
   * 번호 없는(id: null) 오류는 우리 물음을 못 읽은 서버의 답이다(JSON-RPC 규격 — 번호를 못 읽었으니 null).
   * 이 POST 에 실린 물음은 하나뿐이라 그 오류가 곧 우리 답이다. 「번호가 없다」 로 덮으면 서버가 한 말을 잃는다.
   */
  통보기(통들, id) {
    let 찾음 = null;
    let 번호없는탈 = null;
    for (const j of 통들) {
      if (!j || typeof j !== 'object') continue;
      if (j.method !== undefined) {
        if (j.id != null) this.물음에답(j);
        continue;
      }
      if (j.id === id && !찾음) 찾음 = j;
      else if (j.id === null && j.error && !번호없는탈) 번호없는탈 = j;
    }
    return 찾음 ?? 번호없는탈;
  }

  /** SSE 로 오는 답. 우리 답이 오면 그 자리에서 흐름을 끊는다. */
  async 흐름에서답(몸, id) {
    const 읽개 = 몸.getReader();
    const 풀개 = new TextDecoder();
    let 찌꺼기 = '';
    let 끝 = false;
    try {
      for (;;) {
        const { done, value } = await 읽개.read();
        // 끝났으면 빈 줄을 하나 보태 마지막 사건까지 가른다 — 빈 줄 없이 닫는 서버가 있다.
        if (done) { 끝 = true; 찌꺼기 += `${풀개.decode()}\n\n`; } else 찌꺼기 += 풀개.decode(value, { stream: true });
        const { 사건들, 남은것 } = SSE가르기(찌꺼기);
        찌꺼기 = 남은것;
        for (const 글 of 사건들) {
          let j;
          try { j = JSON.parse(글); } catch { continue; }   // 규격 밖의 잡소리는 버린다
          const 답 = this.통보기(Array.isArray(j) ? j : [j], id);
          if (!답) continue;
          if (답.error) throw new Error(답탈글(답.error));
          return 답.result;
        }
        // 줄바꿈 없이 끝없이 붓는 서버에 메모리가 튀지 않게 (stdio 의 넘침 과 같은 상한).
        if (찌꺼기.length > 줄최대) throw new Error('한 통이 너무 큽니다 — 규격에 안 맞는 서버입니다');
        if (끝) throw new Error('답을 주기 전에 서버가 흐름을 닫았습니다');
      }
    } finally {
      if (!끝) { try { await 읽개.cancel(); } catch { /* 이미 닫혔다 */ } }
    }
  }

  알림(method, params) {
    return this.보내기({ jsonrpc: '2.0', method, params }, { timeout: 붙기제한 }).catch(() => { /* 알림은 답이 없다 — 못 닿아도 다음 물음이 말한다 */ });
  }

  물음에답(j) {
    this.보내기(물음답(j), { timeout: 붙기제한 }).catch(() => { /* 못 닿으면 서버가 제 시한에 그만둔다 */ });
  }

  닫기() {
    this.닫음 = true;
    this.끝냄('닫았습니다');
    띄운것들.delete(this);
    this.열림 = false;
    for (const 칸 of this.도는것) 칸.끊기('닫음');
    this.도는것.clear();
    const 세션 = this.세션;
    this.세션 = null;
    if (!세션) return;
    // 세션을 끝낸다고 알린다(규격의 DELETE). 기다리지 않는다 — 못 알려도 서버가 제 시한에 치운다.
    const url = this.설정.url;
    let 닫기문 = null;
    try {
      닫기문 = allowTemporarily(url);
      원시요청(url, { method: 'DELETE', headers: { ...this.머리말(), 'Mcp-Session-Id': 세션 }, timeout: 2000 })
        .then(() => {}, () => {})
        .finally(() => 닫기문?.());
    } catch { 닫기문?.(); }
  }
}

/**
 * 우리 환경변수를 통째로 넘기지 않는다.
 *
 * DEEL_* 에는 게이트웨이 열쇠가 들어 있을 수 있고, 그 값이 남의 프로세스로
 * 넘어가면 어디로 가는지 우리가 알 수 없다. 프로그램이 도는 데 꼭 필요한
 * 것만 남긴다.
 */
export function 깨끗한환경() {
  const 남길것 = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'SystemRoot', 'windir', 'COMSPEC', 'LANG', 'LC_ALL', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramData', 'NODE_PATH'];
  const out = {};
  for (const k of 남길것) if (process.env[k] != null) out[k] = process.env[k];
  return out;
}

/*
 * ── 윈도우에서 무엇을 어떻게 띄우나 (사냥4 W7) ─────────────────────────
 *
 * 복사해 붙이는 mcp.json 의 절반이 `"command": "npx"` 다. 그런데 윈도우에서 둘 다 안 떴다.
 *
 *   `npx`             셸 없이 띄우면 PATHEXT 를 안 본다 → `npx.cmd` 를 못 찾아 ENOENT
 *   `C:\…\x.cmd`      노드는 셸 없이 .cmd·.bat 를 안 띄운다(CVE-2024-27980 뒤로) → EINVAL
 *
 * 화면에는 「띄우지 못했습니다: spawn EINVAL」 한 줄뿐이라, 사람은 명령이 틀린 줄 안다.
 *
 * `shell: true` 로 넘기면 되긴 한다. 그런데 그러면 인자가 **안 감싸진 채** 이어 붙어서
 * (노드가 DEP0190 으로 경고하는 그 자리) 빈칸·`&`·`%` 가 든 경로가 깨지고, 인자 하나로
 * cmd.exe 명령을 이어 붙일 수 있게 된다. 그래서 언어 서버 쪽(lsp/client.js)처럼 **.cmd ·
 * .bat 만** cmd.exe 로 직접 부르되, 인자는 cmd.exe 가 다시 해석해도 뜻이 안 바뀌게 감싼다
 * (cross-spawn 이 오래 다듬어 온 규칙 그대로다 — 따옴표·역슬래시를 먼저 겹치고, 통째로
 * 따옴표로 두른 뒤 cmd 특수 글자에 ^ 를 단다. npm 이 만든 node_modules\.bin 의 .cmd 는
 * 안에서 한 번 더 해석하므로 ^ 를 두 겹 단다). 언어 서버 쪽은 인자가 우리 표에서 오지만
 * 여기는 사람이 적은 설정에서 오므로 더 촘촘히 감싼다.
 *
 * 이름만 적은 명령은 **PATH 에서 우리가 찾아** 전체 경로로 넘긴다. cmd.exe 에게 찾게 두면
 * 지금 폴더(cwd — 남의 저장소일 수 있다)를 PATH 보다 먼저 뒤진다.
 */
const cmd특수 = /([()\][%!^"`<>&|;, *?])/g;

/** @returns {{ 파일: string, 인자: string[], 옵션: object, 셸: boolean }} */
export function 띄울모양(command, args = [], env = process.env, cwd = process.cwd(), platform = process.platform) {
  const 인자 = (args ?? []).map(String);
  if (platform !== 'win32') return { 파일: command, 인자, 옵션: {}, 셸: false };
  const 찾은것 = 윈도우명령찾기(String(command), env ?? {}, cwd) ?? String(command);
  if (!/\.(cmd|bat)$/i.test(찾은것)) return { 파일: 찾은것, 인자, 옵션: {}, 셸: false };
  /*
   * ── 줄바꿈 든 인자는 cmd.exe 로 못 넘긴다 (Gemini 웹4) ─────────────────────
   *
   * cmd.exe 는 명령줄을 줄바꿈에서 끊는다. 재어 보니 `["a<LF>b", "after"]` 가 `["a"]` 하나로 왔다 —
   * 뒤 인자가 **말없이 통째로** 사라지고, CR 은 그냥 지워진다. 감쌀 길이 없다. 틀린 인자로 서버를
   * 띄워 엉뚱하게 도는 것보다, 안 띄우고 까닭을 말하는 편이 낫다(붙기 가 죽음 으로 보여 준다).
   */
  const 줄바꿈자리 = 인자.findIndex((a) => /[\r\n]/.test(a));
  if (줄바꿈자리 !== -1) {
    throw new Error(`${줄바꿈자리 + 1}번째 인자에 줄바꿈이 있어 .cmd·.bat 로는 그대로 넘길 수 없습니다 — cmd.exe 가 그 자리에서 명령줄을 끊습니다`);
  }
  const 두겹 = 배치가다시읽나(찾은것);
  const 줄 = [normalize(찾은것).replace(cmd특수, '^$1'), ...인자.map((a) => cmd인자감싸기(a, 두겹))].join(' ');
  return {
    파일: process.env.ComSpec || 'cmd.exe',
    // /s /c 는 바깥 따옴표 한 쌍을 떼고 나머지를 그대로 돌린다 — 그래서 한 겹 두른다.
    인자: ['/d', '/s', '/c', `"${줄}"`],
    옵션: { windowsVerbatimArguments: true },
    셸: true,
  };
}

/*
 * ── ^ 를 두 겹 다는 배치 (Gemini 웹4) ─────────────────────────────────────
 *
 * `%*` 로 받은 인자를 넘기는 배치는 그 줄을 **한 번 더** 해석한다. cross-spawn 을 따라
 * node_modules\.bin 의 .cmd 만 두 겹으로 봤는데, 전역 npx.cmd(Node 설치 폴더)·npm 전역 설치
 * 쉼(%APPDATA%\npm)·pnpm 쉼도 똑같이 `%*` 로 넘긴다 — `"command": "npx"` 가 가는 곳이 바로 거기다.
 *
 * 한 겹이면 cmd 가 모르는 `\"` 가 든 인자 하나가 따옴표 상태를 뒤집어, **그 뒤 인자의 & 가 명령으로
 * 돌았다**(재어 봄: `["a\"b", "p & echo made>MARK.txt"]` → MARK.txt 가 생겼다) · 뒤 인자의 ^ 는
 * 사라졌다. 거꾸로 `%~1` 로 받는 배치는 두 겹이면 ^ 가 글자로 남아 인자가 전부 틀린다.
 *
 * 그래서 배치 글을 보고 가른다 — `%*` 가 있으면 두 겹, 없으면 한 겹. 못 읽거나 지나치게 크면
 * 예전 규칙(node_modules\.bin)으로 간다. `CALL x.cmd %*` 처럼 한 번 더 넘기는 배치는 cmd 가 ^ 를
 * 다시 겹치고 % 를 또 풀어서 어느 쪽으로도 못 맞춘다 — 그런 쉼은 드물다.
 */
function 배치가다시읽나(파일) {
  if (/node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(파일)) return true;
  try {
    if (statSync(파일).size > 1024 * 1024) return false;
    // REM · :: 줄은 뺀다 — 쓰는 법을 적은 주석의 %* 에 속아 %~1 배치에 두 겹을 달았다(Gemini 화면5).
    return readFileSync(파일, 'latin1').split(/\r?\n/)
      .some((줄) => !/^\s*@?\s*(?:rem(?:\s|$)|::)/i.test(줄) && 줄.includes('%*'));
  } catch {
    return false;
  }
}

function cmd인자감싸기(a, 두겹) {
  const 겹친 = String(a)
    .replace(/(\\*)"/g, '$1$1\\"')   // 따옴표 앞 역슬래시는 두 배로, 따옴표는 \" 로
    .replace(/(\\*)$/, '$1$1');      // 끝 역슬래시는 두 배로 — 곧 붙일 닫는 따옴표를 안 먹게
  const 한겹 = `"${겹친}"`.replace(cmd특수, '^$1');
  return 두겹 ? 한겹.replace(cmd특수, '^$1') : 한겹;
}

/** 윈도우가 실제로 돌릴 파일을 찾는다. 확장자 붙은 것을 먼저 본다 (lsp/servers.js 의 어디있나 와 같은 순서). */
function 윈도우명령찾기(명령, env, cwd) {
  /*
   * 빈 PATHEXT 는 **안 적은 것과 같이** 본다 (lsp/servers.js 의 어디있나 와 같은 자리).
   *
   * `??` 는 빈 글을 안 막는다. `PATHEXT=` 로 비워 둔 판(또는 `;;` 만 든 판)에서는 이
   * 목록이 통째로 비고, 그러면 아래 붙여보기 의 되풀이가 **한 번도 안 돌아** 무엇을
   * 물어도 null 이었다 — `npx` 는 못 찾아 ENOENT 로 안 뜨고, `x.cmd` 처럼 확장자까지
   * 적은 완전한 이름조차 못 찾아(`이미붙음` 도 빈 목록에서는 거짓이다) 전체 경로 대신
   * 이름만 cmd.exe 로 넘어간다. 그러면 위 머리말이 막으려던 자리로 되돌아간다 —
   * cmd.exe 는 PATH 보다 지금 폴더(남의 저장소일 수 있다)를 먼저 뒤진다.
   */
  const 기본확장 = '.COM;.EXE;.BAT;.CMD';
  const 적힌것 = String(env.PATHEXT ?? process.env.PATHEXT ?? 기본확장).split(';').filter(Boolean);
  const 확장들 = 적힌것.length ? 적힌것 : 기본확장.split(';');
  const 파일인가 = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
  const 이미붙음 = 확장들.some((e) => 명령.toLowerCase().endsWith(e.toLowerCase()));
  const 붙여보기 = (밑) => {
    if (이미붙음 && 파일인가(밑)) return 밑;
    for (const e of 확장들) if (파일인가(밑 + e)) return 밑 + e;
    return null;
  };
  if (/[\\/]/.test(명령) || isAbsolute(명령)) return 붙여보기(resolve(cwd ?? process.cwd(), 명령));
  for (const 길 of String(env.PATH ?? env.Path ?? '').split(';').filter(Boolean)) {
    const 찾음 = 붙여보기(join(길.replace(/^"|"$/g, ''), 명령));
    if (찾음) return 찾음;
  }
  return null;
}

/*
 * Bash·Jobs 가 자식에게 넘길 환경은 **여기 없다** — safety/shellenv.js 다.
 *
 * 여기 `열쇠뺀환경()` 이 있었다. 우리 열쇠(DEEL_API_KEY · DEEL_KEY_*)만 빼고
 * 나머지를 통째로 넘겼는데, 그러면 OPENAI_API_KEY·GITHUB_TOKEN·DB_PASSWORD
 * 가 그대로 넘어간다. 모델이 `env | grep -i proxy` 를 한 번 부르면 — 사내
 * 프록시를 확인하는 아주 정상적인 행동이다 — 그 값들이 도구 결과에 실려
 * 게이트웨이로 나가고 대화 기록으로 디스크에도 남는다.
 *
 * 두 벌로 두지 않고 옮겼다. 같은 판단이 두 자리에 있으면 늘 한쪽만 고쳐진다.
 */

/** 우리 도구 이름과 안 부딪히게 앞에 서버 이름을 붙인다. Claude Code 와 같은 꼴이다. */
export const 도구이름 = (서버, 도구) => `mcp__${서버}__${도구}`;

/** 붙인 이름에서 서버와 도구를 도로 뗀다. */
export function 이름풀기(전체) {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(String(전체 ?? ''));
  return m ? { 서버: m[1], 도구: m[2] } : null;
}

/**
 * 서버가 이 도구를 **읽기만 한다** 고 적었나 (MCP `annotations.readOnlyHint`).
 *
 * confirm 이 MCP 도구를 안 물을지 정하는 데만 쓴다 (loop.js 의 관문). 적힌 말은 남의 서버가 한
 * 말이라 좁게 믿는다 — 참(`true`)일 때만, 그리고 「지운다」(destructiveHint) 를 같이 적었으면
 * 앞뒤가 안 맞으니 안 믿는다. strict 는 이 말을 아예 안 본다.
 */
export function 읽기만하나(서버들, 전체) {
  const 갈린것 = 이름풀기(전체);
  if (!갈린것) return false;
  const 서버 = (서버들 ?? []).find((s) => s?.이름 === 갈린것.서버);
  const 적힌것 = (서버?.도구 ?? []).find((t) => t?.name === 갈린것.도구)?.annotations;
  return 적힌것?.readOnlyHint === true && 적힌것?.destructiveHint !== true;
}

/**
 * 설정에 적힌 서버를 전부 띄운다.
 *
 * 하나가 안 떠도 나머지는 쓴다 — 서버 하나 때문에 프로그램이 못 뜨면 안 된다.
 * 안 뜬 것은 **안 떴다고 말한다.** 조용히 빠지면 "왜 그 도구가 없지" 를
 * 영영 알 수 없다.
 */
export async function 다붙이기(root, { offline = false, timeout = 붙기제한, audit = null, env = process.env } = {}) {
  const 설정 = 설정읽기(root, { env });
  if (설정.오류) return { 서버들: [], 못한것: [{ 이름: '(설정)', 왜: 설정.오류 }], 설정 };
  // 규격 때문에 안 받은 것은 어느 길로 끝나든 같이 내놓는다 (설정읽기 머리말).
  const 안받은것 = 설정.못받은것 ?? [];
  /*
   * 서버를 다 빼면 적어 둔 목록도 걷는다 (2.0.2 · M4). 여기서 곧장 돌아서서, 다 뺀 판에는
   * 메모쓰기 의 걷기(남길이름)가 한 번도 안 돌았다 — 지운 서버들의 도구 목록이 파일에 그대로
   * 남는다. 설정에 없는 이름은 안 읽으니 해는 없지만, 남은 파일은 「아직 쓰는 서버」 로 읽힌다.
   */
  if (!설정.서버들.length) {
    메모쓰기(root, [], { 남길이름: [] });
    return { 서버들: [], 못한것: [...안받은것], 설정 };
  }

  /*
   * ── 믿는 폴더에서만 띄운다 ──────────────────────────────────────────
   *
   * 이 파일 머리말은 네 가지를 약속하는데(기본 꺼짐 · 자물쇠면 안 띄움 ·
   * 감사기록 · 범위 밖이라고 말함) **정작 제일 앞 문은 없었다.**
   *
   * `mcp.json` 은 프로젝트 폴더에 있고, 그러니 **저장소에 같이 딸려 온다.**
   * 남의 저장소를 clone 하고 그 안에서 deel 을 켜면, 거기 적힌 `command` 가
   * 이 계정 권한으로 자식 프로세스가 된다. 도구 승인 화면은 안 거친다 —
   * 모델이 부른 것이 아니라 우리가 「서버를 띄우려고」 부른 것이기 때문이다.
   *
   *     { "mcpServers": { "sync": { "command": "cmd", "args": ["/c", "…"] } } }
   *
   * 훅(safety/hooks.js)은 정확히 이 위협에 대해 `믿나(root)` 를 강제하고,
   * 그 파일 머리말은 「MCP 와 같은 무게로 다룬다」 고 적어 두었다. 그런데
   * 무게를 견주던 쪽에 그 문이 없었다. 프로젝트 설정(config.js)도 같은 문을
   * 지나간다 — 남의 프로그램을 띄우는 이 자리가 셋 중 제일 무거운데 혼자
   * 그냥 열려 있었다.
   *
   * 안 믿으면 **조용히 넘어가지 않는다.** 못 붙였다고 화면에 그대로 말하고,
   * 어떻게 하면 되는지(deel trust)까지 같이 말한다.
   */
  if (!믿나(root, { env })) {
    return {
      서버들: [],
      못한것: [...안받은것, ...설정.서버들.map((s) => ({
        이름: s.이름,
        왜: '믿는 폴더가 아닙니다 — 남의 저장소에 딸려 온 설정일 수 있어 안 띄웁니다 (deel trust)',
      }))],
      설정,
      안믿음: true,
    };
  }

  /*
   * 자물쇠가 걸려 있으면 띄우는 서버(stdio)는 안 띄운다. 자식 프로세스가 어디로 나가는지
   * 우리는 못 막는다 — 막을 수 없는 것을 막았다고 말하지 않는다.
   *
   * HTTP 로 붙는 서버는 **막을 수 있다** (2.1.3) — 물음마다 문지기를 지난다(파일 머리말). 그래서
   * 문지기와 같은 잣대(isLocalHost · 사내망 포함)로 이 컴퓨터 안이면 붙이고, 밖이면 여기서 까닭을 말한다.
   * 붙여 놓고 부를 때마다 「허용되지 않은 주소」 를 보게 하느니 처음부터 안 붙인다.
   */
  let 붙일것 = 설정.서버들;
  const 잠겨못한것 = [];
  if (offline) {
    붙일것 = 설정.서버들.filter((s) => s.방식 === 'http' && isLocalHost(new URL(s.url).hostname));
    for (const s of 설정.서버들) {
      if (붙일것.includes(s)) continue;
      잠겨못한것.push({
        이름: s.이름,
        왜: s.방식 === 'http' ? `오프라인 잠금 중에는 이 컴퓨터 밖(${new URL(s.url).host})으로 붙지 않습니다` : '오프라인 잠금 중에는 안 띄웁니다',
      });
    }
    if (!붙일것.length) return { 서버들: [], 못한것: [...안받은것, ...잠겨못한것], 설정, 잠김: true };
  }

  /*
   * ── 적어 둔 목록이 있으면 안 띄운다 ─────────────────────────────────
   *
   * 지문과 나이를 본 다음, 쓸 만하면 그 목록으로 세워 두기만 한다. 그 서버는
   * 제 도구가 처음 불릴 때 뜬다(MCP서버.깨우기).
   *
   * 끄는 길을 둔다 — `DEEL_MCP_LAZY=off`. 사내에서 「켤 때 다 뜨는지」 를
   * 확인해야 하는 자리가 있고, 그때 끌 방법이 없으면 이 기능이 곧 걸림돌이
   * 된다. 그리고 무엇이 대기 중인지는 /mcp 가 말한다 — 안 말하면 사람은
   * 서버가 안 떴다고 여긴다.
   */
  const 게으르게 = String(env.DEEL_MCP_LAZY ?? '').trim().toLowerCase() !== 'off';
  const 메모들 = 게으르게 ? 메모읽기(root) : {};

  const 붙은것 = [];
  const 못한것 = [...안받은것, ...잠겨못한것];
  let 새로띄운게있나 = false;
  await Promise.all(붙일것.map(async (s) => {
    const 서버 = s.방식 === 'http' ? new MCP웹서버(s) : new MCP서버(s);
    // 감사기록에는 무엇에 붙었나만 — 주소의 이름·비밀번호·물음표 뒤(열쇠가 실리는 자리)는 안 적는다.
    const 무엇 = s.방식 === 'http' ? { url: 적을주소(s.url) } : { command: s.command };
    const 메모 = 쓸만한메모(메모들[s.이름], s);
    if (메모) {
      붙은것.push(서버.메모로세우기(메모, root));
      audit?.write?.('mcp', { 이름: s.이름, ...무엇, 도구: 서버.도구.length, 대기: true });
      return;
    }
    const ok = await 서버.붙기({ timeout });
    if (ok) {
      새로띄운게있나 = true;
      붙은것.push(서버);
      audit?.write?.('mcp', { 이름: s.이름, ...무엇, 도구: 서버.도구.length });
    } else {
      못한것.push({ 이름: s.이름, 왜: 서버.죽음 ?? '알 수 없는 이유' });
      서버.닫기();
    }
  }));
  붙은것.sort((a, b) => a.이름.localeCompare(b.이름));
  /*
   * 이번에 정말 띄운 것이 하나라도 있으면 적어 둔다.
   *
   * 대기 중인 것은 이미 적혀 있던 그대로라 다시 안 적는다 — 그러면 적은때가
   * 매번 새로 찍혀서 「일주일이면 다시 확인한다」 가 영영 안 온다. 그건 세 겹
   * 그물 중 하나를 우리 손으로 걷는 것이다.
   */
  // 다 대기로 섰어도 설정에서 빠진 서버의 메모는 걷는다 (2.0.2 · M4 — 안 걷으면 새로 띄울 때까지 남는다).
  const 이름들 = 설정.서버들.map((s) => s.이름);
  const 걷을것 = Object.keys(메모들).some((n) => !이름들.includes(n));
  if (게으르게 && (새로띄운게있나 || 걷을것)) {
    // 대기 중인 것은 안 넘긴다(적은때를 새로 찍으면 안 된다). 그래도 그 메모는
    // 안 지워진다 — 메모쓰기 가 겹쳐 쓴다(그 머리말).
    메모쓰기(root, 붙은것.filter((s) => !s.대기), { 남길이름: 이름들 });
  }
  return { 서버들: 붙은것, 못한것, 설정, 게으르게, ...(offline ? { 잠김: true } : {}) };
}

/** 사람 눈과 감사기록에 보일 주소 — 이름·비밀번호·물음표 뒤를 뗀다. */
export function 적을주소(url) {
  try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return '(읽을 수 없는 주소)'; }
}

/** 모델에게 넘길 도구 정의로 바꾼다. */
export function 도구정의(서버들) {
  const out = [];
  for (const s of 서버들) {
    for (const t of s.도구) {
      out.push({
        type: 'function',
        function: {
          name: 도구이름(s.이름, t.name),
          description: `[${s.이름}] ${t.description ?? t.name}`,
          parameters: t.inputSchema ?? { type: 'object', properties: {} },
        },
      });
    }
  }
  return out;
}

// 이 PC 에 떠 있는 로컬 모델 서버를 전부 찾는다.
//
// 로컬 런타임은 하나만 쓰지 않는다. Ollama 로 작은 모델을 돌리면서
// LM Studio 로 큰 모델을 띄워 두는 식이 흔하다. 그래서 하나만 물어보지 않고
// 알려진 자리를 한꺼번에 두드려서 있는 대로 다 등록해 둔다.
//
// 두드리는 곳은 전부 이 컴퓨터(127.0.0.1) 다. 바깥으로 나가지 않는다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { req, headersFor } from './http.js';
import { 모델목록모양 } from './detect.js';
import { allowTemporarily } from '../safety/network.js';

// 포트는 겹칠 수 있다(llama.cpp 와 LocalAI 가 둘 다 8080). 그래서 포트로 단정하지 않고
// 응답을 보고 정한다. 아래 이름은 '그 포트에서 흔한 것' 이라는 힌트일 뿐이다.
export const KNOWN = [
  { port: 11434, hint: 'Ollama' },
  { port: 1234, hint: 'LM Studio' },
  { port: 8080, hint: 'llama.cpp · LocalAI' },
  { port: 8000, hint: 'vLLM · SGLang' },
  { port: 1337, hint: 'Jan' },
  { port: 5001, hint: 'KoboldCpp' },
  { port: 5000, hint: 'text-generation-webui · TabbyAPI' },
  { port: 4891, hint: 'GPT4All' },
  { port: 9997, hint: 'Xinference' },
  { port: 11435, hint: 'Ollama (두 번째)' },
  { port: 8081, hint: 'llama.cpp (두 번째)' },
  { port: 3000, hint: 'Open WebUI · LiteLLM' },
  { port: 4000, hint: 'LiteLLM' },
];

const fmtSize = (bytes) => {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${Math.round(bytes / 1024 ** 2)}MB`;
};

/**
 * 이 컴퓨터에서 실제로 듣고 있는 TCP 포트.
 *
 * 왜 필요한가:
 *   알려진 자리 13곳만 두드리면, 직접 세운 프록시나 사내 게이트웨이를 못 찾는다.
 *   그런 것들은 아무 포트나 쓴다. "안 잡히는데요" 의 대부분이 이 경우다.
 *
 *   그래서 운영체제에게 물어본다. 이미 열려 있는 걸 아는 포트라서 두드려도
 *   기다릴 일이 없다 — 죽은 포트를 찍는 것보다 오히려 빠르다.
 *
 * 못 물어봐도 그냥 넘어간다. 알려진 자리 훑기는 그대로 되기 때문이다.
 */
export function listeningPorts({ timeout = 4000 } = {}) {
  const 명령 = process.platform === 'win32'
    ? { file: 'netstat.exe', args: ['-ano', '-p', 'TCP'] }
    : process.platform === 'darwin'
      ? { file: 'netstat', args: ['-an', '-p', 'tcp'] }
      : { file: 'ss', args: ['-H', '-ltn'] };

  let out = '';
  try {
    out = execFileSync(명령.file, 명령.args, { timeout, encoding: 'latin1', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    // 리눅스에 ss 가 없을 수 있다. 그때는 커널이 직접 알려주는 표를 읽는다.
    if (process.platform === 'linux') return procNetTcp();
    return [];
  }

  const 포트 = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!/LISTEN/i.test(line)) continue;
    // 주소는 `0.0.0.0:8080` `[::]:8080` `*.8080` 중 하나로 온다.
    const m = line.match(/[\s[](?:[\d.]+|::[\da-f:%]*|\*)[\]]?[:.](\d{1,5})\s/i)
      ?? line.match(/:(\d{1,5})\s/);
    const p = Number(m?.[1]);
    if (p > 0 && p < 65536) 포트.add(p);
  }
  return [...포트].sort((a, b) => a - b);
}

function procNetTcp() {
  const 포트 = new Set();
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split('\n').slice(1)) {
      const col = line.trim().split(/\s+/);
      if (col.length < 4) continue;
      if (col[3] !== '0A') continue;              // 0A = LISTEN
      const p = parseInt(col[1].split(':')[1], 16);
      if (p > 0 && p < 65536) 포트.add(p);
    }
  }
  return [...포트].sort((a, b) => a - b);
}

// 살아 있는지부터 짧게 본다. 죽은 포트에서 오래 기다리면 훑기가 하염없이 느려진다.
async function probeOllama(origin, timeout) {
  const v = await req(`${origin}/api/version`, { timeout });
  if (!v.ok || !v.json?.version) return null;
  const tags = await req(`${origin}/api/tags`, { timeout: timeout * 2 });
  return {
    kind: 'ollama',
    runtime: 'Ollama',
    version: v.json.version,
    base: origin,
    auth: 'none',
    models: (tags.json?.models ?? []).map((m) => ({
      id: m.name ?? m.model,
      note: [m.details?.parameter_size, fmtSize(m.size)].filter(Boolean).join(' · '),
    })),
    ms: v.ms,
  };
}

// OpenAI 호환 서버가 놓일 수 있는 자리들.
//
// 대부분은 `/v1` 이다. 그런데 사내 게이트웨이나 직접 세운 프록시는 앞에 뭔가를
// 더 붙이는 경우가 많다 — 라우터 뒤에 붙이거나 여러 서비스를 한 포트에 모을 때
// 그렇게 된다. 그래서 흔한 모양 몇 가지를 더 본다.
// 죽은 포트에서는 첫 요청이 바로 실패하므로 훑는 시간에는 거의 영향이 없다.
const BASES = ['/v1', '', '/api/v1', '/openai/v1', '/api', '/llm/v1', '/proxy/v1'];

/*
 * 열쇠를 달라는 **OpenAI 식** 거절인가 (사냥5 B5-08).
 *
 * 몸에 `error` 칸이 있거나(OpenAI · LiteLLM · vLLM · llama.cpp 가 다 이 모양이다)
 * `WWW-Authenticate: Bearer` 로 열쇠를 달라고 할 때만 그렇다고 본다. `Basic realm=…` 에
 * 글자 「Unauthorized」 는 공유기·NAS 관리 화면의 말투다.
 */
function 열쇠달라는거절(r) {
  const h = r.headers;
  const 머리 = String((typeof h?.get === 'function' ? h.get('www-authenticate') : h?.['www-authenticate']) ?? '');
  if (/^\s*bearer\b/i.test(머리)) return true;
  const j = r.json;
  if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
  return typeof j.error === 'string' ? j.error.length > 0 : (!!j.error && typeof j.error === 'object');
}

async function probeOpenAI(origin, timeout, key) {
  for (const base of BASES.map((b) => `${origin}${b}`)) {
    const r = await req(`${base}/models`, { headers: headersFor(key ? 'bearer' : 'none', key), timeout });
    if (!r.ok) {
      /*
       * 규격은 맞는데 키가 없어 막힌 경우 — 서버가 있다는 사실은 알려 준다.
       *
       * 다만 **401 한 줄만으로는 이 규격이라고 못 한다** (사냥5 B5-08). 공유기·NAS 관리
       * 화면은 모든 길에 401 을 준다. 그걸 「잠김 — deel scan --key <키>」 로 올리면 남의
       * 프로그램에 우리 열쇠를 보내라고 권하는 셈이다. 그래서 거절 모양이 OpenAI 식일
       * 때만 센다. 놓치는 쪽으로 틀린다 — 못 찾은 서버는 주소를 직접 적으면 붙지만,
       * 보낸 열쇠는 못 돌려받는다.
       */
      if ((r.status === 401 || r.status === 403) && 열쇠달라는거절(r)) {
        return { kind: 'openai', runtime: null, base, auth: null, models: [], locked: true, ms: r.ms };
      }
      continue;
    }
    // 목록 모양이 아니면 이 규격이 아니다 — 설치(detect.js)와 같은 잣대.
    const list = 모델목록모양(r.json);
    if (!list) continue;
    return {
      kind: 'openai',
      runtime: null,
      base,
      auth: key ? 'bearer' : 'none',
      models: list
        .map((m) => (typeof m === 'string' ? { id: m } : { id: m.id ?? m.name ?? m.model, note: m.owned_by ?? '' }))
        .filter((m) => m.id),
      ms: r.ms,
    };
  }
  return null;
}

// 어떤 런타임인지 티 나는 자국을 찾는다. 못 찾으면 포트 힌트로 적고 '추정' 이라고 밝힌다.
async function fingerprint(origin, hit, timeout) {
  if (hit.runtime) return hit.runtime;
  const props = await req(`${origin}/props`, { timeout });          // llama.cpp
  if (props.ok && props.json?.default_generation_settings) return 'llama.cpp';
  const lms = await req(`${origin}/api/v0/models`, { timeout });    // LM Studio
  if (lms.ok && Array.isArray(lms.json?.data)) return 'LM Studio';
  const ver = await req(`${origin}/version`, { timeout });          // vLLM
  if (ver.ok && ver.json?.version) return 'vLLM';
  return null;
}

/**
 * 이 PC 를 훑는다.
 * @param {object} o
 * @param {string} o.host      기본 127.0.0.1
 * @param {number[]} o.ports   더 볼 포트
 * @param {number} o.timeout   포트 하나당 기다릴 시간(ms)
 * @param {(x)=>void} o.onFind 하나 찾을 때마다 알림
 */
export async function scanLocal({ host = '127.0.0.1', ports = [], timeout = 1200, key = '', onFind, listening = true, maxListening = 80 } = {}) {
  const list = [...KNOWN];
  for (const p of ports) if (!list.some((x) => x.port === p)) list.push({ port: p, hint: '직접 지정' });

  // 이 컴퓨터에서 실제로 듣고 있는 포트도 같이 본다.
  // 직접 세운 프록시는 알려진 자리에 없기 때문이다. 이 PC 안에서만 한다 —
  // 남의 컴퓨터 포트를 훑는 것은 이 도구가 할 일이 아니다.
  const 잘린것 = [];
  // IPv6 주소는 괄호를 씌워야 주소가 된다. 안 씌우면 `http://::1:11434` 가 Invalid URL 로
  // **훑기 전체를** 던졌다 — `deel scan --host ::1` 한 줄로 (2.0.0 6회차 Gemini 훑기6bf).
  const 주소host = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  if (listening && (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]')) {
    const 열린것 = listeningPorts().filter((p) => !list.some((x) => x.port === p));
    const 볼것 = 열린것.slice(0, maxListening);
    if (열린것.length > 볼것.length) 잘린것.push(...열린것.slice(maxListening));
    // 이름표는 '무엇인지' 를 적어야 한다. 어느 런타임인지 못 알아보면
    // 규격만이라도 적어 준다 — '열려 있는 자리' 는 사용자에게 아무 정보가 아니다.
    for (const p of 볼것) list.push({ port: p, hint: 'OpenAI 호환 서버' });
  }

  const jobs = list.map(async ({ port, hint }) => {
    const origin = `http://${주소host}:${port}`;
    // 훑는 동안만 그 자리를 연다. 끝나면 바로 닫아서 자물쇠를 원래대로 둔다.
    const close = allowTemporarily(origin);
    let hit;
    let runtime;
    try {
      // 먼저 'HTTP 로 말은 하는가' 만 짧게 본다.
      //
      // 이게 없으면 열려 있지만 HTTP 가 아닌 자리(파일 공유, RPC 같은)에서
      // 요청마다 시간 초과를 기다리게 된다. 자리 하나에 여러 길을 보므로
      // 그 기다림이 곱해져서, 훑기가 몇 초가 아니라 몇 분이 된다.
      //
      // 상태 0 은 '아무 답도 못 받았다' 는 뜻이다. 연결이 거절됐거나,
      // 열려 있어도 HTTP 로 답하지 않는 자리다. 둘 다 여기서 접는다.
      const 인사 = await req(`${origin}/`, { timeout: Math.min(timeout, 800) });
      if (인사.status === 0) return null;

      hit = await probeOllama(origin, timeout);
      if (!hit) hit = await probeOpenAI(origin, timeout, key);
      if (!hit) return null;
      runtime = await fingerprint(origin, hit, timeout);
    } finally { close(); }
    const found = {
      ...hit,
      port,
      host,
      runtime: runtime ?? hint,
      guessed: !runtime && hit.kind !== 'ollama',
      hint,
    };
    onFind?.(found);
    return found;
  });

  const found = (await Promise.all(jobs)).filter(Boolean);
  // 모델이 많은 쪽을 위로. 잠긴 것은 아래로.
  found.sort((a, b) => (a.locked ? 1 : 0) - (b.locked ? 1 : 0) || b.models.length - a.models.length || a.port - b.port);
  // 몇 자리를 안 봤는지 알려 준다. 조용히 자르면 '다 봤다' 로 읽힌다.
  found.훑은자리 = list.length;
  found.안본자리 = 잘린것;
  return found;
}

// 찾은 것을 설정 프로필 모양으로 바꾼다. 같은 자리가 이미 있으면 그걸 되쓴다.
export function toProfiles(found, existing = []) {
  const out = [];
  for (const f of found) {
    for (const m of f.models) {
      if (!m.id) continue;   // 이름 없는 것은 프로필이 못 된다 (모델 0대인 서버도 여기서 끝)
      const id = `${slugRuntime(f.runtime)}-${String(m.id).replace(/[^a-zA-Z0-9._-]+/g, '-')}`.slice(0, 60).toLowerCase();
      const prev = existing.find((p) => p.baseUrl === f.base && p.model === m.id);
      out.push({
        id: prev?.id ?? id,
        name: `${f.runtime} · ${m.id}`,
        kind: f.kind,
        baseUrl: f.base,
        /*
         * 잠금 방식은 **열쇠와 같이 움직인다.**
         *
         * 아래에서 `apiKey` 를 되쓰면서 여기만 훑은 값으로 덮고 있었다. 훑기는
         * 열쇠 없이 두드리므로 열쇠를 받는 서버도 `auth:'none'` 으로 보인다 —
         * 그래서 열쇠는 그대로 남고 방식만 none 이 되어, 쓰던 프로필이 열쇠를
         * 안 싣고 나가 조용히 401 로 돌아선다. 되쓰는 자리는 되쓴다.
         */
        auth: prev?.auth ?? f.auth ?? 'none',
        model: m.id,
        apiKey: prev?.apiKey ?? '',
        ctx: prev?.ctx ?? null,
        streaming: prev?.streaming ?? true,
        tools: prev?.tools ?? false,
        json: prev?.json ?? false,
        think: prev?.think ?? false,
        note: m.note ?? '',
        local: true,
      });
    }
  }
  return out;
}

const slugRuntime = (r) => String(r ?? 'local').split(/[\s·]+/)[0].toLowerCase().replace(/[^a-z0-9]+/g, '');

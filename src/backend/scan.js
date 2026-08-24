// 이 PC 에 떠 있는 로컬 모델 서버를 전부 찾는다.
//
// 로컬 런타임은 하나만 쓰지 않는다. Ollama 로 작은 모델을 돌리면서
// LM Studio 로 큰 모델을 띄워 두는 식이 흔하다. 그래서 하나만 물어보지 않고
// 알려진 자리를 한꺼번에 두드려서 있는 대로 다 등록해 둔다.
//
// 두드리는 곳은 전부 이 컴퓨터(127.0.0.1) 다. 바깥으로 나가지 않는다.
import { req, headersFor } from './http.js';
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

async function probeOpenAI(origin, timeout, key) {
  for (const base of [`${origin}/v1`, origin]) {
    const r = await req(`${base}/models`, { headers: headersFor(key ? 'bearer' : 'none', key), timeout });
    if (!r.ok || !r.json) {
      // 규격은 맞는데 키가 없어 막힌 경우 — 서버가 있다는 사실은 알려 준다.
      if (r.status === 401 || r.status === 403) {
        return { kind: 'openai', runtime: null, base, auth: null, models: [], locked: true, ms: r.ms };
      }
      continue;
    }
    const list = r.json.data ?? r.json.models ?? [];
    if (!Array.isArray(list)) continue;
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
export async function scanLocal({ host = '127.0.0.1', ports = [], timeout = 1200, key = '', onFind } = {}) {
  const list = [...KNOWN];
  for (const p of ports) if (!list.some((x) => x.port === p)) list.push({ port: p, hint: '직접 지정' });

  const jobs = list.map(async ({ port, hint }) => {
    const origin = `http://${host}:${port}`;
    // 훑는 동안만 그 자리를 연다. 끝나면 바로 닫아서 자물쇠를 원래대로 둔다.
    const close = allowTemporarily(origin);
    let hit;
    let runtime;
    try {
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
  return found.sort((a, b) => (a.locked ? 1 : 0) - (b.locked ? 1 : 0) || b.models.length - a.models.length || a.port - b.port);
}

// 찾은 것을 설정 프로필 모양으로 바꾼다. 같은 자리가 이미 있으면 그걸 되쓴다.
export function toProfiles(found, existing = []) {
  const out = [];
  for (const f of found) {
    for (const m of f.models.length ? f.models : [{ id: null }]) {
      if (!m.id) continue;
      const id = `${slugRuntime(f.runtime)}-${String(m.id).replace(/[^a-zA-Z0-9._-]+/g, '-')}`.slice(0, 60).toLowerCase();
      const prev = existing.find((p) => p.baseUrl === f.base && p.model === m.id);
      out.push({
        id: prev?.id ?? id,
        name: `${f.runtime} · ${m.id}`,
        kind: f.kind,
        baseUrl: f.base,
        auth: f.auth ?? 'none',
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

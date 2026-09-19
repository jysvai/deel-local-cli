// 여러 로컬 서버를 한꺼번에 찾아내는지 검증한다.
//
// 로컬 런타임은 하나만 쓰지 않는다. Ollama 로 작은 모델을, LM Studio 로 큰 모델을
// 동시에 띄워 두는 게 보통이다. 그래서 가짜 서버 세 대를 서로 다른 자리에 띄우고
// 훑기가 셋을 다 찾아 규격까지 구분하는지 본다.
import { createServer } from 'node:http';
import { scanLocal, toProfiles } from '../src/backend/scan.js';
import { recommend, 추천자리, 추천인가 } from '../src/backend/scanui.js';
import { resetNet } from '../src/safety/network.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const servers = [];
function 서버(handler) {
  const s = createServer((req, res) => {
    const body = handler(req.url);
    if (!body) { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  servers.push(s);
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
}

// 1) Ollama 흉내
const ollamaPort = await 서버((url) => {
  if (url === '/api/version') return { version: '0.5.7' };
  if (url === '/api/tags') {
    return { models: [
      { name: 'qwen2.5-coder:7b', size: 4_700_000_000, details: { parameter_size: '7B' } },
      { name: 'llama3.2:1b', size: 1_300_000_000, details: { parameter_size: '1B' } },
    ] };
  }
  return null;
});

// 2) LM Studio 흉내 — /v1/models 와 LM Studio 만의 /api/v0/models
const lmsPort = await 서버((url) => {
  if (url === '/v1/models') return { data: [{ id: 'devstral-small-2507', owned_by: 'org' }] };
  if (url === '/api/v0/models') return { data: [{ id: 'devstral-small-2507' }] };
  return null;
});

// 3) llama.cpp 흉내 — /props 가 있다
const llamaPort = await 서버((url) => {
  if (url === '/v1/models') return { data: [{ id: 'gemma-3-4b-it' }] };
  if (url === '/props') return { default_generation_settings: { n_ctx: 8192 } };
  return null;
});

resetNet();
// listening:false — 이 검사는 띄운 세 대만 봐야 한다. 이 PC 에 떠 있는 다른 것이
// 끼어들면 결과가 컴퓨터마다 달라진다. 훑기 자체는 아래에서 따로 본다.
const 내포트 = [ollamaPort, lmsPort, llamaPort];
const 훑은것 = await scanLocal({ ports: 내포트, timeout: 2500, listening: false });

/*
 * `ports` 는 **더 볼 자리**이지 볼 자리 전부가 아니다 — 알려진 자리(11434 · 1234 ·
 * 8080 …)는 언제나 같이 본다. `deel scan --ports 9000` 이 그렇게 동작해야 하고
 * README 에도 '추가로 볼 포트' 라고 적혀 있다.
 *
 * 그래서 이 검사는 **내가 띄운 세 대만** 골라 놓고 본다. 전에는 안 그랬고,
 * 이 PC 에서 LM Studio 가 1234 를 잡고 있던 날 네 대가 잡혀 무너졌다 —
 * 검사가 사람 컴퓨터에 무엇이 떠 있느냐에 따라 달라지면 안 된다.
 * (겸사겸사 검사가 남의 서버를 두드리지도 않게 된다.)
 */
const found = 훑은것.filter((f) => 내포트.includes(f.port));

check('세 대를 모두 찾음', found.length === 3, `${found.length}대`);

const byPort = Object.fromEntries(found.map((f) => [f.port, f]));
const o = byPort[ollamaPort];
const l = byPort[lmsPort];
const c3 = byPort[llamaPort];

check('Ollama 를 Ollama 로 알아봄', o?.runtime === 'Ollama' && o?.kind === 'ollama', o?.runtime);
check('Ollama 판까지 읽음', o?.version === '0.5.7', o?.version);
check('Ollama 모델 2개', o?.models.length === 2, String(o?.models.length));
check('모델 크기를 사람이 읽게', o?.models[0].note.includes('7B') && o?.models[0].note.includes('GB'), o?.models[0].note);

check('LM Studio 를 자국으로 알아봄', l?.runtime === 'LM Studio', l?.runtime);
check('LM Studio 는 OpenAI 호환으로', l?.kind === 'openai' && l?.base.endsWith('/v1'), l?.base);
check('LM Studio 는 추정이 아님', l?.guessed === false);

check('llama.cpp 를 /props 로 알아봄', c3?.runtime === 'llama.cpp', c3?.runtime);

// 알려준 세 자리는 하나도 안 빠뜨렸고, 그 밖에 잡힌 것은 전부 이 PC 에 진짜로
// 떠 있는 서버다(아무 답도 없는 자리를 '찾았다' 고 하지는 않는다).
check('알려준 자리를 하나도 안 빠뜨림', 내포트.every((p) => 훑은것.some((f) => f.port === p)),
  훑은것.map((f) => f.port).join(', '));
check('찾았다는 것은 전부 답을 한 자리', 훑은것.every((f) => f.base && (f.models?.length ?? 0) >= 0),
  훑은것.map((f) => `${f.port}:${f.runtime}`).join(', '));

// ── 프로필로 바꾸기 ─────────────────────────────────────────────────────
const profiles = toProfiles(found);
check('모델 하나당 프로필 하나', profiles.length === 4, `${profiles.length}개`);
check('이름에 런타임과 모델이 같이', profiles.some((p) => p.name.includes('Ollama') && p.name.includes('qwen2.5-coder')),
  profiles[0]?.name);
check('프로필 id 가 겹치지 않음', new Set(profiles.map((p) => p.id)).size === profiles.length);
check('주소가 서로 다름', new Set(profiles.map((p) => p.baseUrl)).size === 3);
check('로컬 표시가 붙음', profiles.every((p) => p.local === true));

// 이미 있던 설정은 되쓴다 — 키·검증결과를 훑기 한 번에 날리면 안 된다.
const 기존 = [{ id: 'my-ollama', baseUrl: `http://127.0.0.1:${ollamaPort}`, model: 'qwen2.5-coder:7b', apiKey: 'keep-me', tools: true, ctx: 40960 }];
const 다시 = toProfiles(found, 기존);
const 되쓴 = 다시.find((p) => p.model === 'qwen2.5-coder:7b');
check('기존 프로필 id 를 지킴', 되쓴?.id === 'my-ollama', 되쓴?.id);
check('기존 키를 안 날림', 되쓴?.apiKey === 'keep-me');
check('기존에 확인해 둔 능력을 안 날림', 되쓴?.tools === true && 되쓴?.ctx === 40960);

// ── 알려지지 않은 자리의 서버도 찾는가 ──────────────────────────────────
//
// 알려진 포트 13곳만 두드리면 직접 세운 프록시나 사내 게이트웨이를 못 찾는다.
// 그런 것들은 아무 포트나 쓰고, /v1 이 아닌 앞머리를 쓰기도 한다.
// 그래서 이 컴퓨터에서 실제로 듣고 있는 자리도 같이 본다.
{
  resetNet();
  // /v1/models 는 없고 /api/v1/models 만 있는 서버 — 프록시에 흔한 모양
  const 프록시 = createServer((req, res) => {
    if (req.url === '/api/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'gw-qwen-32b' }, { id: 'gw-llama-70b' }] }));
    }
    res.writeHead(404); res.end('nope');
  });
  servers.push(프록시);
  const 프록시포트 = await new Promise((r) => 프록시.listen(0, '127.0.0.1', () => r(프록시.address().port)));

  const t0 = Date.now();
  // ports 로 알려주지 않는다. 스스로 찾아야 한다.
  const 훑음 = await scanLocal({ timeout: 1200 });
  const 걸린시간 = Date.now() - t0;

  const 잡힘 = 훑음.find((f) => f.port === 프록시포트);
  check('안 알려준 자리의 서버를 찾아낸다', !!잡힘, `자리 ${훑음.훑은자리}곳 훑음`);
  check('/v1 이 아닌 앞머리도 찾는다', 잡힘?.base?.endsWith('/api/v1'), 잡힘?.base ?? '없음');
  check('모델 목록까지 가져온다', 잡힘?.models?.length === 2, (잡힘?.models ?? []).map((m) => m.id).join(', '));
  check('무엇인지 이름을 붙인다', typeof 잡힘?.runtime === 'string' && 잡힘.runtime.length > 0, 잡힘?.runtime ?? '');

  // HTTP 로 답하지 않는 자리에서 시간 초과를 기다리면 훑기가 몇 분이 된다.
  // 실제로 이 PC 에는 파일 공유·RPC 같은 자리가 여럿 열려 있다.
  check('열린 자리가 많아도 빨리 끝난다', 걸린시간 < 20000, `${(걸린시간 / 1000).toFixed(1)}초 · ${훑음.훑은자리}곳`);
  check('안 본 자리가 있으면 알려준다', Array.isArray(훑음.안본자리), String(훑음.안본자리?.length ?? '없음'));

  // 끄고 싶을 때 끌 수 있어야 한다.
  resetNet();
  const 안훑음 = await scanLocal({ ports: [], timeout: 800, listening: false });
  check('listening:false 면 안 훑는다', !안훑음.some((f) => f.port === 프록시포트), `${안훑음.length}대 찾음`);
}

// 듣고 있는 포트를 실제로 알아내는가
{
  const { listeningPorts } = await import('../src/backend/scan.js');
  const p = listeningPorts();
  check('듣고 있는 포트를 알아낸다', Array.isArray(p) && p.length > 0, `${p.length}개`);
  check('포트 번호가 말이 된다', p.every((x) => Number.isInteger(x) && x > 0 && x < 65536), p.slice(0, 6).join(', '));
  check('정렬되어 있다', p.every((x, i) => i === 0 || p[i - 1] <= x), '');
}

// ── 훑기가 자물쇠를 원래대로 돌려놓는가 ─────────────────────────────────
// ── 이 규격이 아닌 서버를 LLM 으로 올리지 않는다 (사냥5 B5-08) ───────────
{
  /*
   * 모든 길에 JSON·[] 를 주는 개발 서버가 「OpenAI 호환 · 추정」 으로 올라왔고,
   * 모든 길에 401 을 주는 공유기 관리 화면은 「잠김 — deel scan --key <키>」 로
   * 올라왔다. 뒤엣것은 **남의 프로그램에 우리 열쇠를 보내라** 고 권하는 말이다.
   */
  const 띄움 = (손) => new Promise((ok) => { const s = createServer(손); servers.push(s); s.listen(0, '127.0.0.1', () => ok(s.address().port)); });
  const 모든길 = (code, body, head) => (q, s) => { q.resume(); s.writeHead(code, head); s.end(body); };
  const 제이슨 = await 띄움(모든길(200, '{"status":"ok"}', { 'content-type': 'application/json' }));
  const 배열 = await 띄움(모든길(200, '[]', { 'content-type': 'application/json' }));
  const 공유기 = await 띄움(모든길(401, 'Unauthorized', { 'www-authenticate': 'Basic realm="router"' }));
  const 잠긴API = await 띄움(모든길(401, JSON.stringify({ error: { message: 'Invalid API Key', type: 'authentication_error' } }), { 'content-type': 'application/json' }));
  resetNet();
  const 찾음 = await scanLocal({ ports: [제이슨, 배열, 공유기, 잠긴API], timeout: 2500, listening: false });
  const 어디 = (p) => 찾음.find((x) => x.port === p);
  check('★★ 모든 길에 JSON 을 주는 서버를 OpenAI 로 안 올린다', !어디(제이슨), JSON.stringify(어디(제이슨)));
  check('★★ 모든 길에 [] 를 주는 서버도 안 올린다', !어디(배열), JSON.stringify(어디(배열)));
  check('★★ Basic 으로 잠긴 관리 화면에 열쇠를 넣으라고 안 한다', !어디(공유기), JSON.stringify(어디(공유기)));
  check('★ OpenAI 모양으로 거절한 401 은 여전히 「잠김」 으로 알려 준다', 어디(잠긴API)?.locked === true, JSON.stringify(어디(잠긴API)));
}

// ── IPv6 이 PC 주소 (2.0.0 6회차 Gemini 훑기6bf SC1) ─────────────────────
{
  /*
   * `::1` 은 훑기가 이 PC 로 쳐 주는 주소인데, 괄호 없이 `http://::1:포트` 를 지어
   * **훑기 전체가 Invalid URL 로 던졌다.** `deel scan --host ::1` 로 사람이 닿는다.
   * IPv6 가 꺼진 기계에서는 ::1 에 못 띄우므로 그때는 못 잰다고만 적는다.
   */
  const 육 = createServer((q, s) => {
    q.resume();
    if (q.url === '/api/tags') { s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end('{"models":[{"name":"qwen3:8b"}]}'); }
    if (q.url === '/api/version') { s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end('{"version":"0.9.0"}'); }
    s.writeHead(200); s.end('Ollama is running');
  });
  const 떴나 = await new Promise((ok) => { 육.once('error', () => ok(false)); 육.listen(0, '::1', () => ok(true)); });
  if (!떴나) {
    check('(IPv6 가 없는 기계 — ::1 훑기는 못 쟀다)', true);
  } else {
    servers.push(육);
    const 육포트 = 육.address().port;
    for (const 주인 of ['::1', '[::1]']) {
      resetNet();
      let 탈 = null;
      let 찾음 = [];
      try { 찾음 = await scanLocal({ host: 주인, ports: [육포트], timeout: 2500, listening: false }); } catch (e) { 탈 = e; }
      check(`★★ host ${주인} 가 훑기를 던지지 않는다`, 탈 === null, 탈?.message ?? '');
      const 그것 = 찾음.find((x) => x.port === 육포트);
      check(`★ host ${주인} — ::1 에 뜬 서버를 찾고 쓸 수 있는 주소를 준다`,
        /^http:\/\/\[::1\]:\d+/.test(그것?.base ?? ''), JSON.stringify(그것?.base ?? null));
    }
  }
}

// ── 「작은 모델」 을 이름으로 짐작할 때 큰 모델을 작다고 하면 안 된다 ────
//
// `작음` 이 `3b`·`2b` 를 글 아무 데서나 찾아, 이 PC 에서 제일 많이 쓰는
// `qwen2.5-coder:32b`(32B)·`codellama:13b`(13B) 가 **작은 모델**로 세어졌다.
// 점수가 1점 깎이고, 화면에는 「다만 작은 모델이라 도구 호출이 불안할 수
// 있습니다」 라는 **거짓 경고**가 붙는다. 이 저장소가 거짓 경고를 진짜 결함과
// 같은 무게로 세는 까닭 그대로다.
{
  const 서버 = (model) => [{ kind: 'ollama', base: 'http://127.0.0.1:11434', models: [{ id: model }] }];
  const 작다하나 = (model) => /작은 모델/.test(recommend(서버(model))?.why ?? '');

  for (const 큰것 of ['qwen2.5-coder:32b', 'codellama:13b', 'qwen3:30b', 'gpt-oss:120b', 'llama3.1:70b']) {
    check(`★ ${큰것} 를 작다고 안 한다`, !작다하나(큰것), recommend(서버(큰것))?.why ?? '');
  }
  for (const 작은것 of ['qwen2.5:3b', 'qwen2.5:2b', 'llama3.2:1b', 'qwen2.5:0.5b', 'qwen2.5:1.5b']) {
    check(`${작은것} 는 작다고 한다`, 작다하나(작은것), recommend(서버(작은것))?.why ?? '');
  }
}

// ── 추천은 이름에 단서가 있을 때만 한다 ─────────────────────────────────
//
// 점수는 「비작음 +1 · ollama +1」 만으로도 2점이 찬다. 그래서 이름이 아무 말도
// 안 하는 모델 — 임베딩 전용 `nomic-embed-text` 같은 것 — 까지 「추천」 으로
// 올라왔고, 이유 줄에는 「실제로 되는지는 deel diagnose 로 확인하세요」 한 마디만
// 남았다. 짐작의 근거가 이름인데 그 이름이 아무 단서도 안 줄 때는 **안 권한다.**
{
  const 서버 = (model) => [{ kind: 'ollama', base: 'http://127.0.0.1:11434', port: 11434, models: [{ id: model }] }];
  check('★ 이름에 단서가 없으면 안 권한다', recommend(서버('nomic-embed-text')) === null,
    JSON.stringify(recommend(서버('nomic-embed-text'))));
  check('★ 단서가 있으면 여태처럼 권한다', recommend(서버('qwen2.5-coder:32b'))?.model === 'qwen2.5-coder:32b', '');
  check('도구 계열 단서만 있어도 권한다', recommend(서버('llama3.1:8b'))?.model === 'llama3.1:8b', '');

  /*
   * ── 같은 모델이 두 서버에 있으면 「추천」 표와 고르개 기본값이 갈렸다 ──
   *
   * 표는 포트까지 보고(`p.baseUrl.includes(추천.port)`) 붙이는데 기본값은
   * 모델 이름만 봤다. 그래서 둘째 서버를 권해 놓고 커서는 첫째에 앉아,
   * 엔터를 치면 **권하지 않은 쪽**이 등록된다.
   */
  const 둘 = [
    { name: 'A', model: '가모델', baseUrl: 'http://127.0.0.1:11434/v1' },
    { name: 'B', model: '가모델', baseUrl: 'http://127.0.0.1:1234/v1' },
  ];
  const 권한것 = { model: '가모델', port: 1234 };
  check('★ 추천 표와 고르개 기본값이 같은 것을 가리킨다',
    추천자리(둘, 권한것) === 1 && 추천인가(둘[1], 권한것) && !추천인가(둘[0], 권한것),
    `자리 ${추천자리(둘, 권한것)}`);
  check('추천이 없으면 첫째가 기본값이다', 추천자리(둘, null) === 0, String(추천자리(둘, null)));
}

// ── 되쓰는 프로필의 열쇠와 잠금 방식은 같이 움직인다 (8회차 뒷단) ────────
//
// `toProfiles` 머리말은 「같은 자리가 이미 있으면 그걸 되쓴다」 고 적어 두고
// `apiKey`·`ctx`·`tools` 를 되썼는데, `auth` 한 칸만 이번 훑기 값으로 덮었다.
// 훑기는 열쇠 없이 두드리므로 열쇠를 받는 서버도 `auth:'none'` 으로 보인다 —
// 그래서 **열쇠는 그대로 남고 잠금 방식만 none 이 되어** 열쇠가 안 실린다.
// 쓰던 프로필이 조용히 401 로 돌아서는데, 화면에는 아무 말도 안 나온다.
{
  const 찾은것 = [{
    base: 'http://127.0.0.1:1234/v1', kind: 'openai', runtime: 'LM Studio', auth: 'none',
    models: [{ id: 'gpt-x' }],
  }];
  const 있던것 = [{
    id: '사내', baseUrl: 'http://127.0.0.1:1234/v1', model: 'gpt-x',
    auth: 'bearer', apiKey: 'SECRET', ctx: 8192, tools: true,
  }];
  const 되쓴것 = toProfiles(찾은것, 있던것)[0];
  check('★★ 열쇠를 되쓰면 잠금 방식도 되쓴다', 되쓴것.auth === 'bearer' && 되쓴것.apiKey === 'SECRET',
    JSON.stringify({ auth: 되쓴것.auth, apiKey: 되쓴것.apiKey }));
  check('되쓸 것이 없으면 훑은 값을 쓴다', toProfiles(찾은것)[0].auth === 'none', toProfiles(찾은것)[0].auth);

  // 이름 없는 모델은 프로필이 안 된다 — 모델 0대인 서버도 마찬가지다.
  const 빈서버 = [{ base: 'http://127.0.0.1:1234/v1', kind: 'openai', runtime: 'LM Studio', auth: 'none', models: [] }];
  check('★ 모델이 하나도 없는 서버는 프로필을 안 만든다', toProfiles(빈서버).length === 0,
    JSON.stringify(toProfiles(빈서버)));
  const 이름없음 = [{ base: 'http://127.0.0.1:1234/v1', kind: 'openai', runtime: 'LM Studio', auth: 'none', models: [{ note: '이름 없음' }] }];
  check('★ 이름 없는 모델도 프로필을 안 만든다', toProfiles(이름없음).length === 0,
    JSON.stringify(toProfiles(이름없음)));
}

// ── `mini` 가 `minimax` 안에서 걸려 초대형 모델에 거짓 경고 (8회차 뒷단) ──
//
// 크기 토막은 통째로 맞아야 한다고 같은 파일이 적어 놓고 `mini`·`small`·`tiny`
// 는 글 아무 데서나 찾았다. `minimax-m2`(230B) 는 바로 윗줄에서 「도구 호출을
// 잘하는 계열」 로 올려 놓고, 같은 줄에서 「작은 모델이라 도구 호출이 불안할 수
// 있습니다」 를 붙인다. `gemini` 도 이 무늬에 걸린다.
{
  const 서버 = (model) => [{ kind: 'ollama', base: 'http://127.0.0.1:11434', port: 11434, models: [{ id: model }] }];
  const 작다하나 = (model) => /작은 모델/.test(recommend(서버(model))?.why ?? '');
  for (const 큰것 of ['minimax-m2', 'MiniMax-M1-80k']) {
    check(`★★ ${큰것} 를 작다고 안 한다`, !작다하나(큰것), recommend(서버(큰것))?.why ?? '(안 권함)');
  }
  check('토막으로 떨어진 mini 는 여전히 작다고 한다', 작다하나('qwen3-mini'), recommend(서버('qwen3-mini'))?.why ?? '(안 권함)');
}

// ── `deepseek` 가 통째로 「코딩용」 이 된다 (8회차 뒷단) ──────────────────
//
// `qwen`·`granite` 는 `.*cod` 를 요구하는데 `deepseek` 만 이름만으로 코딩용이
// 된다. `deepseek-r1`(추론) · `deepseek-chat`(대화) 에 「코딩용 모델」 이 붙고,
// 그 3점이 진짜 코딩 모델을 밀어내고 추천 자리를 가져간다.
{
  const 서버 = (model) => [{ kind: 'ollama', base: 'http://127.0.0.1:11434', port: 11434, models: [{ id: model }] }];
  const 코딩이라하나 = (model) => /코딩용 모델/.test(recommend(서버(model))?.why ?? '');
  for (const 코딩아닌것 of ['deepseek-r1:32b', 'deepseek-chat']) {
    check(`★ ${코딩아닌것} 에 「코딩용 모델」 을 안 붙인다`, !코딩이라하나(코딩아닌것),
      recommend(서버(코딩아닌것))?.why ?? '(안 권함)');
  }
  check('deepseek-coder 는 여전히 코딩용이다', 코딩이라하나('deepseek-coder-v2:16b'),
    recommend(서버('deepseek-coder-v2:16b'))?.why ?? '(안 권함)');
}

// ── `includes('80')` 이 8080 을 80 으로 센다 (8회차 뒷단) ────────────────
//
// 「잣대를 하나로 둔다」 고 적은 바로 그 줄이 포트를 글자로 찾는다. 8080 과 80
// 에 같은 모델이 떠 있으면 80 을 권해 놓고 커서는 8080 에 앉아, 엔터를 치면
// 권하지 않은 쪽이 등록된다 — 이 함수가 막으려던 사고 그 자체다.
{
  const 둘 = [
    { name: 'A', model: '가모델', baseUrl: 'http://127.0.0.1:8080/v1' },
    { name: 'B', model: '가모델', baseUrl: 'http://127.0.0.1:80/v1' },
  ];
  const 권한것 = { model: '가모델', port: 80 };
  check('★★ 8080 을 80 추천으로 안 센다', 추천자리(둘, 권한것) === 1 && !추천인가(둘[0], 권한것),
    `자리 ${추천자리(둘, 권한것)}`);
  check('8080 을 권하면 8080 에 앉는다', 추천자리(둘, { model: '가모델', port: 8080 }) === 0,
    String(추천자리(둘, { model: '가모델', port: 8080 })));
  check('포트가 끝에 붙은 주소도 센다', 추천인가({ model: 'm', baseUrl: 'http://127.0.0.1:11434' }, { model: 'm', port: 11434 }));
}

const { allowed } = await import('../src/safety/network.js');
check('훑고 나면 열어 둔 자리를 다 닫음', allowed().length === 0, allowed().join(', '));

for (const s of servers) { s.closeAllConnections?.(); s.close(); }
await new Promise((r) => setImmediate(r));

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n로컬 서버 훑기 검사  ' + D + '(여러 런타임을 한꺼번에 찾아 구분하는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;

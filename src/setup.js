// 첫 실행 마법사 + 진단 실행.
import { c, say, rule, mark } from './ui/ansi.js';
import { 주소가리기 } from './safety/secrets.js';
import { ask, pick, confirm } from './ui/prompt.js';
import { spin } from './ui/spinner.js';
import { detect } from './backend/detect.js';
import { probe } from './backend/probe.js';
import { renderHeader, renderLine, verdict, renderVerdict, plainReport } from './report.js';
import { load, save, upsert, slug, resolveKey, activeProfile, configPath } from './config.js';
import { 보관방식 } from './safety/keystore.js';
import { 애저풀기, 애저base } from './backend/azure.js';
import { allowEndpoint } from './safety/network.js';
import { 바깥인가 } from './safety/runmode.js';
import { writeFileSync } from 'node:fs';

export function banner() {
  say('');
  say(`  ${c.cyan('deel')} ${c.gray('— 로컬 모델 코딩 에이전트')}`);
  say('');
}

// 주소와 키를 받아 연결을 찾아낸다. 실패하면 null.
async function connect(url, key) {
  const s = spin(`${url} 확인 중...`);
  /*
   * 사용자가 방금 적어 넣은 주소다. 확인하는 동안만 문을 연다.
   *
   * 스킴을 안 적었으면 **두 가지 다 열어 둔다.** 자리마다 기본으로 붙이는
   * 스킴이 다르기 때문이다 — 로컬 서버를 찾는 쪽은 `http://` 를, Azure 쪽은
   * `https://` 를 붙인다. 한쪽만 열어 두면 우리가 만든 주소를 우리 자물쇠가
   * 막고, 화면에는 "허용되지 않은 주소" 만 뜬다. 여는 것은 사람이 적어 넣은
   * 그 호스트 하나뿐이라 넓어지는 것이 아니다.
   */
  allowEndpoint(/^https?:\/\//i.test(url) ? url : [`http://${url}`, `https://${url}`]);
  const found = await detect(url, key);
  if (!found.kind) {
    s.stop(`  ${mark.no} ${c.red('연결 실패')}`);
    say('');
    say(`    시도한 주소:`);
    for (const t of found.tried) say(`      ${c.gray(주소가리기(t.includes('?') ? t : `${t}/models`))}`);
    say('');
    say(`    ${c.gray('확인할 것 — 주소·포트가 맞는지, 프록시가 필요한지,')}`);
    say(`    ${c.gray('사내 인증서라면 NODE_EXTRA_CA_CERTS 환경변수가 필요합니다.')}`);
    say('');
    return null;
  }
  const kindName = found.kind === 'ollama' ? `Ollama ${found.version ?? ''}`.trim() : 'OpenAI 호환';
  s.stop(`  ${mark.ok} ${c.green('연결됨')} ${c.gray(`${kindName} · ${found.ms}ms`)}`);
  // 물음표 뒤에 열쇠를 싣는 앞단이 있다 (safety/secrets.js 의 주소가리기).
  say(`    ${c.gray('주소')} ${주소가리기(found.base)}`);
  say(`    ${c.gray('인증')} ${found.auth === 'none' ? '없음' : found.auth}`);
  say(`    ${c.gray('모델')} ${found.models.length}개 발견`);
  if (found.warn) say(`    ${mark.warn} ${c.yellow(found.warn)}`);
  return found;
}

async function chooseModel(found) {
  if (!found.models.length) {
    say('');
    say(`  ${mark.warn} ${c.yellow('모델 목록을 못 받았습니다.')} ${c.gray('이름을 직접 넣어 주세요.')}`);
    return (await ask('모델 이름')).trim();
  }
  const items = found.models.slice(0, 40).map((m) => ({ label: m.id, note: m.note ?? '' }));
  const i = await pick('사용할 모델', items);
  return items[i].label;
}

// 진단을 돌리고 결과를 화면에 그린다.
export async function runProbe(conn, { out = null } = {}) {
  allowEndpoint(conn.base);   // 진단도 이 주소 하나로만 나간다
  renderHeader({ shape: conn.kind, base: conn.base, auth: conn.auth, model: conn.model });
  const { facts, results } = await probe(conn, renderLine);
  const v = verdict(facts, results);
  renderVerdict(v);
  if (out) {
    writeFileSync(out, plainReport(facts, results, v), 'utf8');
    say(`  ${mark.ok} 보고서 저장됨 ${c.cyan(out)}`);
    say(`     ${c.gray('사내망에서 돌렸다면 이 파일만 가져오시면 됩니다.')}`);
    say('');
  }
  return { facts, results, v };
}

export async function runSetup() {
  banner();
  // 설정에 적어 둔 api-version 을 **붙기 전에** 읽는다. load() 가 애저정하기()를
  // 부른다. 이걸 뒤에서 하면 사내에서 판을 고정해 둔 곳이 확인만 GA판으로 하고,
  // 문서에 적어 둔 대로 안 도는 셈이 된다.
  load();
  say(`  ${c.gray('모델 연결을 설정합니다. 주소와 키만 있으면 됩니다.')}`);
  say('');

  const name = (await ask('이름', { def: '사내게이트웨이' })).trim();
  const url = (await ask('주소 (Base URL)')).trim();
  if (!url) { say(`  ${mark.no} 주소가 비었습니다.`); return 1; }
  const key = (await ask('API 키', { mask: true })).trim();

  say('');
  const found = await connect(url, key);
  if (!found) return 1;

  const model = await chooseModel(found);
  if (!model) { say(`  ${mark.no} 모델이 비었습니다.`); return 1; }

  /*
   * Azure 는 모델 이름이 **주소 안에** 있다.
   *
   * 목록에서 다른 배포를 골랐으면 주소도 그 배포로 바꿔야 한다. 안 바꾸면
   * 화면에는 고른 이름이 보이는데 요청은 처음 주소의 배포로 나간다 —
   * 사람이 알아챌 방법이 없는 어긋남이다.
   */
  if (found.azure) {
    const 푼것 = 애저풀기(found.base);
    if (푼것) found.base = 애저base(푼것.origin, model, 푼것.판);
  }

  const conn = { kind: found.kind, base: found.base, auth: found.auth, key, model };
  const { facts } = await runProbe(conn);

  /*
   * ── 「나가도 된다」 를 여기서 명시적으로 받는다 ───────────────────────
   *
   * 주소와 허가를 뗀 것이 이번 자물쇠의 요점이다(safety/runmode.js). 주소는
   * 설정 파일에 그대로 있고 손으로도 고칠 수 있지만, 허가는 **사람이 고른
   * 자리에서만** 붙는다. 그래서 둘 다 있어야 나간다 — 설정 파일 한 줄을
   * 고쳐서는 못 나간다.
   *
   * 여기서 안 받아도 대화 화면이 첫 켤 때 다시 묻는다. 그러니 이건 막는
   * 자리가 아니라, **지금 사실을 알려 주는** 자리다. 주소를 방금 친 사람이
   * 그 주소가 바깥이라는 것을 제일 잘 알아들을 자리이기도 하다.
   */
  let 나가도되나 = false;
  if (바깥인가(found.base)) {
    say('');
    say(`  ${c.yellow('↗')} ${c.bold(주소가리기(found.base))} ${c.gray('는 이 컴퓨터 밖입니다.')}`);
    say(`     ${c.gray('쓰면 시킨 말과, 모델이 읽은 파일의 내용이 그리로 갑니다.')}`);
    나가도되나 = await confirm('이 연결로 바깥에 나가도 될까요?', true);
    if (!나가도되나) {
      say(`  ${c.gray('허락 없이 저장합니다 — 이 연결로 처음 켤 때 다시 물어봅니다.')}`);
    }
  }

  const id = slug(name);
  const cfg = load();
  upsert(cfg, {
    id, name,
    kind: found.kind,
    baseUrl: found.base,
    auth: found.auth,
    apiKey: key,
    model,
    // 로컬·사내망이면 이 칸 자체가 없다. 있는 것만으로도 「바깥이다」 라는 뜻이라,
    // 설정 파일을 열어 본 사람이 그것만 보고도 안다.
    ...(나가도되나 ? { online: true } : {}),
    ctx: facts.ctx ?? null,
    streaming: facts.streaming ?? false,
    tools: facts.tools ?? false,
    json: facts.json ?? false,
    think: facts.think ?? false,
    vision: facts.vision ?? false,
  });
  cfg.active = id;
  const p = save(cfg);

  say(`  ${mark.ok} 저장됨 ${c.cyan(p)}`);
  if (key) {
    // 열쇠가 파일에 '어떤 꼴로' 들어갔는지를 그대로 적는다. 잠겼는지 아닌지를
    // 사람이 짐작하게 두면, 안 잠긴 파일을 잠긴 줄 알고 아무 데나 둔다.
    const 저장한것 = activeProfile(load())?.apiKey ?? null;
    say(`     ${c.gray(`열쇠 보관 — ${보관방식(저장한것)}`)}`);
    say(`     ${c.gray('파일에 아예 안 남기려면 환경변수 DEEL_API_KEY 로 넣으세요 — 그쪽이 우선합니다.')}`);
  }
  say('');
  return 0;
}

// 저장된 프로필 또는 인자로 받은 값으로 진단만 다시 돌린다.
export async function runDiagnose(flags) {
  banner();
  let conn;

  if (flags.url) {
    load();      // 설정의 api-version 을 먼저 읽는다 (runSetup 과 같은 이유)
    const key = flags.key ?? process.env.DEEL_API_KEY ?? '';
    const found = await connect(flags.url, key);
    if (!found) return 1;
    const model = flags.model ?? (found.models[0]?.id ?? '');
    if (!model) { say(`  ${mark.no} 모델을 지정해 주세요 (--model).`); return 1; }
    conn = { kind: found.kind, base: found.base, auth: found.auth, key, model };
  } else {
    const cfg = load();
    const prof = activeProfile(cfg);
    if (!prof) {
      say(`  ${mark.warn} 저장된 연결이 없습니다. ${c.cyan('deel setup')} 을 먼저 실행하세요.`);
      say(`     ${c.gray('또는')} deel diagnose --url <주소> --key <키> --model <모델>`);
      say('');
      return 1;
    }
    say(`  ${c.gray('프로필')} ${c.bold(prof.name)} ${c.gray(configPath())}`);
    conn = {
      kind: prof.kind, base: prof.baseUrl, auth: prof.auth,
      key: resolveKey(prof), model: flags.model ?? prof.model,
    };
  }

  await runProbe(conn, { out: flags.out ?? null });
  return 0;
}

export async function showStatus() {
  banner();
  const cfg = load();
  if (!cfg.profiles.length) {
    say(`  ${c.gray('아직 연결이 없습니다.')}`);
    say('');
    say(`    ${c.cyan('deel setup')}   ${c.gray('연결 설정하기')}`);
    say('');
    return 0;
  }
  rule('연결 목록', 74);
  for (const p of cfg.profiles) {
    const here = p.id === cfg.active ? c.cyan(' ← 지금') : '';
    const caps = [
      p.tools ? c.green('도구') : c.red('도구'),
      p.streaming ? c.green('스트림') : c.gray('스트림'),
      p.json ? c.green('스키마') : c.gray('스키마'),
      p.think ? c.green('추론') : c.gray('추론'),
    ].join(c.gray('·'));
    say(`  ${c.bold(p.name)}  ${c.gray(p.model)}  ${caps}${here}`);
    /*
     * 바깥으로 나가는 연결인지, 그리고 허락이 붙어 있는지를 같이 적는다.
     *
     * 주소만 보고는 모른다 — `gw.회사.com` 이 사내인지 바깥인지는 사람이
     * 헷갈리는 자리다. 그리고 허락이 없으면 켤 때 물어본다는 사실도 여기서
     * 미리 알려 준다. 안 그러면 "왜 갑자기 물어보지" 가 된다.
     */
    const 바깥 = 바깥인가(p.baseUrl);
    const 표 = 바깥
      ? `${c.yellow('↗ 바깥')}${p.online ? c.gray(' · 나가도 됨') : c.gray(' · 켤 때 물어봄')}`
      : c.green('⌂ 이 안');
    say(`    ${c.gray(주소가리기(p.baseUrl))}  ${표}`);
  }
  say('');
  say(`  ${c.gray('설정 파일')} ${configPath()}`);
  say('');
  return 0;
}

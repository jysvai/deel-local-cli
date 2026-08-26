// 첫 실행 마법사 + 진단 실행.
import { c, say, rule, mark } from './ui/ansi.js';
import { ask, pick } from './ui/prompt.js';
import { spin } from './ui/spinner.js';
import { detect } from './backend/detect.js';
import { probe } from './backend/probe.js';
import { renderHeader, renderLine, verdict, renderVerdict, plainReport } from './report.js';
import { load, save, upsert, slug, resolveKey, activeProfile, configPath } from './config.js';
import { allowEndpoint } from './safety/network.js';
import { writeFileSync } from 'node:fs';

export function banner() {
  say('');
  say(`  ${c.cyan('deel')} ${c.gray('— 로컬 모델 코딩 에이전트')}`);
  say('');
}

// 주소와 키를 받아 연결을 찾아낸다. 실패하면 null.
async function connect(url, key) {
  const s = spin(`${url} 확인 중...`);
  // 사용자가 방금 적어 넣은 주소다. 확인하는 동안만 문을 연다.
  allowEndpoint(/^https?:\/\//i.test(url) ? url : 'http://' + url);
  const found = await detect(url, key);
  if (!found.kind) {
    s.stop(`  ${mark.no} ${c.red('연결 실패')}`);
    say('');
    say(`    시도한 주소:`);
    for (const t of found.tried) say(`      ${c.gray(t + '/models')}`);
    say('');
    say(`    ${c.gray('확인할 것 — 주소·포트가 맞는지, 프록시가 필요한지,')}`);
    say(`    ${c.gray('사내 인증서라면 NODE_EXTRA_CA_CERTS 환경변수가 필요합니다.')}`);
    say('');
    return null;
  }
  const kindName = found.kind === 'ollama' ? `Ollama ${found.version ?? ''}`.trim() : 'OpenAI 호환';
  s.stop(`  ${mark.ok} ${c.green('연결됨')} ${c.gray(`${kindName} · ${found.ms}ms`)}`);
  say(`    ${c.gray('주소')} ${found.base}`);
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

  const conn = { kind: found.kind, base: found.base, auth: found.auth, key, model };
  const { facts } = await runProbe(conn);

  const id = slug(name);
  const cfg = load();
  upsert(cfg, {
    id, name,
    kind: found.kind,
    baseUrl: found.base,
    auth: found.auth,
    apiKey: key,
    model,
    ctx: facts.ctx ?? null,
    streaming: facts.streaming ?? false,
    tools: facts.tools ?? false,
    json: facts.json ?? false,
    think: facts.think ?? false,
  });
  cfg.active = id;
  const p = save(cfg);

  say(`  ${mark.ok} 저장됨 ${c.cyan(p)}`);
  if (key) {
    say(`     ${c.gray('키가 이 파일에 들어 있습니다. 남기고 싶지 않으면 파일에서 지우고')}`);
    say(`     ${c.gray('환경변수 DEEL_API_KEY 로 넣으세요 — 그쪽이 우선합니다.')}`);
  }
  say('');
  return 0;
}

// 저장된 프로필 또는 인자로 받은 값으로 진단만 다시 돌린다.
export async function runDiagnose(flags) {
  banner();
  let conn;

  if (flags.url) {
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
    say(`    ${c.gray(p.baseUrl)}`);
  }
  say('');
  say(`  ${c.gray('설정 파일')} ${configPath()}`);
  say('');
  return 0;
}

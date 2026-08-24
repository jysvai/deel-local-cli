// deel scan — 이 PC 의 로컬 모델 서버를 훑어 보여 주고, 원하면 전부 등록한다.
import { c, say, rule, pad, mark, clip, width } from '../ui/ansi.js';
import { pick } from '../ui/prompt.js';
import { spin } from '../ui/spinner.js';
import { scanLocal, toProfiles, KNOWN } from './scan.js';
import { load, save, upsert } from '../config.js';

// 코딩 에이전트로 쓰려면 도구 호출이 되어야 한다. 진단 전이라 확실히는 모르니,
// 이름에 드러난 단서로 짐작해서 권한다. 틀릴 수 있다는 것을 문구에 밝힌다.
const 도구잘함 = /(qwen|llama-?3|llama3|mistral|devstral|hermes|command-?r|firefunction|granite|gpt-?oss|glm|kimi|minimax|seed-?oss)/i;
const 코딩 = /(cod(e|er|ing)|devstral|starcoder|deepseek|qwen.*cod|granite.*cod)/i;
const 작음 = /(0\.5b|1\.5b|1b|2b|3b|tiny|mini|small)/i;

function recommend(found) {
  const all = [];
  for (const f of found) for (const m of f.models) all.push({ ...f, model: m.id, note: m.note ?? '' });
  if (!all.length) return null;

  const 점수 = (x) => {
    let s = 0;
    if (코딩.test(x.model)) s += 3;
    if (도구잘함.test(x.model)) s += 2;
    if (!작음.test(x.model)) s += 1;          // 너무 작으면 도구 호출을 잘 못 한다
    if (x.kind === 'ollama') s += 1;          // 규격이 확실히 확인된 쪽
    return s;
  };
  const best = all.map((x) => ({ x, s: 점수(x) })).sort((a, b) => b.s - a.s)[0];
  if (!best || best.s < 2) return null;

  const 이유 = [];
  if (코딩.test(best.x.model)) 이유.push('코딩용 모델');
  if (도구잘함.test(best.x.model)) 이유.push('도구 호출을 잘하는 계열');
  if (작음.test(best.x.model)) 이유.push(c.yellow('다만 작은 모델이라 도구 호출이 불안할 수 있습니다'));
  이유.push(c.gray('실제로 되는지는 deel diagnose 로 확인하세요'));
  return { ...best.x, why: 이유.join(' · ') };
}

export async function runScan(flags = {}) {
  const host = flags.host ? String(flags.host) : '127.0.0.1';
  const ports = String(flags.ports ?? '')
    .split(/[,\s]+/).map((x) => parseInt(x, 10)).filter(Boolean);
  const timeout = flags.timeout ? parseInt(String(flags.timeout), 10) : 1200;

  say('');
  rule('로컬 모델 서버 훑기', 74);
  say(`  ${c.gray(`${host} 의 알려진 자리 ${KNOWN.length + ports.length}곳을 두드립니다. 바깥으로는 나가지 않습니다.`)}`);
  say('');

  const s = spin('찾는 중…');
  const found = await scanLocal({ host, ports, timeout, key: flags.key ? String(flags.key) : '' });
  s.stop(`  ${found.length ? mark.ok : mark.warn} ${found.length}곳 찾음`);
  say('');

  if (!found.length) {
    say(`  ${c.gray('떠 있는 로컬 서버가 없습니다.')}`);
    say('');
    say(`  ${c.gray('확인해 볼 것')}`);
    say(`    ${c.gray('· Ollama 를 켰나요?')}          ${c.cyan('ollama serve')}`);
    say(`    ${c.gray('· LM Studio 의 로컬 서버를 켰나요?')} ${c.gray('(Developer → Start Server)')}`);
    say(`    ${c.gray('· 다른 포트를 쓴다면')}          ${c.cyan('deel scan --ports 9000,9100')}`);
    say('');
    return 0;
  }

  // ── 찾은 것 표로 ─────────────────────────────────────────────────────
  const wRun = Math.max(10, ...found.map((f) => width(f.runtime)));
  for (const f of found) {
    const 자리 = `${f.host}:${f.port}`;
    const 규격 = f.kind === 'ollama' ? 'Ollama 규격' : 'OpenAI 호환';
    const 표시 = f.guessed ? c.gray(' (추정)') : '';
    say(`  ${c.hcyan('◆')} ${c.bold(pad(f.runtime, wRun))}${표시}  ${c.gray(pad(자리, 22))}${c.gray(pad(규격, 14))}${c.gray(f.ms + 'ms')}`);
    if (f.locked) {
      say(`      ${c.yellow('키가 필요합니다')} ${c.gray('— deel scan --key <키> 로 다시 훑어 보세요')}`);
      continue;
    }
    if (!f.models.length) {
      say(`      ${c.gray('모델이 하나도 없습니다 — 런타임에서 먼저 모델을 받아 두세요')}`);
      continue;
    }
    for (const m of f.models.slice(0, 12)) {
      say(`      ${c.gray('·')} ${pad(clip(m.id, 40), 42)}${c.gray(m.note ?? '')}`);
    }
    if (f.models.length > 12) say(`      ${c.gray(`… 그 밖에 ${f.models.length - 12}개`)}`);
  }
  say('');

  const 모델수 = found.reduce((n, f) => n + f.models.length, 0);
  say(`  ${c.gray('합계')}  서버 ${c.bold(String(found.length))}곳 · 모델 ${c.bold(String(모델수))}개`);
  say('');

  // ── 추천 ─────────────────────────────────────────────────────────────
  // 도구 호출이 되는 모델이라야 코딩 에이전트로 쓸 수 있다. 이름으로 짐작해 권한다.
  const 추천 = recommend(found);
  if (추천) {
    say(`  ${c.hgreen('추천')}  ${c.bold(추천.runtime)} ${c.gray('·')} ${c.bold(추천.model)}`);
    say(`        ${c.gray(추천.why)}`);
    say('');
  }

  // ── 등록 ─────────────────────────────────────────────────────────────
  if (!flags.save && !flags.pick) {
    say(`  ${c.gray('전부 등록하려면')}   ${c.cyan('deel scan --save')}`);
    say(`  ${c.gray('골라서 등록하려면')} ${c.cyan('deel scan --pick')}`);
    say(`  ${c.gray('등록 뒤에는 대화 중')} ${c.cyan('/model')} ${c.gray('로 바꿔 씁니다.')}`);
    say('');
    return 0;
  }

  const cfg = load();
  let profiles = toProfiles(found, cfg.profiles);

  // 골라 담기 — 사용자가 쓸 것만 등록한다.
  if (flags.pick && profiles.length > 1) {
    const items = profiles.map((p) => ({
      label: `${pad(clip(p.name, 44), 46)}${c.gray(p.note ?? '')}`,
      note: 추천 && p.model === 추천.model && p.baseUrl.includes(String(추천.port)) ? '추천' : '',
    }));
    const i = await pick('어느 것을 쓰시겠습니까', items, {
      def: Math.max(0, profiles.findIndex((p) => 추천 && p.model === 추천.model)),
    });
    profiles = [profiles[i]];
    cfg.active = null;   // 고른 것을 지금 쓰는 것으로
  }
  if (!profiles.length) {
    say(`  ${mark.warn} 등록할 모델이 없습니다.`);
    say('');
    return 1;
  }
  let 새로 = 0;
  for (const p of profiles) {
    if (!cfg.profiles.some((x) => x.baseUrl === p.baseUrl && x.model === p.model)) 새로++;
    upsert(cfg, p);
  }
  if (!cfg.active) cfg.active = profiles[0].id;
  const at = save(cfg);

  say(`  ${mark.ok} ${profiles.length}개 등록 ${c.gray(`(새로 ${새로}개)`)}`);
  say(`     ${c.gray(at)}`);
  say('');
  say(`  ${c.gray('지금 쓰는 것')}  ${c.bold(cfg.profiles.find((x) => x.id === cfg.active)?.name ?? cfg.active)}`);
  say(`  ${c.gray('바꾸려면 대화 중')} ${c.cyan('/model')}`);
  say('');
  say(`  ${c.gray('도구 호출·스트리밍이 되는지는 아직 확인 전입니다.')}`);
  say(`  ${c.gray('쓸 모델을 고른 뒤')} ${c.cyan('deel diagnose')} ${c.gray('를 한 번 돌리세요.')}`);
  say('');
  return 0;
}

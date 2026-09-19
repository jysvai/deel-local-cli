// 슬래시 명령 — 밖에서 들여오거나 밖으로 띄우는 것: 플러그인 · 스킬 목록 · 미리보기 서버.
// commands.js 에서 역할별로 나눠 옮겼다(2.0.0). 명령을 가르는 자리(handle)는 그대로 commands.js 에 있다.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { c, say, rule, pad, mark, clip } from '../ui/ansi.js';
import { discover } from '../skills/discover.js';
import { install, list, remove, pack } from '../plugins/manage.js';
import { spin } from '../ui/spinner.js';
import { 띄우기, 브라우저로 } from '../preview/serve.js';

export async function doPlugin(session, arg) {
  const [sub = '', ...rest] = arg.trim().split(/\s+/);
  const param = rest.join(' ').trim();

  // 설치·삭제 뒤에는 다시 훑어 이번 대화에 바로 반영한다.
  const rescan = () => {
    const f = discover(session.root);
    session.skills = f.skills;
    session.commands = f.commands;
    session.plugins = f.plugins;
    return f;
  };

  if (sub === 'install' || sub === 'add') {
    if (!param) {
      say(`  ${c.gray('예')} /plugin install affaan-m/ECC`);
      say(`  ${c.gray('  ')} /plugin install owner/repo#가지이름`);
      say('');
      return;
    }
    say('');
    const s = spin(`${param} 받는 중...`);
    const r = await install(param, { onStep: (m) => {} });
    if (r.error) {
      s.stop(`  ${mark.no} ${c.red(r.error.split('\n')[0])}`);
      for (const line of r.error.split('\n').slice(1)) say(`     ${c.gray(line.trim())}`);
      say(`     ${c.gray('오프라인이면 zip 을 ~/.deel/plugins/ 에 직접 풀면 됩니다.')}`);
      say('');
      return;
    }
    s.stop(`  ${mark.ok} ${c.bold(r.name)}${r.version ? ' ' + c.gray(r.version) : ''} ${c.gray(`(${r.license ?? '라이선스 미상'})`)}`);
    say(`     ${c.gray('스킬')} ${r.skills}개  ${c.gray('명령')} ${r.commands}개  ${c.gray(`· ${r.how} 로 받음`)}`);
    if (r.hooks) say(`     ${mark.warn} ${c.yellow(`실행 스크립트 ${r.hooks}개는 쓰지 않습니다`)} ${c.gray('(hook 미지원 · 반입 심사 대상)')}`);
    /*
     * 복사하다 빠진 것을 **여기서 말한다.**
     *
     * copyDir 은 심볼릭 링크를 말없이 건너뛴다. 그 목록을 install() 이
     * 이제 올려 주는데, 안 적으면 「스킬 3개」 라고 해 놓고 2개만 깔린
     * 상태가 그대로 초록으로 보인다 (plugins/manage.js 머리말).
     */
    if (r.건너뜀?.length) {
      say(`     ${mark.warn} ${c.yellow(`${r.건너뜀.length}개는 못 복사했습니다`)} ${c.gray('(링크·특수 파일은 안 옮깁니다)')}`);
      for (const 것 of r.건너뜀.slice(0, 5)) say(`       ${c.gray('·')} ${c.gray(clip(것, 66))}`);
      if (r.건너뜀.length > 5) say(`       ${c.gray(`… 그 밖에 ${r.건너뜀.length - 5}개`)}`);
    }
    if (r.덜깔림) {
      say(`     ${mark.warn} ${c.yellow('담으려던 것과 깔린 것이 다릅니다')}`
        + ` ${c.gray(`— 스킬 ${r.덜깔림.담을것.skills}→${r.덜깔림.깔린것.skills} · 명령 ${r.덜깔림.담을것.commands}→${r.덜깔림.깔린것.commands}`)}`);
    }
    const f = rescan();
    say(`     ${c.gray(`이제 스킬 ${f.skills.length}개 · 명령 ${f.commands.length}개`)}`);
    say('');
    return;
  }

  if (sub === 'remove' || sub === 'rm' || sub === 'uninstall') {
    if (!param) { say(`  ${c.gray('예')} /plugin remove ecc`); say(''); return; }
    const r = remove(param);
    if (r.error) { say(`  ${mark.no} ${c.red(r.error)}`); say(''); return; }
    const f = rescan();
    say(`  ${mark.ok} ${c.bold(r.removed)} 지웠습니다. ${c.gray(`이제 스킬 ${f.skills.length}개`)}`);
    say('');
    return;
  }

  if (sub === 'pack') {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const out = param || join(session.root, `deel-plugins-${stamp}.zip`);
    const r = pack(out, { only: null });
    if (r.error) { say(`  ${mark.no} ${c.red(r.error)}`); say(''); return; }
    say('');
    say(`  ${mark.ok} ${c.cyan(r.out)}`);
    say(`     ${c.gray('플러그인')} ${r.plugins.length}개 ${c.gray('· 파일')} ${r.files}개 ${c.gray('·')} ${(r.bytes / 1024).toFixed(0)}KB`);
    if (r.skipped) say(`     ${c.gray(`실행 스크립트 ${r.skipped}개는 뺐습니다`)}`);
    say('');
    rule('담긴 것', 74);
    for (const p of r.plugins) {
      say(`  ${c.cyan(pad(p.name, 22))} ${c.gray(pad(p.version || '-', 9))} ${c.gray(pad(p.license || '미상', 14))} ${c.gray(`스킬 ${p.skills} · 명령 ${p.commands}`)}`);
    }
    say('');
    say(`  ${c.gray('오프라인 기기의')} ~/.deel/plugins/ ${c.gray('에 풀면 바로 인식됩니다. 설치 명령은 필요 없습니다.')}`);
    say(`  ${c.gray('묶음 안에 라이선스 표가 담긴 사용안내.txt 가 함께 들어 있습니다.')}`);
    say('');
    return;
  }

  // 인자 없으면 목록
  const items = list();
  if (!items.length) {
    say('');
    say(`  ${c.gray('설치된 플러그인이 없습니다.')}`);
    say(`  ${c.gray('받기')}  /plugin install owner/repo`);
    say(`  ${c.gray('직접')}  ~/.deel/plugins/ 에 폴더를 풀어 넣어도 됩니다`);
    say('');
    return;
  }
  say('');
  rule('플러그인', 74);
  for (const p of items) {
    say(`  ${c.cyan(pad(p.name, 22))} ${c.gray(pad(p.version || '-', 9))} ${c.gray(pad(p.license || '미상', 14))} ${c.gray(`스킬 ${p.skills} · 명령 ${p.commands}`)}`);
    say(`    ${c.gray(p.from)}`);
  }
  say('');
  say(`  ${c.gray('/plugin install <owner/repo>   /plugin remove <이름>   /plugin pack [파일]')}`);
  say('');
}

/*
 * 만든 웹을 그 자리에서 띄운다.
 *
 * 여기 있는 것은 화면과 말뿐이고, 서버는 preview/serve.js 가 한다.
 * 한 번에 하나만 띄운다 — 여러 개를 띄워 놓으면 어느 주소가 무엇인지
 * 아무도 못 외우고, 끌 때도 뭘 껐는지 모른다.
 */
let 미리보기중 = null;

/** 켜져 있으면 끈다. 프로그램을 끝낼 때도 이걸 부른다. */
export async function 미리보기끄기() {
  if (!미리보기중) return null;
  const 끈것 = 미리보기중;
  미리보기중 = null;
  try { await 끈것.서버.닫기(); } catch { /* 이미 닫혔다 */ }
  return 끈것;
}

/** 지금 띄워 둔 것. 상태줄·검사에서 본다. */
export async function 미리보기(session, ctx, arg) {
  const 말 = String(arg ?? '').trim();

  if (/^(off|끄기|중지|stop)$/i.test(말)) {
    const 끈것 = await 미리보기끄기();
    say('');
    say(끈것 ? `  ${mark.ok} 미리보기를 껐습니다. ${c.gray(끈것.서버.url)}`
      : `  ${c.gray('띄워 둔 것이 없습니다.')}`);
    say('');
    return;
  }

  // 이미 떠 있는데 또 치면, 주소를 다시 알려 주고 브라우저만 연다.
  // 여기서 조용히 하나 더 띄우면 포트가 둘이 되고 어느 쪽이 진짜인지 모르게 된다.
  if (미리보기중 && !말) {
    say('');
    /*
     * 처음에 알려 준 주소를 **그대로** 다시 준다 (8회차 그밖 명령4).
     *
     * 여기는 `서버.url` 만 썼다. 파일 하나를 주고 띄우면 아래에서 주소 끝에 그 파일이
     * 붙는데(첫주소), 다시 부를 때는 그게 빠진 폴더 주소가 나오고 브라우저도 그리로 열렸다.
     * 방금 보던 화면을 사람이 다시 못 찾는다 — 「이미 띄워 뒀습니다」 라고 말해 놓고
     * 다른 것을 여는 셈이다. 그래서 띄울 때 정한 주소를 통째로 들고 있는다.
     */
    say(`  ${c.hgreen('▶')} 이미 띄워 뒀습니다  ${c.cyan(미리보기중.주소)} ${c.gray(미리보기중.보인이름)}`);
    브라우저로(미리보기중.주소);
    say(`  ${c.gray('끄려면')} ${c.cyan('/preview off')}`);
    say('');
    return;
  }
  // 다른 폴더를 주면 앞엣것은 끄고 새로 띄운다.
  if (미리보기중) await 미리보기끄기();

  let 뿌리;
  try {
    뿌리 = ctx.scope.resolve(말 || '.');
  } catch (err) {
    say('');
    say(`  ${c.red('띄울 수 없습니다')} ${c.gray(err.message)}`);
    say('');
    return;
  }

  if (!existsSync(뿌리)) {
    say('');
    say(`  ${c.red('그런 폴더가 없습니다')} ${c.gray(ctx.scope.show(뿌리))}`);
    say('');
    return;
  }
  // 파일 하나를 줬으면 그 파일이 든 폴더를 띄우고, 브라우저는 그 파일로 연다.
  let 첫주소 = '';
  if (!statSync(뿌리).isDirectory()) {
    첫주소 = encodeURIComponent(뿌리.split(/[\\/]/).pop());
    뿌리 = join(뿌리, '..');
    뿌리 = ctx.scope.resolve(뿌리);
  }

  let 서버;
  try {
    서버 = await 띄우기({ 뿌리, scope: ctx.scope });
  } catch (err) {
    say('');
    say(`  ${c.red('못 띄웠습니다')} ${c.gray(err.message)}`);
    say('');
    return;
  }
  const url = 서버.url + 첫주소;
  // 주소까지 같이 들고 있는다 — 다시 불렀을 때 같은 것을 주려면 이 값이 있어야 한다(위 갈래).
  미리보기중 = { 서버, 보인이름: ctx.scope.show(뿌리), 주소: url };

  say('');
  say(`  ${c.hgreen('▶')} ${c.bold('띄웠습니다')}  ${c.cyan(url)}`);
  say(`  ${c.gray('보여 주는 것')} ${c.white(미리보기중.보인이름)}`);
  say(서버.되살아나나
    ? `  ${c.gray('파일을 고치면 화면이 저절로 새로 뜹니다.')}`
    : `  ${c.yellow('⚠')} ${c.gray('이 자리에서는 파일 변화를 못 봅니다 — 브라우저를 손으로 새로 고치세요.')}`);
  // 어디까지 열리는지 반드시 말한다. '서버를 띄웠다' 는 말은 사람마다 다르게 읽힌다.
  say(`  ${c.gray('이 컴퓨터에서만 열립니다(127.0.0.1). 다른 PC 에서는 안 보입니다.')}`);
  say(`  ${c.gray('끄려면')} ${c.cyan('/preview off')}${c.gray('  · deel 을 끝내면 같이 꺼집니다.')}`);
  브라우저로(url);
  say('');
}

export function showSkills(session, arg) {
  const all = session.skills ?? [];
  if (!all.length) {
    say('');
    say(`  ${c.gray('이 PC 에서 찾은 스킬이 없습니다.')}`);
    say(`  ${c.gray('찾는 자리: ./.deel/skills  ./.claude/skills  ~/.claude/skills  ~/.claude/plugins')}`);
    say('');
    return;
  }

  // 스킬은 남의 폴더·플러그인에서 온다. 앞머리(frontmatter)가 빠진 파일이 섞이면
  // 이름이나 설명이 없다. 그걸 그대로 만지면 목록 하나 보려다 대화가 끝난다.
  const 낮게 = (v) => String(v ?? '').toLowerCase();

  const q = arg.trim();
  if (q === 'all') {
    all.forEach((s) => { s.enabled = true; });
    session.maxSkillsListed = Math.min(all.length, 200);
    say(`  ${mark.ok} 전부 올립니다 (${session.listedSkills().length}개). ${c.yellow('컨텍스트를 많이 차지합니다 — /context 로 확인하세요.')}`);
    say('');
    return;
  }
  if (q === 'off') {
    all.forEach((s) => { s.enabled = false; });
    say(`  ${mark.ok} 스킬을 모두 내렸습니다.`);
    say('');
    return;
  }
  if (q.startsWith('on ')) {
    const term = q.slice(3).trim().toLowerCase();
    const 걸린것 = all.filter((s) => 낮게(s.name).includes(term) || 낮게(s.description).includes(term));
    /*
     * 한 개도 안 걸리면 **아무것도 안 건드린다.**
     *
     * 앞서는 걸림 여부를 그대로 enabled 에 넣었다. 그래서 오타 하나면 전부
     * false 가 되고, 화면에는 `✓ "리뷰" 에 걸리는 0개만 올립니다` 가 떴다.
     * 올리려고 친 명령이 가지고 있던 것까지 다 내려 버리는데, 표시는 ✓ 다.
     * 그다음 모델이 스킬을 못 쓰는 것을 보고 사람은 스킬이 깨진 줄 안다.
     */
    if (!걸린것.length) {
      say(`  ${mark.no} "${term}" 에 걸리는 스킬이 없습니다 ${c.gray('— 올라간 것은 그대로 둡니다.')}`);
      say(`  ${c.gray('무엇이 있는지 보려면')} ${c.cyan('/skills')}`);
      say('');
      return;
    }
    for (const s of all) s.enabled = 걸린것.includes(s);
    say(`  ${mark.ok} "${term}" 에 걸리는 ${걸린것.length}개만 올립니다.`);
    say('');
    return;
  }

  const hits = q
    ? all.filter((s) => 낮게(s.name).includes(q.toLowerCase()) || 낮게(s.description).includes(q.toLowerCase()))
    : session.listedSkills();

  say('');
  rule(q ? `스킬 검색: ${q}` : '지금 올라간 스킬', 74);
  for (const s of hits.slice(0, 30)) {
    const tag = s.enabled ? c.green('●') : c.gray('○');
    // 설명이 없을 수 있다. 스킬은 남의 폴더·플러그인에서 오는 것이라
    // 앞머리(frontmatter)가 빠진 파일이 섞인다. 여기서 터지면 목록 하나 보려다
    // 대화가 통째로 끝난다 — 화면 그리기는 무슨 일이 있어도 안 죽어야 한다.
    say(`  ${tag} ${c.cyan(pad(s.name, 32))} ${c.gray(String(s.description ?? '').slice(0, 60))}`);
  }
  if (hits.length > 30) say(`  ${c.gray(`… 그 밖에 ${hits.length - 30}개`)}`);
  say('');

  const bySource = { project: 0, user: 0, plugin: 0, builtin: 0 };
  for (const s of all) bySource[s.source] = (bySource[s.source] ?? 0) + 1;
  say(`  ${c.gray('전체')} ${all.length}개  ${c.gray('(프로젝트')} ${bySource.project} ${c.gray('· 사용자')} ${bySource.user} ${c.gray('· 플러그인')} ${bySource.plugin} ${c.gray('· 품고 다니는 것')} ${bySource.builtin}${c.gray(')')}`);
  say(`  ${c.gray('프롬프트에 올라간 것')} ${session.listedSkills().length}개 ${c.gray(`(상한 ${session.maxSkillsListed})`)}`);
  if ((session.plugins ?? []).length) {
    say(`  ${c.gray('플러그인')} ${session.plugins.filter((p) => p.skills > 0).map((p) => p.name).slice(0, 8).join(', ')}`);
  }
  say('');
  say(`  ${c.gray('/skills <검색어>     찾아보기')}`);
  say(`  ${c.gray('/skills on <검색어>  걸리는 것만 올리기')}`);
  say(`  ${c.gray('/skills all | off    전부 올리기 | 내리기')}`);
  say('');
}

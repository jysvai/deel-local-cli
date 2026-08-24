// deel sessions — 이 폴더에 남아 있는 대화 목록.
import { c, say, rule, pad, mark, clip, width } from '../ui/ansi.js';
import { list, remove, sessionsDir } from './store.js';
import { existsSync } from 'node:fs';

// "3분 전", "어제" 처럼. 목록에서는 절대 시각보다 이쪽이 눈에 잘 들어온다.
function 언제(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 172800) return '어제';
  if (s < 604800) return `${Math.floor(s / 86400)}일 전`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function runSessions(flags = {}) {
  const root = flags.root ? String(flags.root) : process.cwd();

  if (flags.rm || flags.delete) {
    const id = String(flags.rm ?? flags.delete);
    const r = remove(root, id);
    say('');
    say(r.error ? `  ${mark.no} ${r.error}` : `  ${mark.ok} 지웠습니다: ${c.bold(r.removed)}`);
    say('');
    return r.error ? 1 : 0;
  }

  const rows = list(root, { limit: flags.all ? 1000 : 20 });
  say('');
  rule('이 폴더의 대화', 78);
  say(`  ${c.gray(root)}`);
  say('');

  if (!rows.length) {
    say(`  ${c.gray('남아 있는 대화가 없습니다.')}`);
    if (!existsSync(sessionsDir(root))) {
      say(`  ${c.gray('이 폴더에서 deel 을 한 번 쓰면 여기에 쌓입니다.')}`);
    }
    say('');
    return 0;
  }

  const wId = Math.max(...rows.map((r) => width(r.id)));
  for (const [i, r] of rows.entries()) {
    const 최근 = i === 0 ? c.hgreen('●') : c.gray('·');
    say(`  ${최근} ${c.bold(pad(r.id, wId))}  ${c.gray(pad(언제(r.at), 9))}`
      + `${c.gray(pad(`${r.turns}턴`, 6, 'right'))}  ${c.gray(pad(clip(r.model, 22), 24))}`);
    say(`    ${c.gray('  ')}${clip(r.first, 68)}`);
  }
  say('');
  say(`  ${c.gray('가장 최근 것 이어하기')}   ${c.cyan('deel --continue')}`);
  say(`  ${c.gray('골라서 이어하기')}         ${c.cyan(`deel --resume ${rows[0].id}`)}`);
  say(`  ${c.gray('하나 지우기')}             ${c.cyan(`deel sessions --rm ${rows.at(-1).id}`)}`);
  say('');
  say(`  ${c.gray(`저장 위치: ${sessionsDir(root)}  (.gitignore 에 들어 있어 깃에 안 올라갑니다)`)}`);
  say('');
  return 0;
}

// 자율 실행의 울타리.
// 승인 프롬프트를 안 쓰는 대신 (1) 작업 범위 밖은 못 건드리고
// (2) 되돌릴 수 없는 명령만 막는다. 나머지는 전부 통과시킨다.
import { resolve, relative, isAbsolute, sep } from 'node:path';

export class ScopeError extends Error {}
export class BlockedError extends Error {}

// 작업 범위 — deel 를 띄운 폴더. 그 밖은 읽기도 쓰기도 막는다.
export function makeScope(root) {
  const base = resolve(root);
  return {
    root: base,
    resolve(p) {
      if (!p || typeof p !== 'string') throw new ScopeError('경로가 비었습니다');
      const abs = isAbsolute(p) ? resolve(p) : resolve(base, p);
      const rel = relative(base, abs);
      if (rel.startsWith('..' + sep) || rel === '..' || (isAbsolute(rel) && rel !== '')) {
        throw new ScopeError(`작업 범위 밖입니다: ${p}\n  범위: ${base}`);
      }
      return abs;
    },
    show(abs) {
      const rel = relative(base, abs);
      return rel === '' ? '.' : rel.split(sep).join('/');
    },
  };
}

// 되돌릴 수 없는 것만 막는다. 목록이 길어지면 도구가 쓸모없어진다.
const BLOCKED = [
  { re: /\brm\s+(-[a-z]*[rR][a-z]*f|-[a-z]*f[a-z]*[rR])\b[^|;&]*\s(\/|~|\$HOME)\s*$/i, why: '뿌리 폴더를 통째로 지우려 합니다' },
  { re: /\b(mkfs|fdisk|diskpart)\b/i, why: '디스크를 초기화하는 명령입니다' },
  { re: /\bformat\s+[a-z]:/i, why: '드라이브를 포맷하는 명령입니다' },
  { re: /\b(rd|rmdir)\s+\/s\b/i, why: '폴더를 통째로 지웁니다 — 정션이 있으면 원본까지 딸려 갑니다' },
  { re: /\bdel\s+\/[sq]\b.*\\\*/i, why: '하위 폴더까지 전부 지웁니다' },
  { re: /git\s+push\b[^|;&]*--force(?!-with-lease)/i, why: '원격 이력을 덮어씁니다 (--force-with-lease 를 쓰세요)' },
  { re: /\bshutdown\b|\breboot\b/i, why: '시스템을 끕니다' },
  { re: /curl[^|]*\|\s*(ba)?sh/i, why: '받은 스크립트를 그대로 실행합니다' },
  { re: /\biwr\b[^|]*\|\s*iex\b/i, why: '받은 스크립트를 그대로 실행합니다' },
];

export function checkCommand(cmd) {
  const s = String(cmd);
  for (const b of BLOCKED) {
    if (b.re.test(s)) throw new BlockedError(`${b.why}\n  막힌 명령: ${s.slice(0, 120)}`);
  }
  return true;
}

// 변경성 동작은 실패해도 다시 실행하지 않는다 — 두 번 실행되면 사고다. (RPA 에서 얻은 원칙)
const MUTATING = /\b(git\s+(commit|push|merge|rebase|reset)|npm\s+(publish|install)|pip\s+install|mv|cp|del|rm|move|copy|curl\s+-X\s*(POST|PUT|DELETE|PATCH))\b/i;

export function isMutating(cmd) {
  return MUTATING.test(String(cmd));
}

// 에이전트 루프. 모델 → 도구 → 결과 → 모델 을 답이 나올 때까지 돈다.
// 화면에 그릴 것은 이벤트로 흘려보낸다 — 화면 코드와 섞지 않는다.
import { chat, chatStream, assistantMessage, toolMessage } from '../backend/adapter.js';
import { toolSchemas, runTool, TOOLS } from '../tools/index.js';
import { isMutating } from '../safety/guard.js';

// think 값을 규격에 맞게. 'off' 는 사고를 끈다.
function thinkFor(conn, level) {
  if (level === 'off') return conn.kind === 'ollama' ? false : undefined;
  return level;
}

export async function* run(session, ctx, userText) {
  session.push({ role: 'user', content: userText });
  ctx.audit.turn(userText);
  ctx.history.nextTurn();

  const conn = session.conn;
  const tools = toolSchemas(null, { hasSkills: (session.skills?.length ?? 0) > 0 });
  const attempted = new Set();   // 같은 변경성 명령을 두 번 실행하지 않기 위한 기록
  let steps = 0;

  while (steps < session.maxSteps) {
    steps++;
    const opts = {
      messages: session.wire(),
      tools,
      think: thinkFor(conn, session.think),
      maxTokens: 4096,
    };

    let msg;
    try {
      if (conn.streaming) {
        for await (const ev of chatStream(conn, opts)) {
          if (ev.type === 'done') msg = ev.message;
          else yield ev;
        }
      } else {
        yield { type: 'waiting' };
        msg = await chat(conn, opts);
        if (msg.thinking) yield { type: 'thinking', text: msg.thinking };
        if (msg.content) yield { type: 'content', text: msg.content };
      }
    } catch (err) {
      yield { type: 'error', text: err.message };
      return;
    }

    session.usage.in += msg.usage?.in ?? 0;
    session.usage.out += msg.usage?.out ?? 0;
    session.usage.calls++;

    session.push(assistantMessage(conn.kind, msg));

    if (!msg.toolCalls?.length) {
      yield { type: 'done', steps, text: msg.content };
      return;
    }

    // 도구를 순서대로 실행한다.
    for (const call of msg.toolCalls) {
      if (!TOOLS[call.name]) {
        session.push(toolMessage(conn.kind, {
          callId: call.id, name: call.name,
          content: `모르는 도구입니다. 쓸 수 있는 것: ${Object.keys(TOOLS).join(', ')}`,
        }));
        yield { type: 'tool', name: call.name, args: call.args, result: { error: '모르는 도구' } };
        continue;
      }

      // 변경성 명령은 실패해도 다시 실행하지 않는다 — 두 번 돌면 사고다.
      if (call.name === 'Bash' && isMutating(call.args?.command)) {
        const key = String(call.args.command).trim();
        if (attempted.has(key)) {
          const note = '같은 변경성 명령을 다시 실행하지 않습니다. 두 번 실행되면 사고가 납니다.';
          session.push(toolMessage(conn.kind, { callId: call.id, name: call.name, content: note }));
          yield { type: 'tool', name: call.name, args: call.args, result: { error: note } };
          continue;
        }
        attempted.add(key);
      }

      // 모드에 따라 물어본다. 기본(auto)은 안 묻고 되돌리기로 대응한다.
      const needsOk = session.mode === 'strict'
        ? ['Write', 'Edit', 'Bash'].includes(call.name)
        : session.mode === 'confirm'
          ? (call.name === 'Bash' && isMutating(call.args?.command))
          : false;
      if (needsOk && ctx.confirm) {
        const ok = await ctx.confirm(call.name, call.args);
        if (!ok) {
          const note = '사용자가 거부했습니다. 다른 방법을 찾거나 이유를 물어보세요.';
          session.push(toolMessage(conn.kind, { callId: call.id, name: call.name, content: note }));
          yield { type: 'tool', name: call.name, args: call.args, result: { error: '거부됨' } };
          continue;
        }
      }

      yield { type: 'tool_start', name: call.name, args: call.args };
      const t0 = Date.now();
      const result = await runTool(call.name, call.args, ctx);
      const ms = Date.now() - t0;
      session.usage.ms += ms;

      if (call.name === 'Read' && result.content) session.noteRead(call.args.file_path, result.content);

      session.push(toolMessage(conn.kind, {
        callId: call.id,
        name: call.name,
        content: result.error ? `오류: ${result.error}` : result.content ?? '',
      }));
      yield { type: 'tool', name: call.name, args: call.args, result, ms };
    }

    // 컨텍스트가 차오르면 오래된 대화를 줄인다.
    const b = session.breakdown();
    if (b.used > b.total * 0.8) {
      const dropped = session.trim();
      if (dropped) yield { type: 'trimmed', dropped };
    }
  }

  yield { type: 'limit', steps };
}

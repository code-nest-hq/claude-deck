import { useMemo } from 'react';
import { isAskUserQuestion } from '../chat/AskUserQuestionModal';
import { useApp } from '../../store';

export interface ActivityEntry { sessionId: string; projectId: string; projectName: string; sessionName: string; kind: 'needs' | 'running'; text: string }

// "many sessions, one glance": derived from the live chat state, so nothing goes stale when a prompt is answered
export function useActivity(): ActivityEntry[] {
  const chats = useApp((s) => s.chats);
  const rows = useApp((s) => s.rows);
  const projects = useApp((s) => s.projects);
  const attachedTo = useApp((s) => s.attachedTo);
  return useMemo(() => {
    const out: ActivityEntry[] = [];
    for (const [sessionId, chat] of Object.entries(chats)) {
      const pid = attachedTo[sessionId];
      const project = projects.find((p) => p.id === pid);
      if (!project) continue;
      const sessionName = rows[project.id]?.find((r) => r.sessionId === sessionId)?.name ?? 'Session';
      const q = chat.pending[0];
      if (q) out.push({ sessionId, projectId: project.id, projectName: project.name, sessionName, kind: 'needs', text: isAskUserQuestion(q) ? 'Question from Claude' : `Waiting for permission: ${q.toolName}` });
      else if (chat.state === 'running') out.push({ sessionId, projectId: project.id, projectName: project.name, sessionName, kind: 'running', text: 'Working…' });
    }
    return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'needs' ? -1 : 1));
  }, [chats, rows, projects, attachedTo]);
}

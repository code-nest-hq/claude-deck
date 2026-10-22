import type { SlashCommandInfo } from '@ccui/shared';
import { Modal, card } from '../../lib/Modal';
import type { SkillUse } from './reduce';

// skills used in one turn: who invoked each, what it does, arguments and the tool result
export function SkillsModal({ skills, commands, summary, onClose }: { skills: SkillUse[]; commands?: SlashCommandInfo[]; summary: string; onClose: () => void }) {
  return (
    <Modal size="md" onClose={onClose} title={skills.length === 1 ? 'Skill invocada neste turno' : `${skills.length} skills invocadas neste turno`} subtitle={<span className="font-mono text-xs">{summary}</span>}>
        <ul className="space-y-3">
          {skills.map((s, i) => {
            const desc = commands?.find((c) => c.name === s.name)?.description;
            return (
              <li key={i} className={`${card} px-4 py-3 text-sm`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-violet-300">/{s.name}</span>
                  <span className="flex-1" />
                  <span className="text-zinc-500">{s.by === 'user' ? 'invocada por você' : 'invocada pelo Claude'}</span>
                </div>
                {desc && <p className="mt-1.5 text-zinc-400">{desc}</p>}
                {s.args && <div className="mt-1"><span className="text-zinc-500">Argumentos: </span><span className="whitespace-pre-wrap font-mono text-zinc-300">{s.args}</span></div>}
                {s.by === 'claude' && (
                  <div className={`mt-1 font-mono ${s.isError ? 'text-rose-300' : 'text-zinc-500'}`}>
                    {s.output === undefined ? 'sem resultado (turno interrompido?)' : s.output.split('\n')[0].slice(0, 300)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
    </Modal>
  );
}

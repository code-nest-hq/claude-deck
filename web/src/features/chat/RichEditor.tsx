import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { useEffect } from 'react';

// email-style input: Enter breaks the line, Ctrl+Enter sends; the content leaves as markdown (the only format the model reads)
// ponytail: no underline/color — markdown has no equivalent; add as inline HTML if ever needed
const BTN = 'rounded px-2 py-0.5 text-xs transition-colors hover:bg-zinc-800 disabled:opacity-40';

export function RichEditor({ disabled, placeholder, onChange, onSend }: {
  disabled: boolean; placeholder: string; onChange: (md: string) => void; onSend: () => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ underline: false, link: false, strike: false, blockquote: false, heading: false, horizontalRule: false }), Markdown],
    editorProps: {
      attributes: {
        class: 'min-h-20 max-h-[50vh] overflow-auto p-3 text-sm text-zinc-100 outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:my-1 [&_pre]:rounded [&_pre]:bg-zinc-950 [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-xs [&_code]:font-mono [&_code]:text-xs [&_p.is-editor-empty:first-child]:before:text-zinc-500 [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
      },
      handleKeyDown: (_, e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSend(); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => onChange(ed.getMarkdown()),
    autofocus: true,
  });
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);
  useEffect(() => { editor?.view.dom.setAttribute('data-placeholder', placeholder); }, [editor, placeholder]);
  if (!editor) return null;
  const b = (label: string, title: string, active: boolean, run: (e: Editor) => void, cls = '') => (
    <button type="button" key={title} title={title} disabled={disabled} className={`${BTN} ${cls} ${active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'}`} onMouseDown={(ev) => { ev.preventDefault(); run(editor); }}>{label}</button>
  );
  return (
    <div>
      <div className="flex gap-1 border-b border-zinc-800/70 px-2 py-1">
        {b('B', 'Bold (Ctrl+B)', editor.isActive('bold'), (e) => e.chain().focus().toggleBold().run(), 'font-bold')}
        {b('I', 'Italic (Ctrl+I)', editor.isActive('italic'), (e) => e.chain().focus().toggleItalic().run(), 'italic')}
        {b('•', 'Bullet list (type "* ")', editor.isActive('bulletList'), (e) => e.chain().focus().toggleBulletList().run())}
        {b('</>', 'Inline code', editor.isActive('code'), (e) => e.chain().focus().toggleCode().run(), 'font-mono')}
        {b('{ }', 'Code block', editor.isActive('codeBlock'), (e) => e.chain().focus().toggleCodeBlock().run(), 'font-mono')}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

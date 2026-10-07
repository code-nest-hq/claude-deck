import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { Findings, parseFindings } from './Findings';

interface HastNode { type: string; value?: string; tagName?: string; properties?: { className?: string[] }; children?: HastNode[] }
const hastText = (n: HastNode): string => n.value ?? (n.children ?? []).map(hastText).join('');

// react-markdown não renderiza HTML cru e só aceita URLs seguras (http/https/mailto) por padrão.
// ponytail: re-renderiza a cada delta durante o streaming; se pesar em respostas enormes, throttle do texto.
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false }]]}
        components={{
          pre: ({ node, children }) => {
            const code = (node as HastNode | undefined)?.children?.[0];
            if (code?.properties?.className?.includes('language-json')) {
              const items = parseFindings(hastText(code));
              if (items) return <Findings items={items} />;
            }
            return <pre>{children}</pre>;
          },
          a: ({ node: _node, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer" /> }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

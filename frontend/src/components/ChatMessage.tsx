import type { ReactNode } from 'react';
import type { ChatMessage as ChatMessageType } from '../types';
import { SourceList } from './SourceList';

type Props = {
  message: ChatMessageType;
};

export function ChatMessage({ message }: Props) {
  const isAssistant = message.role === 'assistant';

  return (
    <article className={`chat-message ${message.role}`}>
      <div className="message-avatar">{isAssistant ? 'R' : 'Tú'}</div>
      <div className="message-body">
        {message.stage && (
          <div className="message-stage">
            <span className="status-dot small" />
            {message.stage}
          </div>
        )}
        {message.error ? (
          <p className="message-error">{message.error}</p>
        ) : (
          <div className="message-text">
            {message.text ? (
              isAssistant ? <AnswerText text={message.text} /> : message.text
            ) : isAssistant ? 'Preparando respuesta...' : ''}
          </div>
        )}
        {message.sources?.length ? <SourceList sources={message.sources} /> : null}
      </div>
    </article>
  );
}

function AnswerText({ text }: { text: string }) {
  const blocks = normalizeAnswer(text).split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);

  return (
    <div className="answer-content">
      {blocks.map((block, index) => {
        if (/^#{2,4}\s+/.test(block)) {
          return <h3 key={index}>{renderInline(block.replace(/^#{2,4}\s+/, ''))}</h3>;
        }

        if (block.split('\n').every((line) => !line.trim() || /^\d+\.\s*/.test(line))) {
          return (
            <ol key={index}>
              {block.split('\n').filter(Boolean).map((line) => (
                <li key={line}>{renderInline(line.replace(/^\d+\.\s*/, ''))}</li>
              ))}
            </ol>
          );
        }

        if (block.split('\n').every((line) => !line.trim() || /^[-*]\s+/.test(line))) {
          return (
            <ul key={index}>
              {block.split('\n').filter(Boolean).map((line) => (
                <li key={line}>{renderInline(line.replace(/^[-*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }

        if (block.startsWith('>')) {
          return <blockquote key={index}>{renderInline(block.replace(/^>\s?/, ''))}</blockquote>;
        }

        return <p key={index}>{renderInline(block)}</p>;
      })}
    </div>
  );
}

function normalizeAnswer(text: string) {
  return text
    .replace(/\s+(#{2,4})\s+/g, '\n\n$1 ')
    .replace(/\s+\*\s+(?=\*\*)/g, '\n\n- ')
    .replace(/\s+(\d+\.\s*(?=\*\*))/g, '\n$1')
    .trim();
}

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[(?:Source|Fuente) \d+\]|\*[^*]+\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (/^\[(?:Source|Fuente) \d+\]$/.test(part)) {
      return <span className="source-chip" key={index}>{part.replace('[Source', 'Fuente').replace(']', '')}</span>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

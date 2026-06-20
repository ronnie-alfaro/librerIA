import { DragEvent, FormEvent, useRef, useState } from 'react';

type Props = {
  busy: boolean;
  onUpload: (file: File, title: string, author: string, language: string) => void;
};

export function UploadDropzone({ busy, onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [language, setLanguage] = useState('');

  function submitFile(file?: File) {
    if (!file || busy) return;
    onUpload(file, title.trim(), author.trim(), language);
    if (inputRef.current) inputRef.current.value = '';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    submitFile(event.dataTransfer.files[0]);
  }

  function onBrowse(event: FormEvent<HTMLInputElement>) {
    submitFile(event.currentTarget.files?.[0]);
  }

  return (
    <section className="upload-panel">
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          className="hidden-input"
          type="file"
          accept=".pdf,.epub"
          onChange={onBrowse}
          disabled={busy}
        />
        <div className="upload-icon">↑</div>
        <div>
          <h3>Suelta un PDF o EPUB</h3>
          <p>o haz clic para buscar. Los archivos se indexan localmente.</p>
        </div>
      </div>

      <div className="metadata-grid">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título opcional" />
        <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Autor opcional" />
        <select value={language} onChange={(event) => setLanguage(event.target.value)}>
          <option value="">Detectar idioma automáticamente</option>
          <option value="en">Inglés</option>
          <option value="es">Español</option>
          <option value="fr">Francés</option>
        </select>
      </div>
    </section>
  );
}

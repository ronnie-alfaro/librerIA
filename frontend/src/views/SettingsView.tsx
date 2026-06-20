import { FormEvent, useEffect, useState } from 'react';
import { fetchConfig, saveConfig } from '../api/client';

const providers = ['anthropic', 'openai', 'gemini', 'local'];

export function SettingsView() {
  const [provider, setProvider] = useState('anthropic');
  const [answerModel, setAnswerModel] = useState('');
  const [expandModel, setExpandModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [contextLimit, setContextLimit] = useState(0);
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConfig()
      .then((config) => {
        setProvider(config.provider);
        setAnswerModel(config.answer_model);
        setExpandModel(config.expand_model);
        setBaseUrl(config.base_url);
        setContextLimit(config.context_limit);
        setHasKey(config.has_key);
      })
      .catch((err) => setStatus(err instanceof Error ? err.message : 'No se pudieron cargar los ajustes.'));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      await saveConfig({
        provider,
        answer_model: answerModel,
        expand_model: expandModel,
        base_url: baseUrl,
        api_key: apiKey,
        context_limit: contextLimit,
      });
      setStatus('Ajustes guardados.');
      if (apiKey) setHasKey(true);
      setApiKey('');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'No se pudieron guardar los ajustes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Motor LLM</span>
          <h1>Ajustes</h1>
          <p>Configura el proveedor usado para expansión de búsqueda y generación de respuestas.</p>
        </div>
      </header>

      <form className="settings-grid" onSubmit={submit}>
        <label>
          Proveedor
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            {providers.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          Modelo de respuesta
          <input value={answerModel} onChange={(event) => setAnswerModel(event.target.value)} />
        </label>
        <label>
          Modelo de expansión
          <input value={expandModel} onChange={(event) => setExpandModel(event.target.value)} />
        </label>
        <label>
          URL base
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="Solo necesario para proveedores compatibles con OpenAI" />
        </label>
        <label>
          Clave API {hasKey && <span className="hint">configurada</span>}
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasKey ? 'Déjalo vacío para conservar la clave actual' : 'Pega la clave API'} type="password" />
        </label>
        <label>
          Límite de contexto
          <input value={contextLimit} onChange={(event) => setContextLimit(Number(event.target.value))} type="number" min="0" />
        </label>
        <div className="settings-actions">
          <button className="button" disabled={saving}>{saving ? 'Guardando...' : 'Guardar ajustes'}</button>
          {status && <span>{status}</span>}
        </div>
      </form>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useMailStore } from '../../store';
import type { Signature } from '../../store';
import type { PluginModule, PluginAPI } from '../../core/plugin-api';

// ── Compose: signature picker ────────────────────────────────────────────────

/**
 * Rendered in the `compose:footer` slot below the body textarea.
 * Receives `body` and `setBody` forwarded by the <Slot> in ComposeView.
 */
function SignaturePicker({ body, setBody }: { body: string; setBody: (v: string) => void }) {
  const signatures = useMailStore((s) => s.signatures);
  const [selectedId, setSelectedId] = useState<string>('');

  // Auto-select the default signature when the component first mounts.
  useEffect(() => {
    const def = signatures.find((s) => s.isDefault);
    if (def && !selectedId) {
      setSelectedId(def.id);
      appendSignature(body, setBody, def);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatures]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedId(id);
    const sig = signatures.find((s) => s.id === id);
    // Strip any previously appended signature block before appending the new one.
    const stripped = stripSignatureBlock(body);
    if (sig) {
      appendSignature(stripped, setBody, sig);
    } else {
      setBody(stripped);
    }
  };

  if (signatures.length === 0) return null;

  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="text-xs text-[var(--c-text-muted)]">Signature:</span>
      <select
        value={selectedId}
        onChange={handleChange}
        className="text-xs border border-[var(--c-border)] rounded px-2 py-1 bg-[var(--c-panel)] text-[var(--c-text)] outline-none focus:border-[#004f96]"
      >
        <option value="">None</option>
        {signatures.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </div>
  );
}

// ── Settings: signature management section ────────────────────────────────────

/**
 * Rendered in the `settings:sections` slot in SettingsView.
 * Allows users to create, edit, and delete signature templates.
 */
function SignatureSettings() {
  const { signatures, setSignatures } = useMailStore();
  const [editing, setEditing] = useState<Signature | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [contentInput, setContentInput] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [savingError, setSavingError] = useState('');

  const reload = useCallback(async () => {
    try {
      const sigs = await invoke<Signature[]>('get_signatures');
      setSignatures(sigs);
    } catch (e) {
      console.error('Failed to load signatures:', e);
    }
  }, [setSignatures]);

  useEffect(() => { reload(); }, [reload]);

  const startEdit = (sig?: Signature) => {
    if (sig) {
      setEditing(sig);
      setNameInput(sig.name);
      setContentInput(sig.content);
      setIsDefault(sig.isDefault);
    } else {
      setEditing({ id: crypto.randomUUID(), name: '', content: '', isDefault: false });
      setNameInput('');
      setContentInput('');
      setIsDefault(false);
    }
    setSavingError('');
  };

  const cancelEdit = () => {
    setEditing(null);
    setSavingError('');
  };

  const handleSave = async () => {
    if (!nameInput.trim()) { setSavingError('Name is required.'); return; }
    const sig: Signature = {
      id: editing!.id,
      name: nameInput.trim(),
      content: contentInput,
      isDefault,
    };
    try {
      await invoke('save_signature', { signature: sig });
      await reload();
      cancelEdit();
    } catch (e) {
      setSavingError(String(e));
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this signature?')) return;
    try {
      await invoke('delete_signature', { id });
      await reload();
    } catch (e) {
      console.error('Failed to delete signature:', e);
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold tracking-wider text-[var(--c-text-muted)] uppercase">Signatures</h3>
        <button
          onClick={() => startEdit()}
          className="flex items-center gap-1.5 text-sm bg-[#004f96] text-white px-3 py-1.5 rounded-md hover:bg-[#003b73] transition-colors"
        >
          + New Signature
        </button>
      </div>

      {editing && (
        <div className="mb-6 p-4 border border-[var(--c-border)] rounded-lg bg-[var(--c-bg)] space-y-3">
          <div className="flex gap-3 items-center">
            <label className="text-sm text-[var(--c-text-muted)] w-16 text-right flex-shrink-0">Name</label>
            <input
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              placeholder="e.g. Work, Personal"
              className="flex-1 p-2 border border-[var(--c-border)] rounded-md text-sm bg-[var(--c-panel)] text-[var(--c-text)] outline-none focus:border-[#004f96]"
            />
          </div>
          <div className="flex gap-3 items-start">
            <label className="text-sm text-[var(--c-text-muted)] w-16 text-right flex-shrink-0 pt-2">Content</label>
            <textarea
              value={contentInput}
              onChange={e => setContentInput(e.target.value)}
              rows={4}
              placeholder="Your signature text&#10;--&#10;Name | Title | Company"
              className="flex-1 p-2 border border-[var(--c-border)] rounded-md text-sm bg-[var(--c-panel)] text-[var(--c-text)] outline-none focus:border-[#004f96] resize-y"
            />
          </div>
          <div className="flex gap-3 items-center ml-[76px]">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={e => setIsDefault(e.target.checked)}
                className="w-4 h-4"
              />
              Set as default
            </label>
          </div>
          {savingError && (
            <p className="ml-[76px] text-sm text-red-600">{savingError}</p>
          )}
          <div className="flex gap-2 ml-[76px]">
            <button
              onClick={handleSave}
              className="text-sm bg-[#004f96] text-white px-3 py-1.5 rounded-md hover:bg-[#003b73] transition-colors"
            >
              Save
            </button>
            <button
              onClick={cancelEdit}
              className="text-sm px-3 py-1.5 rounded-md border border-[var(--c-border)] hover:bg-[var(--c-hover)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {signatures.length === 0 && !editing ? (
        <p className="text-sm text-[var(--c-text-muted)]">No signatures yet. Click &quot;+ New Signature&quot; to create one.</p>
      ) : (
        <div className="space-y-2">
          {signatures.map((sig) => (
            <div
              key={sig.id}
              className="flex items-start justify-between p-3 border border-[var(--c-border)] rounded-lg bg-[var(--c-bg)] hover:bg-[var(--c-hover)] transition-colors"
            >
              <div className="flex-1 min-w-0 mr-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{sig.name}</span>
                  {sig.isDefault && (
                    <span className="text-xs bg-[#004f96]/10 text-[#004f96] px-2 py-0.5 rounded-full">Default</span>
                  )}
                </div>
                <p className="text-xs text-[var(--c-text-muted)] mt-1 truncate">{sig.content}</p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => startEdit(sig)}
                  className="text-xs px-2 py-1 border border-[var(--c-border)] rounded hover:bg-[var(--c-hover)] transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(sig.id)}
                  className="text-xs px-2 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SIG_SEPARATOR = '\n\n-- \n';

function appendSignature(body: string, setBody: (v: string) => void, sig: Signature) {
  setBody(stripSignatureBlock(body) + SIG_SEPARATOR + sig.content);
}

function stripSignatureBlock(body: string): string {
  const idx = body.lastIndexOf(SIG_SEPARATOR);
  return idx !== -1 ? body.slice(0, idx) : body;
}

// ── Plugin registration ───────────────────────────────────────────────────────

const signaturePlugin: PluginModule = {
  activate(api: PluginAPI) {
    api.ui.registerSlot('compose:footer', SignaturePicker);
    api.ui.registerSlot('settings:sections', SignatureSettings);
  },
  deactivate() {
    // SlotRegistry cleanup is handled by PluginManager via removeByPlugin.
  },
};

export default signaturePlugin;

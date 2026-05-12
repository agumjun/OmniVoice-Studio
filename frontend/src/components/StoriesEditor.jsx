/**
 * StoriesEditor — multi-track audiobook / story editor.
 *
 * Each "track" is a line of dialogue or narration with:
 *   - Character assignment (narrator, character 1, etc.)
 *   - Voice profile selection
 *   - Editable text
 *   - Per-track preview and delete
 *
 * Usage:
 *   <StoriesEditor
 *     profiles={[{ id, name, instruct }]}
 *     onGenerate={(tracks) => ...}
 *   />
 */
import React, { useState, useCallback, useRef } from 'react';
import { Plus, Play, Trash2, GripVertical, BookOpen, Mic, Download, Scissors, Pause as PauseIcon } from 'lucide-react';
import { Button } from '@/ui';
import './StoriesEditor.css';

// Sentence-aware splitter for the "Paste & auto-split" panel. Walks the
// text and breaks at the closest sentence boundary that keeps each chunk
// under `maxChars`. Falls back to whitespace, then to the hard cap.
function splitIntoChunks(text, maxChars) {
  const out = [];
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return out;
  const max = Math.max(40, Math.min(2000, maxChars | 0));
  let i = 0;
  while (i < clean.length) {
    const remain = clean.length - i;
    if (remain <= max) { out.push(clean.slice(i).trim()); break; }
    const window = clean.slice(i, i + max);
    // Prefer a sentence break inside the window, scanning from the end.
    let cut = -1;
    for (let j = window.length - 1; j > Math.floor(max * 0.4); j--) {
      if (/[.!?。！？]/.test(window[j])) { cut = j + 1; break; }
    }
    if (cut < 0) {
      // Fall back to last whitespace in the window.
      for (let j = window.length - 1; j > Math.floor(max * 0.4); j--) {
        if (/\s/.test(window[j])) { cut = j; break; }
      }
    }
    if (cut < 0) cut = max;
    out.push(clean.slice(i, i + cut).trim());
    i += cut;
  }
  return out.filter(Boolean);
}

const CHARACTERS = [
  { id: 'narrator', label: 'Narrator', color: 'var(--color-accent)' },
  { id: 'char-0',   label: 'Character 1', color: '#d3869b' },
  { id: 'char-1',   label: 'Character 2', color: '#83a598' },
  { id: 'char-2',   label: 'Character 3', color: '#b8bb26' },
  { id: 'char-3',   label: 'Character 4', color: '#fabd2f' },
  { id: 'char-4',   label: 'Character 5', color: '#fe8019' },
  { id: 'char-5',   label: 'Character 6', color: '#8ec07c' },
];

let _trackId = 0;

function makeTrack(character = 'narrator', text = '') {
  return {
    id: ++_trackId,
    character,
    text,
    profileId: null,
    generating: false,
    audioUrl: null,
  };
}

export default function StoriesEditor({ profiles = [], onGenerate }) {
  const [tracks, setTracks] = useState(() => [
    makeTrack('narrator', 'Once upon a time, in a land far away...'),
    makeTrack('char-0', 'Where are we going?'),
    makeTrack('char-1', 'I\'m not sure, but I think we should keep moving.'),
    makeTrack('narrator', 'The wind howled through the ancient trees as they pressed forward.'),
  ]);

  const [activeTrack, setActiveTrack] = useState(null);

  // Paste & auto-split — paste a long passage, pick a chunk size, hit Split,
  // and each chunk becomes its own track (assigned to Narrator by default).
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitText, setSplitText] = useState('');
  const [splitMax, setSplitMax] = useState(180);
  const trackTextRefs = useRef(new Map());

  const applySplit = useCallback(() => {
    const chunks = splitIntoChunks(splitText, splitMax);
    if (!chunks.length) return;
    setTracks(prev => [...prev, ...chunks.map(t => makeTrack('narrator', t))]);
    setSplitText('');
    setSplitOpen(false);
  }, [splitText, splitMax]);

  const insertPauseInto = useCallback((trackId) => {
    const el = trackTextRefs.current.get(trackId);
    const token = '[pause 0.5s]';
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const pos = el?.selectionStart;
      if (pos != null && pos >= 0 && pos <= t.text.length) {
        const before = t.text.slice(0, pos);
        const after = t.text.slice(pos);
        // Insert with surrounding spaces if the neighbours are non-whitespace,
        // so the token survives a future re-split.
        const left = before.length && !/\s$/.test(before) ? `${before} ` : before;
        const right = after.length && !/^\s/.test(after) ? ` ${after}` : after;
        return { ...t, text: `${left}${token}${right}` };
      }
      const sep = t.text.length && !/\s$/.test(t.text) ? ' ' : '';
      return { ...t, text: `${t.text}${sep}${token}` };
    }));
  }, []);

  const addTrack = useCallback(() => {
    setTracks(prev => [...prev, makeTrack()]);
  }, []);

  const removeTrack = useCallback((id) => {
    setTracks(prev => prev.filter(t => t.id !== id));
  }, []);

  const updateTrack = useCallback((id, field, value) => {
    setTracks(prev =>
      prev.map(t => t.id === id ? { ...t, [field]: value } : t)
    );
  }, []);

  const previewTrack = useCallback(async (track) => {
    if (!track.text.trim()) return;
    setTracks(prev =>
      prev.map(t => t.id === track.id ? { ...t, generating: true } : t)
    );

    try {
      const body = {
        text: track.text,
        profile_id: track.profileId || null,
        speed: 1.0,
      };
      // Use the preview-segment endpoint for quick generation
      const res = await fetch(`/api/dub/preview-segment/__stories__`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setTracks(prev =>
          prev.map(t => t.id === track.id ? { ...t, audioUrl: url, generating: false } : t)
        );
        // Auto-play
        const audio = new Audio(url);
        audio.play().catch(() => {});
      } else {
        setTracks(prev =>
          prev.map(t => t.id === track.id ? { ...t, generating: false } : t)
        );
      }
    } catch {
      setTracks(prev =>
        prev.map(t => t.id === track.id ? { ...t, generating: false } : t)
      );
    }
  }, []);

  const generateAll = useCallback(() => {
    if (onGenerate) {
      onGenerate(tracks);
    }
  }, [tracks, onGenerate]);

  // Stats
  const totalChars = tracks.reduce((acc, t) => acc + t.text.length, 0);
  const uniqueChars = new Set(tracks.map(t => t.character)).size;
  const estMinutes = Math.ceil(totalChars / 800); // ~800 chars/min speech

  const charInfo = (charId) => CHARACTERS.find(c => c.id === charId) || CHARACTERS[0];

  return (
    <div className="stories-editor" role="region" aria-label="Stories editor">
      {/* Header */}
      <div className="stories-editor__header">
        <div>
          <h2 className="stories-editor__title">
            <BookOpen size={18} />
            Stories Editor
          </h2>
          <p className="stories-editor__subtitle">
            Multi-track audiobook with per-character voice assignment
          </p>
        </div>
        <div className="stories-editor__actions">
          <Button size="sm" variant="ghost" onClick={() => setSplitOpen(v => !v)} aria-label="Paste & split">
            <Scissors size={13} /> Paste & Split
          </Button>
          <Button size="sm" variant="ghost" onClick={addTrack} aria-label="Add track">
            <Plus size={13} /> Add Line
          </Button>
          <Button size="sm" onClick={generateAll} disabled={tracks.length === 0}>
            <Download size={13} /> Generate All
          </Button>
        </div>
      </div>

      {splitOpen && (
        <div className="stories-editor__split-panel" role="region" aria-label="Paste long text and auto-split">
          <textarea
            className="stories-editor__split-text"
            placeholder="Paste a long passage. We'll split it into segments at sentence boundaries."
            value={splitText}
            onChange={(e) => setSplitText(e.target.value)}
            rows={6}
            aria-label="Long-form text input"
          />
          <div className="stories-editor__split-controls">
            <label className="stories-editor__split-label">
              Max chars per segment
              <input
                type="number"
                min={60}
                max={1000}
                step={10}
                value={splitMax}
                onChange={(e) => setSplitMax(parseInt(e.target.value, 10) || 180)}
                className="stories-editor__split-num"
              />
            </label>
            <span className="stories-editor__split-hint">
              {splitText
                ? `~${splitIntoChunks(splitText, splitMax).length} segment(s) at ${splitMax} chars`
                : 'Paste text above'}
            </span>
            <Button size="sm" variant="ghost" onClick={() => { setSplitText(''); setSplitOpen(false); }}>Cancel</Button>
            <Button size="sm" onClick={applySplit} disabled={!splitText.trim()}>
              <Scissors size={13} /> Split into tracks
            </Button>
          </div>
        </div>
      )}

      {/* Tracks */}
      {tracks.length === 0 ? (
        <div className="stories-editor__empty">
          <span className="stories-editor__empty-icon">📖</span>
          <p className="stories-editor__empty-text">
            Start your story by adding dialogue and narration tracks.
            Assign a unique voice to each character.
          </p>
          <Button size="sm" onClick={addTrack}>
            <Plus size={13} /> Add First Line
          </Button>
        </div>
      ) : (
        <div className="stories-editor__tracks" role="list">
          {tracks.map((track) => {
            const char = charInfo(track.character);
            return (
              <div
                key={track.id}
                role="listitem"
                className={[
                  'stories-track',
                  activeTrack === track.id ? 'stories-track--active' : '',
                  track.character === 'narrator' ? 'stories-track--narrator' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setActiveTrack(track.id)}
              >
                {/* Drag grip */}
                <div className="stories-track__grip" aria-hidden="true">
                  <GripVertical size={14} />
                </div>

                {/* Text */}
                <textarea
                  className="stories-track__text"
                  ref={(el) => {
                    if (el) trackTextRefs.current.set(track.id, el);
                    else trackTextRefs.current.delete(track.id);
                  }}
                  value={track.text}
                  onChange={(e) => updateTrack(track.id, 'text', e.target.value)}
                  placeholder="Enter dialogue or narration… use [pause 0.5s] to insert a silent break"
                  rows={1}
                  aria-label={`${char.label} text`}
                />

                {/* Voice selector */}
                <div className="stories-track__voice">
                  <span
                    className="stories-track__voice-dot"
                    data-char={track.character}
                    style={{ background: char.color }}
                  />
                  <select
                    className="stories-track__voice-select"
                    value={track.character}
                    onChange={(e) => updateTrack(track.id, 'character', e.target.value)}
                    aria-label="Character"
                  >
                    {CHARACTERS.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>

                {/* Voice profile */}
                <select
                  className="stories-track__character"
                  value={track.profileId || ''}
                  onChange={(e) => updateTrack(track.id, 'profileId', e.target.value || null)}
                  aria-label="Voice profile"
                >
                  <option value="">Default</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>

                {/* Actions */}
                <div className="stories-track__actions">
                  <button
                    className="stories-track__btn"
                    onClick={(e) => { e.stopPropagation(); insertPauseInto(track.id); }}
                    title="Insert a [pause 0.5s] break at the cursor"
                    aria-label="Insert pause"
                  >
                    <PauseIcon size={12} />
                  </button>
                  <button
                    className="stories-track__btn"
                    onClick={(e) => { e.stopPropagation(); previewTrack(track); }}
                    disabled={track.generating || !track.text.trim()}
                    title="Preview this line"
                    aria-label="Preview"
                  >
                    {track.generating ? <Mic size={12} className="spinner" /> : <Play size={12} />}
                  </button>
                  <button
                    className="stories-track__btn stories-track__btn--delete"
                    onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }}
                    title="Remove line"
                    aria-label="Remove"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer stats */}
      {tracks.length > 0 && (
        <div className="stories-editor__footer">
          <div className="stories-editor__stats">
            <span className="stories-editor__stat">
              📝 {tracks.length} lines
            </span>
            <span className="stories-editor__stat">
              🎭 {uniqueChars} characters
            </span>
            <span className="stories-editor__stat">
              ⏱ ~{estMinutes} min
            </span>
            <span className="stories-editor__stat">
              📊 {totalChars.toLocaleString()} chars
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

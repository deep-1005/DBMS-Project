'use client';

import { use, useEffect, useState } from 'react';

export default function HintsPage({ params }) {
  const { id } = use(params);

  const [hints, setHints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  async function loadHints() {
    try {
      setLoading(true);
      const response = await fetch(`/api/hints?challengeId=${id}`);
      const payload = await response.json();

      if (!response.ok) throw new Error(payload.error || 'Could not load hints.');

      setHints(payload.hints ?? []);
    } catch (err) {
      setError(true);
      setMessage(err.message || 'Could not load hints.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHints();
  }, [id]);

  async function unlock(hintId) {
    try {
      setBusyId(hintId);
      setMessage('');
      setError(false);

      const response = await fetch('/api/hints', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hintId }),
      });

      const payload = await response.json();

      if (!response.ok) throw new Error(payload.error || 'Hint could not be unlocked.');

      setMessage('Hint unlocked successfully.');
      await loadHints();
    } catch (err) {
      setError(true);
      setMessage(err.message || 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  }

  const unlocked = hints.filter((hint) => hint.unlocked).length;

  return (
    <main className="hints-page">
      <div className="hints-container">

        <header className="hints-header">
          <div>
            <div className="hints-eyebrow">CTFVAULT / CHALLENGE SUPPORT</div>
            <h1>Challenge hints</h1>
            <p>Need a little direction? Reveal clues to help you solve this challenge.</p>
          </div>
          <div className="hints-challenge">Challenge #{id}</div>
        </header>

        <section className="hints-overview">
          <div className="hints-stat">
            <span>Total hints</span>
            <strong>{hints.length}</strong>
          </div>
          <div className="hints-stat">
            <span>Unlocked</span>
            <strong className="hints-green">{unlocked}</strong>
          </div>
          <div className="hints-stat">
            <span>Remaining</span>
            <strong>{hints.length - unlocked}</strong>
          </div>
        </section>

        <section className="hints-section">
          <div className="hints-section-heading">
            <div>
              <h2>Available clues</h2>
              <p>Each clue can be unlocked individually for its listed point cost.</p>
            </div>
            <span className="hints-progress">{unlocked} / {hints.length} revealed</span>
          </div>

          <div className="hints-progress-track">
            <div
              className="hints-progress-fill"
              style={{ width: `${hints.length ? (unlocked / hints.length) * 100 : 0}%` }}
            />
          </div>

          {message && (
            <div className={`hints-message ${error ? 'is-error' : 'is-success'}`} role="status">
              {message}
            </div>
          )}

          {loading ? (
            <div className="hints-empty">Loading hints...</div>
          ) : hints.length === 0 ? (
            <div className="hints-empty">
              <h3>No hints available</h3>
              <p>This challenge does not have any hints yet.</p>
            </div>
          ) : (
            <div className="hints-list">
              {hints.map((hint) => (
                <article
                  key={hint.hint_id}
                  className={`hint-card ${hint.unlocked ? 'hint-unlocked' : ''}`}
                >
                  <div className="hint-card-top">
                    <div className="hint-title-group">
                      <span className="hint-number">
                        {String(hint.display_order).padStart(2, '0')}
                      </span>
                      <div>
                        <h3>{hint.title}</h3>
                        <p>{hint.unlocked ? 'This clue has been revealed.' : 'A clue is waiting to be discovered.'}</p>
                      </div>
                    </div>

                    <span className={`hint-status ${hint.unlocked ? 'status-unlocked' : 'status-locked'}`}>
                      {hint.unlocked ? 'UNLOCKED' : 'LOCKED'}
                    </span>
                  </div>

                  <div className="hint-card-bottom">
                    <div className="hint-cost">
                      <span>UNLOCK COST</span>
                      <strong>{hint.cost} <small>points</small></strong>
                    </div>

                    {!hint.unlocked && (
                      <button
                        type="button"
                        className="hint-unlock-button"
                        onClick={() => unlock(hint.hint_id)}
                        disabled={busyId !== null}
                      >
                        {busyId === hint.hint_id ? 'Unlocking...' : 'Unlock hint'}
                        <span aria-hidden="true"> →</span>
                      </button>
                    )}
                  </div>

                  {hint.unlocked && (
                    <div className="hint-revealed">
                      <span>REVEALED CLUE</span>
                      <p>{hint.body}</p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="hints-footer">
          CTFVault <span>·</span> Think strategically. Spend your points wisely.
        </footer>
      </div>
    </main>
  );
}
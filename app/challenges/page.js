//PES1UG24CS144_Deeptha
'use client';

/**
 * /challenges — the challenge board and flag submission.
 * Owner: Deeptha Shankar
 *
 * Points shown are live: each correct submission lowers a challenge's value
 * (fn_challenge_points), and the trigger adjusts earlier solvers too.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

export default function ChallengesPage() {
  const [challenges, setChallenges] = useState([]);
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState('');
  const [flags, setFlags] = useState({});
  const [results, setResults] = useState({});

  const load = useCallback(async () => {
    const qs = category ? `?category=${encodeURIComponent(category)}` : '';
    const response = await fetch(`/api/challenges${qs}`, { cache: 'no-store' });
    const payload = await response.json();
    setChallenges(payload.challenges ?? []);
    if (!category) {
      setCategories([...new Set((payload.challenges ?? []).map((c) => c.category))].sort());
    }
  }, [category]);

  useEffect(() => { load(); }, [load]);

  async function submit(event, challengeId) {
    event.preventDefault();
    const response = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId, flag: flags[challengeId] ?? '' }),
    });
    const payload = await response.json();
    const kind = payload.firstBlood ? 'blood' : payload.correct && payload.accepted
      ? 'ok' : 'bad';
    const text = payload.accepted && payload.correct
      ? `${payload.message} +${payload.pointsAwarded} points`
      : payload.message ?? payload.error ?? 'Submission failed.';
    setResults({ ...results, [challengeId]: { kind, text } });
    if (payload.correct) {
      setFlags({ ...flags, [challengeId]: '' });
      load();
    }
  }

  return (
    <main>
      <div className="page-head">
        <h1>Challenges</h1>
        <label className="inline">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <p className="muted">Points decay as more teams solve a challenge. The first
        team to solve earns a first-blood bonus.</p>

      <table>
        <thead>
          <tr>
            <th>Challenge</th><th>Category</th><th className="num">Points</th>
            <th className="num">Solves</th><th>First blood</th><th>Submit flag</th>
          </tr>
        </thead>
        <tbody>
          {challenges.map((c) => (
            <tr key={c.challenge_id}>
              <td>
                <strong>{c.title}</strong>
                <div className="sub">
                  <Link href={`/challenges/${c.challenge_id}/hints`}>Hints</Link>
                </div>
              </td>
              <td><span className="tag">{c.category}</span></td>
              <td className="num">{c.current_points}</td>
              <td className="num">{c.solve_count}</td>
              <td>{c.first_blood_team ?? <span className="muted">—</span>}</td>
              <td>
                {c.solved_by_my_team ? (
                  <span className="pill solved">Solved</span>
                ) : c.is_locked ? (
                  <span className="pill locked">Locked</span>
                ) : (
                  <form className="flag-form" onSubmit={(e) => submit(e, c.challenge_id)}>
                    <input placeholder="pes{…}" value={flags[c.challenge_id] ?? ''}
                      onChange={(e) => setFlags({ ...flags, [c.challenge_id]: e.target.value })} />
                    <button type="submit">Submit</button>
                  </form>
                )}
                {results[c.challenge_id] && (
                  <div className={`result ${results[c.challenge_id].kind}`}>
                    {results[c.challenge_id].text}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

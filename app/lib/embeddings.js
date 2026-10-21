const DIMENSION = Number(process.env.EMBEDDING_DIM ?? 384);

export function chunkText(text, targetWords = 500, overlapWords = 50) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  const step = Math.max(1, targetWords - overlapWords);
  for (let start = 0; start < words.length; start += step) {
    const content = words.slice(start, start + targetWords).join(' ');
    if (content) chunks.push({ content, tokenCount: content.split(/\s+/).length });
  }
  return chunks;
}

export async function embedTexts(texts) {
  const endpoint = process.env.EMBEDDING_SERVICE_URL;
  if (!endpoint) throw new Error('EMBEDDING_SERVICE_URL is not configured.');

  const response = await fetch(`${endpoint.replace(/\/$/, '')}/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      texts,
      model: process.env.EMBEDDING_MODEL,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Embedding service returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload?.embeddings) || payload.embeddings.length !== texts.length) {
    throw new Error('Embedding service returned an invalid batch.');
  }
  for (const vector of payload.embeddings) {
    if (!Array.isArray(vector) || vector.length !== DIMENSION ||
        vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`Embedding vectors must contain ${DIMENSION} finite numbers.`);
    }
  }
  return payload.embeddings;
}

export function pgVector(values) {
  return `[${values.join(',')}]`;
}

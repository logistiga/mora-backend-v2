/**
 * Splits a complete LLM response into sentence-sized chunks so TTS can start
 * speaking the first sentence while later ones are still being requested
 * (AGENTS Phase F §21: pragmatic latency win without duplicating
 * Orchestrator logic for token-level LLM streaming — see the Phase F report
 * for why full `chatStream()` was rejected as unnecessary/over-engineering).
 *
 * Splits on sentence-ending punctuation (. ! ? …) followed by whitespace,
 * with a minimum chunk length so short abbreviations ("M. Dupont") don't
 * fragment into unnaturally tiny TTS requests.
 */
export function splitIntoSentenceChunks(text: string, minChunkChars = 20): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const sentenceBoundary = /(?<=[.!?…])\s+(?=[A-ZÀ-Ý0-9"'«])/g;
  const rawParts = trimmed.split(sentenceBoundary);

  const chunks: string[] = [];
  let buffer = '';
  for (const part of rawParts) {
    buffer = buffer ? `${buffer} ${part}` : part;
    if (buffer.length >= minChunkChars) {
      chunks.push(buffer.trim());
      buffer = '';
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());

  return chunks.length > 0 ? chunks : [trimmed];
}

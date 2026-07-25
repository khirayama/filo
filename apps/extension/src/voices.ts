// Local voices sound better and work offline, so they are preferred and
// listed first.
export function pickDefaultVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const local = voices.filter((v) => v.localService);
  const pool = local.length > 0 ? local : voices;
  return pool.find((v) => v.name.includes("Kyoko")) ?? pool[0];
}

export function getSortedVoices(): SpeechSynthesisVoice[] {
  const voices = speechSynthesis.getVoices();
  const local = voices.filter((v) => v.localService);
  const remote = voices.filter((v) => !v.localService);
  return [...local, ...remote];
}

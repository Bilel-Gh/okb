import { useT } from '../app/i18n';
import { useShareWords } from '../app/sharing';

/** A present call's usage: zero stays zero, and missing or estimated counts stay explicit. */
export function TokenUsage({ tokens, estimated = false }: { tokens: number | null | undefined; estimated?: boolean }) {
  const t = useT(); const w = useShareWords();
  if (tokens === null || tokens === undefined) return <>{w('Tokens non communiqués', 'Token usage unavailable')}</>;
  return <>{estimated ? '≈ ' : ''}{tokens.toLocaleString(t.lang)} tokens{estimated ? ` · ${w('estimation', 'estimate')}` : ''}</>;
}

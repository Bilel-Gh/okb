import * as Dialog from '@radix-ui/react-dialog';
import { MessageCircle, X } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { hrefFor } from '../app/router';
import { useShareWords } from '../app/sharing';
import { SkeletonRows } from './States';

const AssistantChat = lazy(() => import('../pages/Assistant').then((module) => ({ default: module.AssistantChat })));

/** The shell keeps only this trigger; the conversation module loads when the panel opens. */
export function AssistantPanel({ context }: { context: string }) {
  const w = useShareWords();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState('');
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger asChild><button type="button" className="btn ghost icon" aria-label={w('Ouvrir le panneau Assistant', 'Open the Assistant panel')} title={w('Assistant', 'Assistant')}><MessageCircle size={18} aria-hidden="true" /></button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="assistant-overlay" /><Dialog.Content className="assistant-panel"><div className="row assistant-panel-head"><Dialog.Title>{w('Assistant', 'Assistant')}</Dialog.Title><span className="spacer" /><a className="link small" href={hrefFor({ name: 'assistant', ...(conversationId ? { id: conversationId } : {}) })} onClick={() => setOpen(false)}>{w('Ouvrir l’écran', 'Open the screen')}</a><Dialog.Close asChild><button type="button" className="btn ghost icon" aria-label={w('Fermer le panneau Assistant', 'Close the Assistant panel')}><X size={18} aria-hidden="true" /></button></Dialog.Close></div><Dialog.Description className="sr-only">{w('Parlez à votre agent local en gardant votre écran ouvert.', 'Talk to your local agent while keeping your screen open.')}</Dialog.Description>{open ? <Suspense fallback={<SkeletonRows rows={4} />}><AssistantChat initialId={conversationId} onConversation={setConversationId} context={context} compact /></Suspense> : null}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

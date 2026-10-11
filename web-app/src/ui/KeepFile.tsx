import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { useRef } from 'react';
import { post } from '../app/api';
import { tn, useT } from '../app/i18n';
import { toast } from '../app/toast';

const MAX_BYTES = 20_000_000;
const toBase64 = (file: File) => new Promise<string>((done, fail) => {
  const reader = new FileReader();
  reader.onload = () => done(String(reader.result).replace(/^data:[^,]*,/, ''));
  reader.onerror = () => fail(reader.error);
  reader.readAsDataURL(file);
});

/** Keep files as they are: each one is copied once into the space, its text read for the search. */
export function useKeepFiles(project?: string) {
  const t = useT();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (files: File[]) => {
      let kept = 0;
      for (const file of files) {
        if (file.size > MAX_BYTES) { toast(t('app.docs.tooBig', { name: file.name }), 'err'); continue; }
        await post('/api/documents', { name: file.name, data: await toBase64(file), ...(project ? { project } : {}) });
        kept++;
      }
      return kept;
    },
    onSuccess: (kept) => {
      if (kept) toast(tn(t, 'app.docs.kept', kept));
      for (const key of ['documents', 'entries', 'today']) void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => toast((e as Error).message, 'err'),
  });
}

export function KeepFileButton({ project, small = false, label }: { project?: string; small?: boolean; label?: string }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const keep = useKeepFiles(project);
  return (
    <>
      <input ref={input} type="file" multiple hidden onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) keep.mutate(files); }} />
      <button type="button" className={`btn${small ? ' sm' : ' primary'}`} onClick={() => input.current?.click()} disabled={keep.isPending} aria-busy={keep.isPending || undefined}><Paperclip size={small ? 14 : 16} aria-hidden="true" />{label ?? t('app.docs.keep')}</button>
    </>
  );
}

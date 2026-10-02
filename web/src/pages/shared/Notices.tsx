import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Megaphone, Siren, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { useFeedback } from '../../lib/feedback';
import { dayLabel, isoDay } from '../../lib/format';
import { Button, Empty, IconButton, SectionHead, Skeleton, Tag, css } from '../../ui';
import { AttachmentView, type AttachmentInfo } from './Attachment';

export type Priority = 'normal' | 'important' | 'urgent';
export type MyNotice = {
  id: number; title: string; body: string; priority: Priority; audienceLabel: string; from: string;
  sentAt: string; day: string; time: string; expiresLabel: string | null; read: boolean; needsAck: boolean; ackedAt: string | null;
  attachment: AttachmentInfo | null;
};
type Inbox = { unread: number; pendingAck: number; items: MyNotice[] };

export const useMyNotices = () => useQuery({ queryKey: ['notices', 'mine'], queryFn: () => api.get<Inbox>('/me/notices') });

export const PRIORITY_META: Record<Priority, { label: string; tag: 'danger' | 'pending' | 'info'; icon: typeof Megaphone }> = {
  urgent: { label: 'Urgent', tag: 'danger', icon: Siren },
  important: { label: 'Important', tag: 'pending', icon: TriangleAlert },
  normal: { label: 'Notice', tag: 'info', icon: Megaphone },
};

/** Header button with unread badge. */
export function NoticesButton({ to }: { to: string }) {
  const nav = useNavigate();
  const q = useMyNotices().data;
  return <IconButton icon={Megaphone} label="Notices" badge={q ? Math.max(q.unread, q.pendingAck) : 0} onClick={() => nav(to)} />;
}

function useAck() {
  const qc = useQueryClient();
  const { toast, fail } = useFeedback();
  return useMutation({
    mutationFn: (id: number) => api.post(`/me/notices/${id}/ack`),
    onSuccess: () => { toast('Thanks — admin can see you have read this'); qc.invalidateQueries({ queryKey: ['notices'] }); },
    onError: fail,
  });
}

export function NoticeCard({ n, clamp }: { n: MyNotice; clamp?: boolean }) {
  const ack = useAck();
  const meta = PRIORITY_META[n.priority];
  const when = n.day === isoDay() ? `Today, ${n.time}` : `${dayLabel(n.day)}, ${n.time}`;
  return (
    <article className={`card notice-card p-${n.priority}` + (n.read ? '' : ' unread')}>
      <div className="card-head">
        <div className={`icon-tile ${n.priority === 'urgent' ? 'danger' : n.priority === 'important' ? 'toned tone-amber' : 'toned tone-indigo'}`}><meta.icon size={18} /></div>
        <div className="grow stack" style={css({ '--gap': '0' })}>
          <span className="notice-title">{n.title}</span>
          <span className="micro">{n.from} · {when}{n.expiresLabel ? ` · until ${n.expiresLabel}` : ''}</span>
        </div>
        <Tag tone={meta.tag}>{meta.label}</Tag>
      </div>
      <p className={'notice-body' + (clamp ? ' clamp' : '')}>{n.body}</p>
      {n.attachment && <AttachmentView a={n.attachment} />}
      {n.needsAck
        ? <Button variant="primary" icon={CheckCheck} loading={ack.isPending} onClick={() => ack.mutate(n.id)}>I've read this</Button>
        : n.ackedAt && <span className="micro" style={{ color: 'var(--ok)' }}>✓ Acknowledged {n.ackedAt}</span>}
    </article>
  );
}

/** Full notice board. Opening it marks everything as read (urgent ones still need an explicit acknowledgement). */
export function NoticeBoard() {
  const q = useMyNotices();
  const qc = useQueryClient();
  const unreadIds = (q.data?.items ?? []).filter(n => !n.read).map(n => n.id).join(',');
  useEffect(() => {
    if (!unreadIds) return;
    const t = setTimeout(() => {
      Promise.all(unreadIds.split(',').map(id => api.post(`/me/notices/${id}/read`))).then(() => qc.invalidateQueries({ queryKey: ['notices'] }));
    }, 1200); // brief delay so the unread highlight is visible
    return () => clearTimeout(t);
  }, [unreadIds, qc]);
  const items = q.data?.items ?? [];
  return (
    <main className="content shell-col">
      <SectionHead title="From the society office" count={items.length} />
      {q.isLoading ? <Skeleton h={140} n={2} /> : items.length === 0
        ? <Empty icon={Megaphone} title="No notices right now">Announcements from your society admin will appear here.</Empty>
        : items.map(n => <NoticeCard key={n.id} n={n} />)}
    </main>
  );
}

/** On home screens: urgent notices awaiting acknowledgement and unread important ones. */
export function PinnedNotices({ to }: { to: string }) {
  const nav = useNavigate();
  const items = (useMyNotices().data?.items ?? []).filter(n => n.needsAck || (!n.read && n.priority !== 'normal'));
  const unreadNormal = (useMyNotices().data?.items ?? []).filter(n => !n.read && n.priority === 'normal').length;
  if (!items.length && !unreadNormal) return null;
  return (
    <div className="stack" style={css({ '--gap': '10px' })}>
      {items.slice(0, 2).map(n => <NoticeCard key={n.id} n={n} clamp />)}
      {(items.length > 2 || unreadNormal > 0) && (
        <button className="notice-more" onClick={() => nav(to)}>
          <Megaphone size={16} />
          <span className="grow">{unreadNormal > 0 ? `${unreadNormal} new notice${unreadNormal === 1 ? '' : 's'} from the society office` : 'See all notices'}</span>
          <span className="go">Open</span>
        </button>
      )}
    </div>
  );
}

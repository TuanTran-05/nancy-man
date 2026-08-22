import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  getZaloBotAdminOverview,
  adminLinkZaloBotChat,
  adminUnlinkZaloBotStaff,
  adminSendZaloBotTest,
  type ZaloBotAdminOverview,
} from '../../lib/zalo/zaloBotService';
import { Bot, Link as LinkIcon, Unlink, RefreshCw, AlertCircle, Send } from 'lucide-react';

export function ZaloBotManagementPanel() {
  const [data, setData] = useState<{ botEnabled: boolean; overview: ZaloBotAdminOverview } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [selectedChatIdHash, setSelectedChatIdHash] = useState('');
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getZaloBotAdminOverview();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load Zalo Bot overview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleLink = async () => {
    if (!selectedStaffId || !selectedChatIdHash || linking) return;
    setLinking(true);
    try {
      await adminLinkZaloBotChat({ staffId: selectedStaffId, chatIdHash: selectedChatIdHash });
      toast.success('Successfully linked Zalo Bot to staff account');
      setSelectedStaffId('');
      setSelectedChatIdHash('');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to link account');
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async (staffId: string) => {
    if (unlinking) return;
    setUnlinking(staffId);
    try {
      await adminUnlinkZaloBotStaff(staffId);
      toast.success('Successfully unlinked staff account');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to unlink account');
    } finally {
      setUnlinking(null);
    }
  };

  const handleSendTest = async (staffId: string) => {
    if (sendingTest) return;
    setSendingTest(staffId);
    try {
      await adminSendZaloBotTest(staffId);
      toast.success('Successfully queued test message');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send test message');
    } finally {
      setSendingTest(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-border-default bg-surface p-6">
        <div className="h-6 w-48 animate-pulse rounded bg-surface-alt mb-4"></div>
        <div className="h-32 animate-pulse rounded bg-surface-alt"></div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-400">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-5 w-5" />
          Failed to load Zalo Bot management
        </div>
        <p className="mt-2 text-sm">{error}</p>
        <button
          onClick={loadData}
          className="mt-4 rounded-lg bg-red-100 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-300 dark:hover:bg-red-500/30"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { botEnabled, overview } = data;
  const { staff, links, pendingChats, recentMessages } = overview;
  const ambiguousMessages = recentMessages.filter((message) => message.deliveryAmbiguous);

  return (
    <div className="rounded-xl border border-border-default bg-surface p-6 shadow-sm">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-heading">
            <Bot className="h-5 w-5 text-blue-600" />
            Zalo Bot nội bộ
          </h2>
          <p className="mt-1 text-sm text-subtle">
            Manage internal staff bot connections. This is separate from Zalo OA / ZNS messaging to
            parents.
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="rounded-lg p-2 text-subtle hover:bg-surface-alt disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {!botEnabled && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-400">
          <strong>Bot is currently disabled.</strong> Server configuration must be enabled to link
          or unlink accounts. The panel is read-only.
        </div>
      )}

      {ambiguousMessages.length > 0 && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300"
        >
          <strong>{ambiguousMessages.length} delivery attempt(s) have an ambiguous outcome.</strong>{' '}
          The provider may already have accepted these messages. Inspect the message and provider
          logs before retrying to avoid duplicates.
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Link new account */}
        <div className="space-y-4">
          <h3 className="font-semibold text-heading">Link Pending Chat</h3>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-subtle">Pending Chat</label>
            <select
              value={selectedChatIdHash}
              onChange={(e) => setSelectedChatIdHash(e.target.value)}
              disabled={!botEnabled || linking}
              className="w-full rounded-lg border border-border-default bg-page px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            >
              <option value="">-- Select a pending chat --</option>
              {pendingChats.map((chat) => (
                <option key={chat.chatIdHash} value={chat.chatIdHash}>
                  {chat.displayName} {chat.username ? `(${chat.username})` : ''} - Last seen:{' '}
                  {new Date(chat.lastSeenAt).toLocaleString()}
                </option>
              ))}
            </select>
            {pendingChats.length === 0 && (
              <p className="mt-1 text-xs text-subtle">
                No pending chats. Staff must send a message to the bot first.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-subtle">Staff Member</label>
            <select
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              disabled={!botEnabled || linking}
              className="w-full rounded-lg border border-border-default bg-page px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            >
              <option value="">-- Select a staff member --</option>
              {staff.map((member) => {
                const link = links.find((l) => l.staffId === member.uid);
                const statusStr = link ? `[${link.status}]` : '[unlinked]';
                return (
                  <option key={member.uid} value={member.uid} disabled={link?.status === 'active'}>
                    {member.displayName} ({member.role}) {statusStr}
                  </option>
                );
              })}
            </select>
          </div>

          <button
            onClick={handleLink}
            disabled={!botEnabled || !selectedStaffId || !selectedChatIdHash || linking}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <LinkIcon className="h-4 w-4" />
            {linking ? 'Linking...' : 'Link Account'}
          </button>
        </div>

        {/* Existing links */}
        <div>
          <h3 className="mb-4 font-semibold text-heading">Active Links</h3>
          <div className="space-y-3">
            {links.length === 0 ? (
              <p className="text-sm text-subtle">No active links found.</p>
            ) : (
              links.map((link) => {
                const staffMember = staff.find((s) => s.uid === link.staffId);
                const isUnlinking = unlinking === link.staffId;

                return (
                  <div
                    key={link.staffId}
                    className="flex items-center justify-between rounded-lg border border-border-light bg-page p-3"
                  >
                    <div>
                      <div className="font-medium text-heading">
                        {link.displayName}
                        {staffMember && (
                          <span className="ml-2 rounded bg-surface-alt px-1.5 py-0.5 text-xs text-subtle">
                            {staffMember.role}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-subtle">
                        Status:{' '}
                        <span
                          className={
                            link.status === 'active' ? 'text-emerald-600' : 'text-amber-600'
                          }
                        >
                          {link.status}
                        </span>
                        <span className="mx-2">•</span>
                        Linked: {new Date(link.linkedAt).toLocaleDateString()}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {staffMember &&
                        staffMember.role === link.role &&
                        link.status === 'active' && (
                          <button
                            onClick={() => handleSendTest(link.staffId)}
                            disabled={!botEnabled || sendingTest === link.staffId || !!sendingTest}
                            className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-900/60 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
                            title="Send test message"
                          >
                            <Send
                              className={`h-3 w-3 ${sendingTest === link.staffId ? 'animate-pulse' : ''}`}
                            />
                            Test
                          </button>
                        )}
                      <button
                        onClick={() => handleUnlink(link.staffId)}
                        disabled={!botEnabled || isUnlinking || !!unlinking}
                        className="rounded p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10"
                        title="Unlink"
                      >
                        <Unlink className={`h-4 w-4 ${isUnlinking ? 'animate-pulse' : ''}`} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 border-t border-border-light pt-6">
        <h3 className="mb-3 font-semibold text-heading">Recent Delivery Messages</h3>
        {recentMessages.length === 0 ? (
          <p className="text-sm text-subtle">No delivery messages recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-subtle">
                <tr>
                  <th className="px-2 py-2">Recipient</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Attempts</th>
                  <th className="px-2 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {recentMessages.map((message) => (
                  <tr key={message.id} className="border-t border-border-light">
                    <td className="px-2 py-2 text-heading">{message.staffId}</td>
                    <td className="px-2 py-2 text-subtle">{message.messageType}</td>
                    <td className="px-2 py-2">
                      <span
                        className={
                          message.status === 'sent'
                            ? 'text-emerald-600'
                            : message.deliveryAmbiguous
                              ? 'font-semibold text-red-600'
                              : 'text-amber-600'
                        }
                      >
                        {message.status}
                        {message.deliveryAmbiguous ? ' · ambiguous' : ''}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-subtle">{message.attempts}</td>
                    <td className="px-2 py-2 text-subtle">
                      {message.providerMessageId || message.errorCode || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

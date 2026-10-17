import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  Send,
  Plus,
  Search,
  RefreshCw,
  LogOut,
  Star,
  ExternalLink,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/ui/Toast';
import { emailApi, API_BASE_URL } from '../api/client';
import type { EmailJob, EmailStats } from '../types';
import { ComposeModal } from '../components/ComposeModal';
import { EmailDetailModal } from '../components/EmailDetailModal';
import { SlackHeaderChip } from '../components/SlackHeaderChip';
import { Table } from '../components/ui/Table';
import type { Column } from '../components/ui/Table';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import { useDebounce } from '../hooks/useDebounce';

export const DashboardPage: React.FC = () => {
  const { user, logout, refreshUser } = useAuth();
  const { error } = useToast();

  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [emails, setEmails] = useState<EmailJob[]>([]);
  const [stats, setStats] = useState<EmailStats>({ scheduled: 0, sent: 0 });
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const debouncedSearch = useDebounce(searchQuery, 350);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);

  // Modals
  const [isComposeOpen, setIsComposeOpen] = useState<boolean>(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailJob | null>(null);

  // Starred emails state (stored in local state)
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());

  const toggleStar = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchData = useCallback(
    async (isBackground = false) => {
      try {
        if (!isBackground) {
          setLoading(true);
        } else {
          setIsRefreshing(true);
        }

        // Fetch stats
        const statsData = await emailApi.getStats();
        setStats(statsData);

        // Fetch emails based on activeTab and debounced search
        if (debouncedSearch.trim()) {
          const searchRes = await emailApi.search(
            debouncedSearch.trim(),
            activeTab,
            page,
            15
          );
          setEmails(searchRes.emails);
          setTotalPages(searchRes.totalPages || 1);
        } else if (activeTab === 'scheduled') {
          const schedRes = await emailApi.getScheduled(page, 15);
          setEmails(schedRes.emails);
          setTotalPages(schedRes.totalPages || 1);
        } else {
          const sentRes = await emailApi.getSent(page, 15);
          setEmails(sentRes.emails);
          setTotalPages(sentRes.totalPages || 1);
        }
      } catch (err: any) {
        if (!isBackground) {
          error('Failed to load email jobs');
        }
      } finally {
        if (!isBackground) setLoading(false);
        setIsRefreshing(false);
      }
    },
    [activeTab, debouncedSearch, page, error]
  );

  // Fetch when search, tab, or page changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset page when search or tab changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, activeTab]);

  // Auto-refresh tables every 10s (background polling)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Format date matching Figma (e.g. "Tue 9:15:12 AM")
  const formatScheduledTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const day = d.toLocaleDateString('en-US', { weekday: 'short' });
    const time = d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
    return `${day} ${time}`;
  };

  // Table Columns
  const columns: Column<EmailJob>[] = [
    {
      header: 'Recipient',
      className: 'w-48 font-semibold text-slate-800',
      cell: (job) => (
        <div className="flex items-center gap-2">
          <span>To: {job.toEmail.split('@')[0]}</span>
        </div>
      ),
    },
    {
      header: 'Details & Message',
      className: 'flex-1',
      cell: (job) => (
        <div className="flex items-center gap-3">
          {job.status === 'scheduled' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 flex-shrink-0">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              <span>{formatScheduledTime(job.scheduledAt)}</span>
            </span>
          ) : job.status === 'sent' ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200 flex-shrink-0">
              Sent
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 flex-shrink-0">
              Failed
            </span>
          )}

          <div className="text-slate-700 text-sm truncate max-w-xl">
            <span className="font-semibold text-slate-900">{job.subject}</span>
            <span className="text-slate-400 mx-1.5">—</span>
            <span className="text-slate-500">
              {job.body.replace(/<[^>]*>/g, '').slice(0, 80)}...
            </span>
          </div>
        </div>
      ),
    },
    {
      header: '',
      className: 'w-12 text-right',
      cell: (job) => (
        <button
          onClick={(e) => toggleStar(job.id, e)}
          className={`p-1.5 rounded-lg transition-colors ${
            starredIds.has(job.id)
              ? 'text-amber-400 fill-amber-400'
              : 'text-slate-300 hover:text-slate-400'
          }`}
        >
          <Star
            className={`w-4 h-4 ${starredIds.has(job.id) ? 'fill-current' : ''}`}
          />
        </button>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* LEFT SIDEBAR (Matching Figma) */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col justify-between p-4 flex-shrink-0">
        <div>
          {/* Logo / Header */}
          <div className="flex items-center gap-2 mb-6 px-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-sm shadow">
              R
            </div>
            <span className="font-bold text-slate-800 text-base">
              Reach<span className="text-emerald-600">Inbox</span>
            </span>
          </div>

          {/* User Profile Card */}
          <div className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 bg-slate-50/60 mb-5">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <img
                src={
                  user?.avatar ||
                  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80&auto=format&fit=crop&q=80'
                }
                alt={user?.name || 'Oliver Brown'}
                className="w-8 h-8 rounded-full object-cover border border-slate-200 flex-shrink-0"
              />
              <div className="truncate">
                <div className="text-xs font-bold text-slate-800 truncate">
                  {user?.name || 'Oliver Brown'}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {user?.email || 'oliver.brown@domain.io'}
                </div>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </div>

          {/* + Compose Button (Green Outlined pill) */}
          <button
            onClick={() => setIsComposeOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 mb-6 rounded-xl border border-emerald-600 text-emerald-700 font-semibold text-sm hover:bg-emerald-50 transition-all shadow-sm active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>Compose</span>
          </button>

          {/* CORE Navigation section */}
          <div className="space-y-1">
            <div className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              Core
            </div>

            {/* Scheduled Tab */}
            <button
              onClick={() => {
                setActiveTab('scheduled');
                setPage(1);
              }}
              className={`flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'scheduled'
                  ? 'bg-emerald-50 text-emerald-800 shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <Clock
                  className={`w-4 h-4 ${
                    activeTab === 'scheduled'
                      ? 'text-emerald-600'
                      : 'text-slate-400'
                  }`}
                />
                <span>Scheduled</span>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                  activeTab === 'scheduled'
                    ? 'bg-emerald-200/70 text-emerald-900'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {stats.scheduled}
              </span>
            </button>

            {/* Sent Tab */}
            <button
              onClick={() => {
                setActiveTab('sent');
                setPage(1);
              }}
              className={`flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'sent'
                  ? 'bg-emerald-50 text-emerald-800 shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <Send
                  className={`w-4 h-4 ${
                    activeTab === 'sent'
                      ? 'text-emerald-600'
                      : 'text-slate-400'
                  }`}
                />
                <span>Sent</span>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                  activeTab === 'sent'
                    ? 'bg-emerald-200/70 text-emerald-900'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {stats.sent}
              </span>
            </button>
          </div>
        </div>

        {/* BOTTOM SIDEBAR: BullMQ Monitor */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <a
            href={`${API_BASE_URL}/admin/queues`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>BullMQ Queue UI</span>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </a>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 flex-shrink-0">
          {/* Left Header: Breadcrumbs / Mode */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Workspace
            </span>
            <span className="text-slate-300">/</span>
            <span className="text-sm font-semibold text-slate-800">
              {activeTab === 'scheduled' ? 'Scheduled Queue' : 'Delivered History'}
            </span>
          </div>

          {/* Right Header: Slack Status Chip, Refresh, User, Logout */}
          <div className="flex items-center gap-3">
            {/* Real Slack OAuth / Status Chip with Disconnect */}
            <SlackHeaderChip onStatusChange={refreshUser} />

            <div className="h-5 w-px bg-slate-200 mx-1" />

            <button
              onClick={() => fetchData(false)}
              title="Refresh Data (Auto-refreshes every 10s)"
              className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading || isRefreshing ? 'animate-spin text-emerald-600' : ''}`}
              />
            </button>

            <div className="flex items-center gap-2.5 pl-2">
              <img
                src={
                  user?.avatar ||
                  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80&auto=format&fit=crop&q=80'
                }
                alt={user?.name || 'User'}
                className="w-8 h-8 rounded-full border border-slate-200 object-cover"
              />
              <span className="text-sm font-semibold text-slate-800 hidden sm:inline">
                {user?.name || 'Oliver Brown'}
              </span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              icon={<LogOut className="w-4 h-4 text-slate-500" />}
              className="ml-1 text-slate-600"
            >
              Logout
            </Button>
          </div>
        </header>

        {/* Dashboard Content Container */}
        <div className="p-8 max-w-7xl w-full mx-auto">
          {/* Section Title */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                {activeTab === 'scheduled'
                  ? 'Scheduled Emails'
                  : 'Sent Emails'}
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {activeTab === 'scheduled'
                  ? 'Upcoming delayed BullMQ email jobs queued for delivery.'
                  : 'Delivered and archived email campaign records.'}
              </p>
            </div>

            <Button
              variant="primary"
              onClick={() => setIsComposeOpen(true)}
              icon={<Plus className="w-4 h-4" />}
            >
              Compose New Email
            </Button>
          </div>

          {/* Search Box Directly Above the Tables (with Debounce) */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${activeTab} emails via Elasticsearch...`}
                className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-slate-800 placeholder-slate-400 shadow-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600 p-0.5"
                  title="Clear search"
                >
                  &times;
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Auto-refreshes every 10s</span>
              </span>
            </div>
          </div>

          {/* Email List / Table */}
          <Table
            columns={columns}
            data={emails}
            loading={loading}
            onRowClick={(item) => setSelectedEmail(item)}
            emptyState={
              <EmptyState
                title={
                  activeTab === 'scheduled'
                    ? 'No scheduled emails'
                    : 'No sent emails yet'
                }
                description={
                  activeTab === 'scheduled'
                    ? 'Click the Compose button to schedule delayed emails with round-robin senders.'
                    : 'Emails that have been successfully dispatched will appear here.'
                }
                action={
                  activeTab === 'scheduled' ? (
                    <Button
                      variant="primary"
                      onClick={() => setIsComposeOpen(true)}
                      icon={<Plus className="w-4 h-4" />}
                    >
                      Compose Email
                    </Button>
                  ) : undefined
                }
              />
            }
          />

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 px-2">
              <span className="text-xs text-slate-500">
                Page <span className="font-semibold text-slate-800">{page}</span> of{' '}
                <span className="font-semibold text-slate-800">{totalPages}</span>
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Compose Email Modal */}
      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        onSuccess={fetchData}
      />

      {/* Email Details View Modal */}
      <EmailDetailModal
        email={selectedEmail}
        onClose={() => setSelectedEmail(null)}
      />
    </div>
  );
};

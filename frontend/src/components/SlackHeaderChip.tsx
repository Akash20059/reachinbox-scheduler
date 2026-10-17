import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, ChevronDown, ExternalLink, LogOut, RefreshCw } from 'lucide-react';
import { slackApi } from '../api/client';
import type { SlackStatus } from '../types';
import { useToast } from './ui/Toast';

interface SlackHeaderChipProps {
  onStatusChange?: (status: SlackStatus) => void;
  className?: string;
}

export const SlackIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
  </svg>
);

export const SlackHeaderChip: React.FC<SlackHeaderChipProps> = ({
  onStatusChange,
  className = '',
}) => {
  const { success, error } = useToast();
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await slackApi.getStatus();
      setStatus(res);
    } catch {
      setStatus({ connected: false, channel: null, teamName: null });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();

    // Check for query params indicating OAuth return
    const params = new URLSearchParams(window.location.search);
    if (params.get('slack_connected') === 'true') {
      success('Slack connected! Rate limit notifications will arrive in your channel.');
      fetchStatus();
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('slack_error')) {
      error(`Slack connection failed: ${params.get('slack_error')}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDisconnect = async () => {
    try {
      setDisconnecting(true);
      await slackApi.disconnect();
      success('Slack webhook disconnected');
      setStatus({ connected: false, channel: null, teamName: null });
      setIsOpen(false);
      if (onStatusChange) {
        onStatusChange({ connected: false, channel: null, teamName: null });
      }
    } catch {
      error('Failed to disconnect Slack');
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 text-slate-400 text-xs animate-pulse">
        <SlackIcon className="w-3.5 h-3.5 text-slate-400" />
        <span>Checking Slack...</span>
      </div>
    );
  }

  // Connected state: show chip with channel and live pulse
  if (status?.connected) {
    return (
      <div className={`relative ${className}`} ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-semibold transition-all shadow-sm active:scale-95"
        >
          <SlackIcon className="w-3.5 h-3.5 text-[#4A154B]" />
          <span className="flex items-center gap-1 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-slate-800">
              #{status.channel || 'alerts'}
            </span>
          </span>
          <ChevronDown className="w-3 h-3 text-slate-500" />
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 p-3 z-50 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <SlackIcon className="w-4 h-4 text-[#4A154B]" />
                <span className="text-xs font-bold text-slate-800">
                  {status.teamName || 'Slack Workspace'}
                </span>
              </div>
              <span className="flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-100 font-bold px-1.5 py-0.5 rounded-md">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Active
              </span>
            </div>

            <div className="text-[11px] text-slate-500 space-y-1 mb-3">
              <div className="flex justify-between">
                <span>Channel:</span>
                <span className="font-medium text-slate-700">#{status.channel || 'alerts'}</span>
              </div>
              <div className="flex justify-between">
                <span>Alerts:</span>
                <span className="text-emerald-700 font-medium">Rate-limit triggers</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors disabled:opacity-50"
            >
              {disconnecting ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LogOut className="w-3.5 h-3.5" />
              )}
              <span>{disconnecting ? 'Disconnecting...' : 'Disconnect Slack'}</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // Not connected: show 'Connect Slack' button
  return (
    <a
      href={slackApi.getConnectUrl()}
      className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-slate-300 hover:border-[#4A154B] bg-white hover:bg-slate-50 text-slate-700 hover:text-[#4A154B] text-xs font-semibold transition-all shadow-sm active:scale-95 ${className}`}
    >
      <SlackIcon className="w-3.5 h-3.5 text-[#4A154B]" />
      <span>Connect Slack</span>
      <ExternalLink className="w-3 h-3 text-slate-400" />
    </a>
  );
};

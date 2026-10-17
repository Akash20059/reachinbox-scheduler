import React from 'react';
import type { EmailJob } from '../types';
import { X, ExternalLink, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

interface EmailDetailModalProps {
  email: EmailJob | null;
  onClose: () => void;
}

export const EmailDetailModal: React.FC<EmailDetailModalProps> = ({
  email,
  onClose,
}) => {
  if (!email) return null;

  const initial = email.sender?.name
    ? email.sender.name.charAt(0).toUpperCase()
    : email.toEmail.charAt(0).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden my-6">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                email.status === 'sent'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : email.status === 'scheduled'
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}
            >
              {email.status === 'sent' && <CheckCircle2 className="w-3.5 h-3.5" />}
              {email.status === 'scheduled' && <Clock className="w-3.5 h-3.5" />}
              {email.status === 'failed' && <AlertCircle className="w-3.5 h-3.5" />}
              {email.status.toUpperCase()}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Subject */}
          <h2 className="text-xl font-bold text-slate-900 mb-4">
            {email.subject}
          </h2>

          {/* Sender & Recipient Bar */}
          <div className="flex items-center justify-between py-3 border-y border-slate-100 mb-6 text-sm">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center shadow-sm">
                {initial}
              </div>
              <div>
                <div className="font-semibold text-slate-800">
                  {email.sender?.name || 'Sender'}
                  <span className="text-xs text-slate-400 font-normal ml-2">
                    &lt;{email.sender?.email || 'ethereal'}&gt;
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  to <span className="font-medium text-slate-700">{email.toEmail}</span>
                </div>
              </div>
            </div>

            <div className="text-right text-xs text-slate-500">
              <div>
                {email.sentAt
                  ? new Date(email.sentAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
                  : `Scheduled for ${new Date(email.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
              </div>
            </div>
          </div>

          {/* Email Body */}
          <div
            className="prose prose-sm max-w-none text-slate-700 leading-relaxed min-h-[140px] bg-slate-50/50 p-4 rounded-xl border border-slate-100"
            dangerouslySetInnerHTML={{ __html: email.body }}
          />

          {/* Ethereal Inbox Link */}
          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="text-xs text-slate-400">
              Job ID: <code className="text-slate-600">{email.id}</code>
            </div>

            <a
              href="https://ethereal.email/messages"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              <span>Open in Ethereal Mailbox</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

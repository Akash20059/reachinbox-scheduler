import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Clock,
  Upload,
  Send,
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline,
  List,
  Quote,
  Code,
} from 'lucide-react';
import Papa from 'papaparse';
import type { Sender } from '../types';
import { emailApi } from '../api/client';
import { useToast } from './ui/Toast';
import { Button } from './ui/Button';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { success, error } = useToast();

  const [senders, setSenders] = useState<Sender[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');
  const [toInput, setToInput] = useState<string>('');
  const [recipientList, setRecipientList] = useState<string[]>([]);
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [delayBetweenSeconds, setDelayBetweenSeconds] = useState<number>(2);
  const [hourlyLimit, setHourlyLimit] = useState<number>(200);

  // Send Later Popover state
  const [showSendLater, setShowSendLater] = useState<boolean>(false);
  const [scheduledDateTime, setScheduledDateTime] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      emailApi.getSenders().then((res) => {
        setSenders(res.senders);
        if (res.senders.length > 0 && !selectedSenderId) {
          setSelectedSenderId(res.senders[0].id);
        }
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddRecipient = (val: string) => {
    const raw = val.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s.includes('@'));
    const unique = Array.from(new Set([...recipientList, ...raw]));
    setRecipientList(unique);
    setToInput('');
  };

  const handleRemoveRecipient = (emailToRemove: string) => {
    setRecipientList(recipientList.filter((e) => e !== emailToRemove));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      complete: (results) => {
        const extractedEmails: string[] = [];
        results.data.forEach((row: any) => {
          if (Array.isArray(row)) {
            row.forEach((cell) => {
              if (typeof cell === 'string' && cell.includes('@') && cell.includes('.')) {
                extractedEmails.push(cell.trim());
              }
            });
          } else if (typeof row === 'object' && row !== null) {
            Object.values(row).forEach((val) => {
              if (typeof val === 'string' && val.includes('@') && val.includes('.')) {
                extractedEmails.push(val.trim());
              }
            });
          }
        });

        const unique = Array.from(new Set([...recipientList, ...extractedEmails]));
        setRecipientList(unique);
        success(`Parsed ${extractedEmails.length} email addresses from file`);
      },
      error: () => {
        error('Failed to parse lead file');
      },
    });
  };

  const applyPreset = (offsetMinutes: number, hour?: number) => {
    const target = new Date();
    if (hour !== undefined) {
      target.setDate(target.getDate() + 1); // tomorrow
      target.setHours(hour, 0, 0, 0);
    } else {
      target.setMinutes(target.getMinutes() + offsetMinutes);
    }
    const isoString = target.toISOString().slice(0, 16);
    setScheduledDateTime(isoString);
  };

  const handleSendOrSchedule = async () => {
    let finalEmails = [...recipientList];
    if (toInput.trim().includes('@')) {
      finalEmails = Array.from(new Set([...finalEmails, toInput.trim()]));
    }

    if (finalEmails.length === 0) {
      error('Please specify at least one recipient email address');
      return;
    }

    if (!subject.trim()) {
      error('Please enter an email subject');
      return;
    }

    if (!body.trim()) {
      error('Please write an email message');
      return;
    }

    try {
      setLoading(true);
      const targetTime = scheduledDateTime ? new Date(scheduledDateTime).toISOString() : new Date().toISOString();

      await emailApi.schedule({
        emails: finalEmails,
        subject,
        body: `<div style="font-family: sans-serif; line-height: 1.6;">${body.replace(/\n/g, '<br/>')}</div>`,
        startTime: targetTime,
        delayBetweenMs: delayBetweenSeconds * 1000,
        hourlyLimit,
        senderId: selectedSenderId,
      });

      success(`Scheduled ${finalEmails.length} email(s) successfully!`);
      onSuccess();
      onClose();
    } catch (err: any) {
      error(err.response?.data?.error || 'Failed to schedule emails');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden my-6">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-slate-800">
              Compose New Email
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Send Later Popover Trigger */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSendLater(!showSendLater)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                  scheduledDateTime
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                    : 'border-slate-300 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <Clock className="w-4 h-4 text-emerald-600" />
                <span>
                  {scheduledDateTime
                    ? `Send at ${new Date(scheduledDateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'Schedule Later'}
                </span>
              </button>

              {/* Popover */}
              {showSendLater && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 p-4 z-20 animate-in fade-in zoom-in-95">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                    Pick date & time
                  </h4>
                  <input
                    type="datetime-local"
                    value={scheduledDateTime}
                    onChange={(e) => setScheduledDateTime(e.target.value)}
                    className="w-full text-xs p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-3"
                  />

                  <div className="space-y-1 mb-3">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase">
                      Quick Presets
                    </p>
                    <button
                      type="button"
                      onClick={() => applyPreset(1)}
                      className="w-full text-left text-xs py-1 px-2 rounded hover:bg-slate-100 text-slate-700"
                    >
                      In 1 Minute (For testing)
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset(0, 10)}
                      className="w-full text-left text-xs py-1 px-2 rounded hover:bg-slate-100 text-slate-700"
                    >
                      Tomorrow, 10:00 AM
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset(0, 15)}
                      className="w-full text-left text-xs py-1 px-2 rounded hover:bg-slate-100 text-slate-700"
                    >
                      Tomorrow, 3:00 PM
                    </button>
                  </div>

                  <div className="flex justify-end gap-2 border-t pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setScheduledDateTime('');
                        setShowSendLater(false);
                      }}
                      className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1"
                    >
                      Clear
                    </button>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => setShowSendLater(false)}
                    >
                      Done
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <Button
              variant="primary"
              onClick={handleSendOrSchedule}
              loading={loading}
              icon={<Send className="w-4 h-4" />}
            >
              {scheduledDateTime ? 'Schedule Email' : 'Send Now'}
            </Button>
          </div>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-4">
          {/* From Selector */}
          <div className="flex items-center gap-3">
            <label className="w-16 text-xs font-semibold text-slate-500">
              From
            </label>
            <select
              value={selectedSenderId}
              onChange={(e) => setSelectedSenderId(e.target.value)}
              className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.email})
                </option>
              ))}
            </select>
          </div>

          {/* To Field with CSV upload */}
          <div className="flex items-start gap-3">
            <label className="w-16 text-xs font-semibold text-slate-500 pt-2">
              To
            </label>
            <div className="flex-1 border border-slate-200 rounded-xl p-2 bg-white focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500 transition-all">
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                {recipientList.map((rec) => (
                  <span
                    key={rec}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200"
                  >
                    <span>{rec}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveRecipient(rec)}
                      className="hover:text-rose-600"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={toInput}
                  onChange={(e) => setToInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      handleAddRecipient(toInput);
                    }
                  }}
                  onBlur={() => {
                    if (toInput.trim()) handleAddRecipient(toInput);
                  }}
                  placeholder={
                    recipientList.length === 0
                      ? 'recipient@example.com (comma separated or enter)'
                      : 'Add more recipients...'
                  }
                  className="flex-1 text-sm border-none focus:outline-none px-1 text-slate-800"
                />

                <label className="cursor-pointer inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg px-2.5 py-1 transition-colors">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload CSV</span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Subject Field */}
          <div className="flex items-center gap-3">
            <label className="w-16 text-xs font-semibold text-slate-500">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject..."
              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Inline Throttling Settings: Delay & Hourly Limit */}
          <div className="flex items-center gap-6 py-2 px-3 bg-slate-50 rounded-xl border border-slate-100">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-600">
                Delay between 2 emails:
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  max="3600"
                  value={delayBetweenSeconds}
                  onChange={(e) => setDelayBetweenSeconds(Number(e.target.value))}
                  className="w-14 text-center text-xs font-bold border border-slate-300 rounded-lg py-1 text-slate-800 bg-white"
                />
                <span className="text-xs text-slate-500">sec</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-600">
                Hourly Limit:
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(Number(e.target.value))}
                  className="w-16 text-center text-xs font-bold border border-slate-300 rounded-lg py-1 text-slate-800 bg-white"
                />
                <span className="text-xs text-slate-500">/hr</span>
              </div>
            </div>
          </div>

          {/* Editor Toolbar */}
          <div className="border border-slate-200 rounded-xl overflow-hidden focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-100 transition-all">
            <div className="flex items-center gap-1 p-2 bg-slate-50/80 border-b border-slate-200 text-slate-600">
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-200/70"
                title="Undo"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-200/70"
                title="Redo"
              >
                <Redo2 className="w-4 h-4" />
              </button>
              <div className="h-4 w-px bg-slate-300 mx-1" />
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-200/70"
                title="Bold"
              >
                <Bold className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-200/70"
                title="Italic"
              >
                <Italic className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-200/70"
                title="Underline"
              >
                <Underline className="w-4 h-4" />
              </button>
              <div className="h-4 w-px bg-slate-300 mx-1" />
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-200/70"
                title="List"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-200/70"
                title="Quote"
              >
                <Quote className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="p-1 rounded hover:bg-slate-200/70"
                title="Code"
              >
                <Code className="w-4 h-4" />
              </button>
            </div>

            <textarea
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type Your Reply..."
              className="w-full p-4 text-sm text-slate-800 placeholder-slate-400 focus:outline-none resize-none leading-relaxed"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

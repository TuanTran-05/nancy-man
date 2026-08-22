import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, Loader2, Mail, Phone, Shield, User, UserPlus, X } from 'lucide-react';
import { LEVEL_GRADE_RANGES } from '../../types';
import { useLanguage } from '../../lib/i18n/useLanguage';
import {
  isValidVNPhone,
  normalizePhoneVN,
  sendStaffCredentialsNotification,
} from '../../lib/zalo/zaloService';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { apiRequest } from '../../lib/api/apiClient';
import { ModalPortal } from '../common/ModalPortal';
import { translations } from '../../lib/i18n/translations';

interface CreateStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialName?: string;
  initialRole?: 'teacher' | 'accounting' | 'office';
  onSuccess?: () => void;
}

type StaffRole = 'teacher' | 'accounting' | 'office';

export function CreateStaffModal({
  isOpen,
  onClose,
  initialName = '',
  initialRole = 'teacher',
}: CreateStaffModalProps) {
  useBodyScrollLock(isOpen);
  const { language, t } = useLanguage();

  const [emailPrefix, setEmailPrefix] = useState('');
  const [displayName, setDisplayName] = useState(initialName);
  const [role, setRole] = useState<StaffRole>(initialRole);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const [zaloSending, setZaloSending] = useState(false);
  const [zaloResult, setZaloResult] = useState<{ success: boolean; error?: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEmailPrefix('');
    setDisplayName(initialName);
    setRole(initialRole);
    setPhone('');
    setLoading(false);
    setError('');
    setSuccess('');
    setGeneratedPassword('');
    setCopied(false);
    setZaloSending(false);
    setZaloResult(null);
  }, [isOpen, initialName, initialRole]);

  if (!isOpen) return null;

  const emailSuffix =
    role === 'accounting'
      ? '.accounting@nancy.com'
      : role === 'office'
        ? '.office@nancy.com'
        : '.teacher@nancy.com';
  const fullEmail = `${emailPrefix.trim().toLowerCase()}${emailSuffix}`;
  const emailExistsMessage = t.createStaffModal.emailExists;
  const accountCreated = Boolean(success && generatedPassword);
  const labels = {
    title: t.createStaffModal.title,
    create: t.createStaffModal.createAccount,
    creating: t.createStaffModal.creating,
    cancel: t.common.cancel,
    name: t.createStaffModal.fullName,
    email: 'Email',
    role: t.createStaffModal.role,
    phone: t.createStaffModal.zaloPhone,
    copied: t.createStaffModal.copied,
  };
  const roleOptions: Array<{
    value: StaffRole;
    label: string;
    description: string;
    Icon: typeof User;
  }> = [
    {
      value: 'teacher',
      label: t.createStaffModal.roleTeacher,
      description: t.createStaffModal.roleTeacherDesc,
      Icon: User,
    },
    {
      value: 'accounting',
      label: t.createStaffModal.roleAccounting,
      description: t.createStaffModal.roleAccountingDesc,
      Icon: Shield,
    },
    {
      value: 'office',
      label: t.createStaffModal.roleOffice,
      description: t.createStaffModal.roleOfficeDesc,
      Icon: Shield,
    },
  ];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (accountCreated || loading) return;
    if (!emailPrefix.trim()) return;
    if (phone.trim() && !isValidVNPhone(phone.trim())) {
      setError(t.createStaffModal.invalidPhone);
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    setGeneratedPassword('');
    setZaloResult(null);

    try {
      const normalizedPhone = phone.trim() ? normalizePhoneVN(phone.trim()) : '';
      const result = await apiRequest<{
        uid: string;
        email: string;
        retrievalToken: string;
        authCreated: boolean;
        zaloSent?: boolean;
        zaloError?: string;
      }>('/api/v1/auth/staff-create-account', {
        method: 'POST',
        body: {
          emailPrefix: emailPrefix.trim(),
          displayName: displayName.trim() || emailPrefix.trim(),
          role,
          phone: normalizedPhone || undefined,
        },
      });

      if (result.authCreated && result.retrievalToken) {
        // Securely retrieve the temporary password exactly once (Finding #1)
        try {
          const retrieveResult = await apiRequest<{
            success: boolean;
            tempPassword: string;
          }>('/api/v1/auth/retrieve-temp-password', {
            method: 'POST',
            body: { token: result.retrievalToken },
          });

          if (retrieveResult.success && retrieveResult.tempPassword) {
            setGeneratedPassword(retrieveResult.tempPassword);
            setSuccess(t.createStaffModal.createSuccess);
          } else {
            setError('Failed to retrieve temporary password securely.');
          }
        } catch (retrieveErr: any) {
          setError(retrieveErr?.message || 'Error retrieving password.');
        }

        // Display Zalo OA notification outcome sent securely by the server (Finding #7 / #20)
        if (result.zaloSent) {
          setZaloResult({ success: true });
        } else if (result.zaloError) {
          setZaloResult({ success: false, error: result.zaloError });
        }
      } else {
        setError(emailExistsMessage);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error creating staff:', err);
      if (
        (err as { data?: { errorCode?: string } } | null)?.data?.errorCode ===
        'email_already_exists'
      ) {
        setError(emailExistsMessage);
      } else {
        setError(err instanceof Error ? err.message : 'Error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  const copyPassword = async () => {
    if (!generatedPassword) return;
    await navigator.clipboard.writeText(generatedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          className="relative max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-hidden rounded-[1.75rem] bg-white shadow-2xl"
        >
          <button
            type="button"
            aria-label={t.common.close}
            onClick={onClose}
            className="absolute right-5 top-5 z-10 rounded-full border border-blue-100 bg-white/80 p-2 text-slate-500 transition hover:bg-white hover:text-slate-800"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="border-b border-slate-200 bg-gradient-to-br from-blue-50 via-white to-slate-50 px-6 py-6 sm:px-7">
            <div className="flex items-center gap-4 pr-10">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
                <UserPlus className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-normal text-blue-600">
                  {t.createStaffModal.newStaff}
                </p>
                <h2 className="mt-1 text-2xl font-bold text-slate-900">{labels.title}</h2>
                <p className="mt-1 truncate text-sm text-slate-500">{fullEmail}</p>
              </div>
            </div>
          </div>

          <form
            onSubmit={handleCreate}
            className="max-h-[calc(100vh-9.5rem)] space-y-5 overflow-y-auto px-6 py-6 sm:px-7"
          >
            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
                <Shield className="h-4 w-4 text-blue-600" />
                {labels.role}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {roleOptions.map((option) => {
                  const selected = role === option.value;
                  const RoleIcon = option.Icon;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      disabled={accountCreated}
                      onClick={() => setRole(option.value)}
                      className={`min-h-[112px] rounded-2xl border p-3 text-left transition ${
                        selected
                          ? 'border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-200'
                          : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50'
                      } disabled:cursor-not-allowed disabled:opacity-70`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span
                          className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                            selected ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <RoleIcon className="h-4 w-4" />
                        </span>
                        {selected && (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </span>
                      <span className="mt-3 block text-sm font-bold text-slate-900">
                        {option.label}
                      </span>
                      <span className="mt-1 block text-xs leading-4 text-slate-500">
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <Mail className="h-4 w-4 text-blue-600" />
                {t.createStaffModal.loginEmail}
              </div>
              <label className="block">
                <span className="sr-only">{labels.email}</span>
                <div className="flex min-h-12 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 transition focus-within:border-blue-400 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100">
                  <input
                    aria-label={labels.email}
                    value={emailPrefix}
                    onChange={(e) => setEmailPrefix(e.target.value)}
                    disabled={accountCreated}
                    className="min-w-0 flex-1 bg-transparent px-4 py-3 text-slate-900 outline-none disabled:cursor-not-allowed disabled:text-slate-500"
                    placeholder="nguyenvana"
                    required
                  />
                  <span className="flex shrink-0 items-center border-l border-slate-200 bg-slate-100 px-3 text-sm text-slate-500">
                    {emailSuffix}
                  </span>
                </div>
              </label>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <User className="h-4 w-4 text-blue-600" />
                {t.createStaffModal.staffDetails}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-600">
                    {labels.name}
                  </span>
                  <input
                    aria-label={labels.name}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    disabled={accountCreated}
                    className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:text-slate-500"
                    required
                  />
                </label>

                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-600">
                    <Phone className="h-4 w-4" />
                    {labels.phone}
                  </span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={accountCreated}
                    className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:text-slate-500"
                    placeholder="09..."
                  />
                </label>
              </div>
            </section>

            {error && (
              <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            {success && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                    <Check className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{success}</p>
                    {generatedPassword && (
                      <button
                        type="button"
                        onClick={copyPassword}
                        className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 font-mono text-slate-900 transition hover:border-emerald-300"
                      >
                        <span className="truncate">{generatedPassword}</span>
                        <span className="flex shrink-0 items-center gap-1 text-xs font-sans font-semibold text-emerald-700">
                          {copied ? labels.copied : t.createStaffModal.copy}
                          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </span>
                      </button>
                    )}
                    {zaloSending && (
                      <p className="mt-2 text-xs text-emerald-700">
                        {t.createStaffModal.sendingZalo}
                      </p>
                    )}
                    {zaloResult && (
                      <p className="mt-2 text-xs text-emerald-700">
                        {zaloResult.success
                          ? t.createStaffModal.zaloSent
                          : `${t.createStaffModal.zaloFailed}: ${zaloResult.error || ''}`}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
              {accountCreated ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700"
                >
                  <Check className="h-4 w-4" />
                  {t.common.close}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-12 rounded-2xl px-5 py-3 font-semibold text-slate-600 transition hover:bg-slate-100"
                  >
                    {labels.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4" />
                    )}
                    {loading ? labels.creating : labels.create}
                  </button>
                </>
              )}
            </div>
          </form>
        </motion.div>
      </div>
    </ModalPortal>
  );
}

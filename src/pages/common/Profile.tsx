import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { User, Shield, Save, RotateCcw, Camera, Loader2, CheckCircle, Phone } from 'lucide-react';
import { UserProfile } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/core/utils';
import { apiRequest } from '../../lib/api/apiClient';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { translations } from '../../lib/i18n/translations';
import { ProfilePhoneOtpModal } from '../../components/auth/ProfilePhoneOtpModal';
import { canManageProfilePhone, displayVNPhone } from './profilePhone';
import { isValidVNPhone } from '../../../shared/phone';
import { ZaloBotLinkCard } from '../../components/zalo/ZaloBotLinkCard';

interface ProfileProps {
  profile: UserProfile | null;
}

export default function Profile({ profile: initialProfile }: ProfileProps) {
  const { user, profile: authProfile, updateProfileState } = useAuth();
  const currentProfile = initialProfile || authProfile;

  const [formData, setFormData] = useState({
    fullName: currentProfile?.displayName || '',
    email: currentProfile?.email || user?.email || '',
    bio: currentProfile?.bio || '',
    darkMode: localStorage.getItem('theme') === 'dark',
    faceImage: currentProfile?.faceImage || '',
  });

  const { language, setLanguage } = useLanguage();

  const [activeTab, setActiveTab] = useState<'personal' | 'security' | 'notifications'>('personal');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const [phoneStep, setPhoneStep] = useState<'input' | 'otp' | 'verified'>('input');
  const [phoneNewValue, setPhoneNewValue] = useState('');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [isProcessingPhone, setIsProcessingPhone] = useState(false);
  const [phoneResendTimer, setPhoneResendTimer] = useState(0);

  // Sync state if profile changes from parent
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      fullName: currentProfile?.displayName || prev.fullName,
      email: currentProfile?.email || user?.email || prev.email,
      bio: currentProfile?.bio || prev.bio,
      faceImage: currentProfile?.faceImage || prev.faceImage,
    }));
  }, [currentProfile, user]);

  // Change theme only when toggle changes
  useEffect(() => {
    if (formData.darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [formData.darkMode]);

  useEffect(() => {
    if (!phoneModalOpen || phoneResendTimer <= 0) return;
    const timer = window.setInterval(() => {
      setPhoneResendTimer((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phoneModalOpen, phoneResendTimer]);

  const handleDiscard = () => {
    setFormData({
      fullName: currentProfile?.displayName || '',
      email: currentProfile?.email || user?.email || '',
      bio: currentProfile?.bio || '',
      darkMode: localStorage.getItem('theme') === 'dark',
      faceImage: currentProfile?.faceImage || '',
    });
  };

  const canManagePhone = canManageProfilePhone(currentProfile?.role);
  const currentPhoneDisplay = displayVNPhone(currentProfile?.phone);
  const phoneModalMode: 'add' | 'change' = currentProfile?.phone ? 'change' : 'add';

  const resetPhoneModal = () => {
    setPhoneModalOpen(false);
    setPhoneStep('input');
    setPhoneNewValue('');
    setPhoneOtp('');
    setPhoneError(null);
    setIsProcessingPhone(false);
    setPhoneResendTimer(0);
  };

  const openPhoneModal = () => {
    setPhoneStep('input');
    setPhoneNewValue('');
    setPhoneOtp('');
    setPhoneError(null);
    setPhoneResendTimer(0);
    setPhoneModalOpen(true);
  };

  const requestPhoneOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!isValidVNPhone(phoneNewValue)) {
      setPhoneError(t.invalidPhone);
      return;
    }
    setIsProcessingPhone(true);
    setPhoneError(null);
    try {
      await apiRequest('/api/v1/auth/request-profile-phone-otp', {
        method: 'POST',
        body: { phone: phoneNewValue.trim() },
      });
      setPhoneStep('otp');
      setPhoneOtp('');
      setPhoneResendTimer(60);
    } catch (err: any) {
      setPhoneError(err?.message || t.saveError);
    } finally {
      setIsProcessingPhone(false);
    }
  };

  const verifyPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessingPhone(true);
    setPhoneError(null);
    try {
      await apiRequest('/api/v1/auth/verify-profile-phone-otp', {
        method: 'POST',
        body: { otp: phoneOtp },
      });
      setPhoneStep('verified');
    } catch (err: any) {
      setPhoneError(err?.message || t.saveError);
    } finally {
      setIsProcessingPhone(false);
    }
  };

  const confirmPhoneChange = async () => {
    setIsProcessingPhone(true);
    setPhoneError(null);
    try {
      const confirmation = await apiRequest<{ success: boolean; phone?: string }>(
        '/api/v1/auth/confirm-profile-phone-change',
        { method: 'POST' }
      );
      // The server stores a canonical form, so the typed value is not
      // authoritative once the transaction has committed.
      updateProfileState?.({ phone: confirmation?.phone || phoneNewValue.trim() });
      resetPhoneModal();
      setSaveStatus({ type: 'success', message: t.profilePhoneUpdated });
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err: any) {
      setPhoneError(err?.message || t.saveError);
    } finally {
      setIsProcessingPhone(false);
    }
  };

  const handleSave = async () => {
    if (!user || !currentProfile) return;
    setIsSaving(true);
    setSaveStatus(null);
    try {
      await apiRequest('/api/v1/students/update-profile', {
        method: 'POST',
        body: {
          displayName: formData.fullName,
          faceImage: formData.faceImage,
          bio: formData.bio,
        },
      });

      updateProfileState?.({
        displayName: formData.fullName,
        faceImage: formData.faceImage,
        bio: formData.bio,
      });

      setSaveStatus({ type: 'success', message: t.saveSuccess });
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (error) {
      console.error('Error saving profile:', error);
      setSaveStatus({ type: 'error', message: t.saveError });
    } finally {
      setIsSaving(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith('image/')) {
      setSaveStatus({ type: 'error', message: t.uploadError });
      return;
    }

    // Validate size (e.g. max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setSaveStatus({ type: 'error', message: t.imageSizeLimit });
      return;
    }

    setIsUploading(true);
    setSaveStatus(null);
    try {
      const uploadData = new FormData();
      uploadData.append('file', file);
      const response = await fetch('/api/v1/knowledge-bank/upload-profile-image', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: uploadData,
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Upload failed');
      }
      setFormData((prev) => ({ ...prev, faceImage: data.url }));
      setSaveStatus({ type: 'success', message: t.uploadSuccess });
    } catch (error) {
      console.error('Error uploading image:', error);
      setSaveStatus({ type: 'error', message: t.uploadError });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleLinkGoogle = async () => {
    if (!user) return;
    setIsSaving(true);
    setSaveStatus(null);
    try {
      const response = await apiRequest<{ authorizationUrl: string }>(
        '/api/v1/auth/google-link-start',
        {
          method: 'POST',
          body: { returnTo: window.location.pathname },
        }
      );
      if (!response.authorizationUrl) throw new Error('Missing authorization URL');
      window.location.assign(response.authorizationUrl);
    } catch (err: any) {
      console.error('Link error', err);
      if (err.code === 'auth/credential-already-in-use') {
        setSaveStatus({
          type: 'error',
          message: t.linkGoogleAlreadyLinked,
        });
      } else {
        setSaveStatus({
          type: 'error',
          message: t.errorPrefix + err.message,
        });
      }
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveStatus(null), 5000);
    }
  };

  const neumorphicCard =
    'bg-[#f2f5f9] dark:bg-slate-800 rounded-[2rem] shadow-[8px_8px_16px_#d1d9e6,-8px_-8px_16px_#ffffff] dark:shadow-[8px_8px_16px_#0f172a,-8px_-8px_16px_#334155]';
  const neumorphicInput =
    'bg-[#f2f5f9] dark:bg-slate-800 rounded-2xl shadow-[inset_4px_4px_8px_#d1d9e6,inset_-4px_-4px_8px_#ffffff] dark:shadow-[inset_4px_4px_8px_#0f172a,inset_-4px_-4px_8px_#334155] border-none focus:ring-0 px-6 py-4 transition-all w-full text-slate-800 dark:text-slate-100';
  const neumorphicButton =
    'bg-[#f2f5f9] dark:bg-slate-800 rounded-2xl shadow-[6px_6px_12px_#d1d9e6,-6px_-6px_12px_#ffffff] dark:shadow-[6px_6px_12px_#0f172a,-6px_-6px_12px_#334155] active:shadow-[inset_4px_4px_8px_#d1d9e6,inset_-4px_-4px_8px_#ffffff] dark:active:shadow-[inset_4px_4px_8px_#0f172a,inset_-4px_-4px_8px_#334155] transition-all';
  const neumorphicButtonPrimary =
    'bg-blue-600 text-white rounded-full shadow-[6px_6px_12px_rgba(79,70,229,0.3),-6px_-6px_12px_#ffffff] dark:shadow-[6px_6px_12px_rgba(79,70,229,0.3),-6px_-6px_12px_#0f172a] hover:bg-blue-700 active:shadow-inner disabled:opacity-50 transition-all cursor-pointer';

  const t = translations[language].profile;

  return (
    <>
      <div className="max-w-6xl mx-auto space-y-8 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column - Sidebar */}
          <div className="lg:col-span-4 space-y-8">
            {/* Profile Basic Card */}
            <div className={cn(neumorphicCard, 'p-8 flex flex-col items-center text-center')}>
              <div
                className="relative mb-6 group cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-32 h-32 rounded-full bg-[#fff] p-2 shadow-lg relative z-10 transition-transform group-hover:scale-105 dark:bg-slate-700">
                  <div className="w-full h-full rounded-full overflow-hidden border-4 border-blue-600 relative">
                    {isUploading ? (
                      <div className="w-full h-full bg-slate-200/50 flex flex-col items-center justify-center">
                        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                      </div>
                    ) : formData.faceImage ? (
                      <img
                        src={formData.faceImage}
                        alt="Avatar"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-slate-200 flex items-center justify-center text-3xl font-bold text-slate-400">
                        {formData.fullName[0]?.toUpperCase() || 'U'}
                      </div>
                    )}
                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera className="w-6 h-6 text-white mb-1" />
                      <span className="text-white text-xs font-semibold">{t.upload}</span>
                    </div>
                  </div>
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageUpload}
                />
                <button
                  type="button"
                  className="absolute bottom-0 right-0 p-2 bg-[#fff] rounded-full shadow-md text-blue-600 hover:scale-110 transition-transform z-20 dark:bg-slate-700 dark:text-blue-300"
                >
                  <Camera className="w-4 h-4" />
                </button>
                <div className="absolute top-2 right-2 w-4 h-4 bg-green-500 border-2 border-[#fff] rounded-full z-20 dark:border-slate-700" />
              </div>

              <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-1">
                {formData.fullName}
              </h2>
              <p className="text-slate-500 font-medium mb-2">
                {currentProfile?.role === 'admin'
                  ? t.admin
                  : currentProfile?.role === 'teacher'
                    ? t.teacher
                    : currentProfile?.role === 'parent'
                      ? t.parent
                      : currentProfile?.role === 'student'
                        ? t.student
                        : currentProfile?.role === 'accounting'
                          ? t.accounting
                          : currentProfile?.role === 'office'
                            ? t.office
                            : t.user}
              </p>
            </div>

            {/* Navigation Card */}
            <div className={cn(neumorphicCard, 'p-4')}>
              <nav className="space-y-2">
                {[
                  { id: 'personal', label: t.personalInfo, icon: User },
                  { id: 'security', label: t.securityTab, icon: Shield },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={cn(
                      'w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all duration-300',
                      activeTab === tab.id
                        ? 'shadow-[inset_4px_4px_8px_#d1d9e6,inset_-4px_-4px_8px_#ffffff] dark:shadow-[inset_4px_4px_8px_#0f172a,inset_-4px_-4px_8px_#334155] text-blue-600 dark:text-blue-400'
                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                    )}
                  >
                    <div
                      className={cn(
                        'p-2 rounded-xl',
                        activeTab === tab.id
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-200 dark:shadow-blue-900/50'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                      )}
                    >
                      <tab.icon className="w-4 h-4" />
                    </div>
                    <span className="font-bold">{tab.label}</span>
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Right Column - Main Content */}
          <div className="lg:col-span-8 space-y-8">
            <div className={cn(neumorphicCard, 'p-10')}>
              {activeTab === 'personal' && (
                <>
                  <div className="mb-10">
                    <h2 className="text-3xl font-bold text-slate-800 dark:text-white mb-2">
                      {t.accountSettings}
                    </h2>
                    <p className="text-slate-400 font-medium">{t.manageInfo}</p>
                  </div>

                  <div className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-3">
                        <label
                          htmlFor="profile-fullname"
                          className="text-sm font-bold text-slate-800 dark:text-slate-200 ml-1 uppercase tracking-wider"
                        >
                          {t.fullName}
                        </label>
                        <input
                          id="profile-fullname"
                          type="text"
                          value={formData.fullName}
                          onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                          className={neumorphicInput}
                          placeholder="Nguyễn Văn A"
                        />
                      </div>
                      <div className="space-y-3">
                        <label
                          htmlFor="profile-email"
                          className="text-sm font-bold text-slate-800 dark:text-slate-200 ml-1 uppercase tracking-wider"
                        >
                          {t.email}
                        </label>
                        <input
                          id="profile-email"
                          type="email"
                          value={formData.email}
                          readOnly
                          className={cn(neumorphicInput, 'cursor-not-allowed opacity-75')}
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-sm font-bold text-slate-800 dark:text-slate-200 ml-1 uppercase tracking-wider">
                        {t.bio}
                      </label>
                      <textarea
                        rows={4}
                        value={formData.bio}
                        onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                        className={cn(neumorphicInput, 'resize-none')}
                        placeholder={t.bioPlaceholder}
                      />
                    </div>

                    <div>
                      <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-6 uppercase tracking-wider">
                        {t.customization}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div
                          className={cn(
                            neumorphicCard,
                            'px-6 py-4 flex items-center justify-between'
                          )}
                        >
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {t.darkMode}
                          </span>
                          <button
                            onClick={() =>
                              setFormData({ ...formData, darkMode: !formData.darkMode })
                            }
                            className={cn(
                              'w-12 h-6 rounded-full transition-all relative p-1',
                              formData.darkMode ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'
                            )}
                          >
                            <div
                              className={cn(
                                'w-4 h-4 bg-[#fff] rounded-full transition-all dark:bg-white',
                                formData.darkMode ? 'translate-x-6' : 'translate-x-0'
                              )}
                            />
                          </button>
                        </div>

                        <div
                          className={cn(
                            neumorphicCard,
                            'px-6 py-4 flex items-center justify-between'
                          )}
                        >
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {t.language}
                          </span>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setLanguage(language === 'vi' ? 'en' : 'vi')}
                              className={cn(
                                'w-14 h-6 rounded-full transition-all relative p-1 bg-slate-200 dark:bg-slate-600 border border-slate-300 dark:border-slate-500'
                              )}
                            >
                              <div
                                className={cn(
                                  'w-6 h-4 bg-white rounded-full transition-all shadow-sm flex items-center justify-center',
                                  language === 'vi'
                                    ? 'translate-x-0 text-[10px] font-bold text-red-600'
                                    : 'translate-x-6 text-[10px] font-bold text-blue-600'
                                )}
                              >
                                {language === 'vi' ? 'VI' : 'EN'}
                              </div>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      className={cn(
                        neumorphicCard,
                        'px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-8'
                      )}
                    >
                      <div>
                        <h3 className="font-bold text-slate-800 dark:text-slate-200">
                          {t.linkGoogle}
                        </h3>
                        <p className="text-sm text-slate-500 mt-1">{t.linkGoogleDesc}</p>
                      </div>
                      {user?.providerData.some((p) => p.providerId === 'google.com') ? (
                        <div className="flex items-center px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl font-bold text-sm">
                          <CheckCircle className="w-4 h-4 mr-2" />
                          {t.linked}
                        </div>
                      ) : (
                        <button
                          onClick={handleLinkGoogle}
                          disabled={isSaving}
                          className={cn(
                            neumorphicButtonPrimary,
                            'px-6 py-3 font-bold text-sm flex items-center justify-center min-w-[160px] bg-red-600 hover:bg-red-700 shadow-red-500/30'
                          )}
                        >
                          {isSaving ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <img
                              src="https://www.google.com/favicon.ico"
                              alt="Google"
                              className="w-4 h-4 mr-2"
                            />
                          )}
                          {t.linkNow}
                        </button>
                      )}
                    </div>

                    {saveStatus && (
                      <div
                        className={cn(
                          'p-4 rounded-xl text-sm font-semibold flex items-center gap-2',
                          saveStatus.type === 'success'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-red-100 text-red-700'
                        )}
                      >
                        {saveStatus.type === 'success' ? (
                          <CheckCircle className="w-5 h-5" />
                        ) : (
                          <RotateCcw className="w-5 h-5" />
                        )}
                        {saveStatus.message}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-4 pt-6">
                      <button
                        onClick={handleSave}
                        disabled={isSaving || isUploading}
                        className={cn(
                          neumorphicButtonPrimary,
                          'px-10 py-5 font-bold uppercase tracking-wider text-sm flex items-center gap-2'
                        )}
                      >
                        {isSaving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        {t.saveChanges}
                      </button>
                      <button
                        onClick={handleDiscard}
                        disabled={isSaving || isUploading}
                        className={cn(
                          neumorphicButton,
                          'bg-[#f2f5f9] dark:bg-slate-800 px-10 py-5 font-bold uppercase tracking-wider text-sm text-slate-400 dark:text-slate-300 hover:text-slate-600 dark:hover:text-white flex items-center gap-2 disabled:opacity-50 cursor-pointer'
                        )}
                      >
                        <RotateCcw className="w-4 h-4" /> {t.discard}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'security' && (
                <>
                  <div className="mb-10">
                    <h2 className="text-3xl font-bold text-slate-800 dark:text-white mb-2">
                      {t.security}
                    </h2>
                    <p className="text-slate-400 font-medium">{t.securityDesc}</p>
                  </div>
                  <div className="space-y-8">
                    <div
                      className={cn(
                        neumorphicCard,
                        'p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4'
                      )}
                    >
                      <div>
                        <h3 className="font-bold text-slate-800 dark:text-slate-200">
                          {t.loginPassword}
                        </h3>
                        <p className="text-sm text-slate-500 mt-1">{t.loginPasswordDesc}</p>
                      </div>
                      <button
                        onClick={() =>
                          document.dispatchEvent(new CustomEvent('open-change-password'))
                        }
                        className={cn(
                          neumorphicButtonPrimary,
                          'px-6 py-3 font-bold text-sm flex items-center justify-center min-w-[160px]'
                        )}
                      >
                        <Shield className="w-4 h-4 mr-2" /> {t.changePassword}
                      </button>
                    </div>

                    {canManagePhone && (
                      <div
                        className={cn(
                          neumorphicCard,
                          'p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4'
                        )}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Phone className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            <h3 className="font-bold text-slate-800 dark:text-slate-200">
                              {t.zaloPhoneTitle}
                            </h3>
                          </div>
                          <p className="text-sm text-slate-500">{t.zaloPhoneDesc}</p>
                          {currentPhoneDisplay ? (
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                              {t.currentPhone}: <span>{currentPhoneDisplay}</span>
                            </p>
                          ) : (
                            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
                              {t.missingZaloPhoneWarning}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={openPhoneModal}
                          disabled={isSaving || isUploading}
                          className={cn(
                            neumorphicButtonPrimary,
                            'px-6 py-3 font-bold text-sm flex items-center justify-center min-w-[180px]'
                          )}
                        >
                          <Phone className="w-4 h-4 mr-2" />
                          {currentPhoneDisplay ? t.changePhoneNumber : t.addPhoneNumber}
                        </button>
                      </div>
                    )}

                    <ZaloBotLinkCard role={currentProfile?.role} />

                    <div
                      className={cn(
                        neumorphicCard,
                        'p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4'
                      )}
                    >
                      <div>
                        <h3 className="font-bold text-slate-800 dark:text-slate-200">
                          {t.linkGoogle}
                        </h3>
                        <p className="text-sm text-slate-500 mt-1">{t.linkGoogleDesc}</p>
                      </div>
                      {user?.providerData.some((p) => p.providerId === 'google.com') ? (
                        <div className="flex items-center px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl font-bold text-sm">
                          <CheckCircle className="w-4 h-4 mr-2" />
                          {t.linked}
                        </div>
                      ) : (
                        <button
                          onClick={handleLinkGoogle}
                          disabled={isSaving}
                          className={cn(
                            neumorphicButtonPrimary,
                            'px-6 py-3 font-bold text-sm flex items-center justify-center min-w-[160px] bg-red-600 hover:bg-red-700 shadow-red-500/30'
                          )}
                        >
                          {isSaving ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <img
                              src="https://www.google.com/favicon.ico"
                              alt="Google"
                              className="w-4 h-4 mr-2"
                            />
                          )}
                          {t.linkNow}
                        </button>
                      )}
                    </div>

                    {saveStatus && (
                      <div
                        className={cn(
                          'p-4 rounded-xl text-sm font-semibold flex items-center gap-2',
                          saveStatus.type === 'success'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-red-100 text-red-700'
                        )}
                      >
                        {saveStatus.type === 'success' ? (
                          <CheckCircle className="w-5 h-5" />
                        ) : (
                          <RotateCcw className="w-5 h-5" />
                        )}
                        {saveStatus.message}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <ProfilePhoneOtpModal
        isOpen={phoneModalOpen}
        mode={phoneModalMode}
        step={phoneStep}
        email={formData.email}
        currentPhoneDisplay={currentPhoneDisplay}
        newPhone={phoneNewValue}
        otp={phoneOtp}
        error={phoneError}
        isProcessing={isProcessingPhone}
        resendTimer={phoneResendTimer}
        labels={{
          addTitle: t.profilePhoneAddTitle,
          changeTitle: t.profilePhoneChangeTitle,
          accountEmail: t.accountEmail,
          newPhone: t.newPhoneNumber,
          currentPhone: t.currentPhone,
          verifiedNewPhone: t.verifiedNewPhone,
          sendOtp: t.sendOtp,
          verifyOtp: t.verifyOtp,
          confirmChange: t.confirmPhoneChange,
          otpCode: t.otpCode,
          otpSentHint: t.otpSentHint,
          resendOtp: t.resendOtp,
          resendIn: t.resendIn,
          contactAdminHint: t.contactAdminHint,
          verifiedTitle: t.profilePhoneVerified,
          noCurrentPhone: t.noCurrentPhone,
          cancel: t.discard,
        }}
        onClose={resetPhoneModal}
        onNewPhoneChange={setPhoneNewValue}
        onOtpChange={setPhoneOtp}
        onRequestOtp={requestPhoneOtp}
        onVerifyOtp={verifyPhoneOtp}
        onConfirm={confirmPhoneChange}
        onResend={() => requestPhoneOtp()}
      />
    </>
  );
}

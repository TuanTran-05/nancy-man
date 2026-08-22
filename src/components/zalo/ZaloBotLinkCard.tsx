import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Link as LinkIcon, Unlink, Copy, CheckCircle, Info } from 'lucide-react';
import { useLanguage } from '../../lib/i18n/useLanguage';
import { cn } from '../../lib/core/utils';
import {
  getMyZaloBotLink,
  createMyZaloBotLinkCode,
  unlinkMyZaloBotChat,
} from '../../lib/zalo/zaloBotService';

interface ZaloBotLinkCardProps {
  role: string | undefined;
}

export function ZaloBotLinkCard({ role }: ZaloBotLinkCardProps) {
  const { language } = useLanguage();
  const allowedRoles = ['teacher', 'office', 'admin'];

  const [loading, setLoading] = useState(true);
  const [botEnabled, setBotEnabled] = useState(false);
  const [linkData, setLinkData] = useState<any>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [isUnlinking, setIsUnlinking] = useState(false);

  useEffect(() => {
    if (role && allowedRoles.includes(role)) {
      fetchLink();
    }
  }, [role]);

  const fetchLink = async () => {
    try {
      setLoading(true);
      const res = await getMyZaloBotLink();
      setBotEnabled(res.botEnabled);
      setLinkData(res.link);
      if (res.link?.status === 'active') {
        setGeneratedCode(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateCode = async () => {
    try {
      setIsGenerating(true);
      const res = await createMyZaloBotLinkCode();
      setGeneratedCode(res.code);
    } catch (err: any) {
      toast.error(err.message || 'Lỗi tạo mã');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUnlink = async () => {
    if (
      !window.confirm(
        language === 'vi'
          ? 'Bạn có chắc chắn muốn hủy liên kết?'
          : 'Are you sure you want to unlink?'
      )
    )
      return;
    try {
      setIsUnlinking(true);
      await unlinkMyZaloBotChat();
      toast.success(language === 'vi' ? 'Hủy liên kết thành công' : 'Unlinked successfully');
      setGeneratedCode(null);
      await fetchLink();
    } catch (err: any) {
      toast.error(err.message || 'Lỗi hủy liên kết');
    } finally {
      setIsUnlinking(false);
    }
  };

  const copyCode = () => {
    if (generatedCode) {
      navigator.clipboard.writeText(`/link ${generatedCode}`);
      toast.success(language === 'vi' ? 'Đã copy mã' : 'Copied code');
    }
  };

  if (!role || !allowedRoles.includes(role)) return null;

  const neumorphicCard =
    'bg-[#f2f5f9] dark:bg-slate-800 rounded-2xl shadow-[8px_8px_16px_#d1d9e6,-8px_-8px_16px_#ffffff] dark:shadow-[8px_8px_16px_#0f172a,-8px_-8px_16px_#334155] p-6';
  const neumorphicButtonPrimary =
    'bg-blue-600 text-white rounded-full shadow-[6px_6px_12px_rgba(79,70,229,0.3),-6px_-6px_12px_#ffffff] dark:shadow-[6px_6px_12px_rgba(79,70,229,0.3),-6px_-6px_12px_#0f172a] hover:bg-blue-700 active:shadow-inner disabled:opacity-50 transition-all cursor-pointer';

  return (
    <div
      className={cn(
        neumorphicCard,
        'flex flex-col sm:flex-row sm:items-start justify-between gap-4'
      )}
      data-testid="zalo-bot-link-card"
    >
      <div className="space-y-2 flex-1 w-full">
        <div className="flex items-center gap-2">
          <LinkIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h3 className="font-bold text-slate-800 dark:text-slate-200">
            {language === 'vi' ? 'Liên kết Zalo Bot' : 'Zalo Bot Link'}
          </h3>
        </div>
        <p className="text-sm text-slate-500">
          {language === 'vi'
            ? 'Nhận thông báo qua Zalo cá nhân từ EduTrack Bot'
            : 'Receive notifications via personal Zalo from EduTrack Bot'}
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 mt-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {language === 'vi' ? 'Đang tải...' : 'Loading...'}
          </div>
        ) : !botEnabled ? (
          <div className="mt-2 text-sm text-amber-600 bg-amber-50 p-2 rounded-lg flex items-center gap-2">
            <Info className="w-4 h-4" />
            {language === 'vi'
              ? 'Tính năng Zalo Bot đang bị tắt.'
              : 'Zalo Bot feature is disabled.'}
          </div>
        ) : (
          <div className="mt-3">
            {linkData && linkData.status === 'active' ? (
              <div className="space-y-2">
                <div className="flex items-center px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-sm font-medium">
                  <CheckCircle className="w-4 h-4 mr-2" />
                  {language === 'vi'
                    ? `Đã liên kết (${linkData.displayName})`
                    : `Linked (${linkData.displayName})`}
                </div>
                <div className="text-xs text-slate-500 ml-1">
                  {language === 'vi'
                    ? `Phương thức: ${linkData.linkedMethod === 'self' ? 'Tự liên kết' : 'Quản trị viên liên kết'}`
                    : `Method: ${linkData.linkedMethod === 'self' ? 'Self-linked' : 'Admin-linked'}`}
                  <br />
                  {language === 'vi' ? 'Lần cuối:' : 'Last linked:'}{' '}
                  {new Date(linkData.linkedAt).toLocaleString()}
                </div>
              </div>
            ) : linkData && linkData.status === 'needs_relink' ? (
              <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg mb-3">
                {language === 'vi'
                  ? 'Liên kết Zalo Bot của bạn không hợp lệ hoặc đã bị lỗi. Vui lòng tạo mã mới để liên kết lại.'
                  : 'Your Zalo Bot link is invalid or corrupted. Please generate a new code to relink.'}
              </div>
            ) : generatedCode ? (
              <div className="p-4 bg-blue-50 dark:bg-slate-700 rounded-xl space-y-3">
                <p className="text-sm text-slate-700 dark:text-slate-200">
                  {language === 'vi'
                    ? 'Mở bot Zalo → gửi tin nhắn theo cú pháp sau:'
                    : 'Open Zalo Bot → send the following message:'}
                </p>
                <div className="flex items-center gap-2">
                  <code className="px-3 py-2 bg-white dark:bg-slate-800 rounded-lg text-lg font-mono font-bold text-blue-600 flex-1">
                    /link {generatedCode}
                  </code>
                  <button
                    onClick={copyCode}
                    className="p-2 bg-white dark:bg-slate-800 rounded-lg shadow-sm hover:bg-slate-50 text-slate-600"
                    aria-label="Copy code"
                  >
                    <Copy className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {!loading && botEnabled && (
        <div className="shrink-0 flex gap-2 sm:mt-0 mt-4">
          {linkData && linkData.status === 'active' ? (
            <button
              onClick={handleUnlink}
              disabled={isUnlinking}
              className={cn(
                neumorphicButtonPrimary,
                'bg-red-600 hover:bg-red-700 shadow-red-500/30 px-6 py-3 font-bold text-sm flex items-center min-w-[140px] justify-center'
              )}
            >
              {isUnlinking ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Unlink className="w-4 h-4 mr-2" />
              )}
              {language === 'vi' ? 'Hủy liên kết' : 'Unlink'}
            </button>
          ) : !generatedCode ? (
            <button
              onClick={handleGenerateCode}
              disabled={isGenerating}
              className={cn(
                neumorphicButtonPrimary,
                'px-6 py-3 font-bold text-sm flex items-center min-w-[140px] justify-center'
              )}
            >
              {isGenerating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <LinkIcon className="w-4 h-4 mr-2" />
              )}
              {language === 'vi' ? 'Tạo mã liên kết' : 'Generate Code'}
            </button>
          ) : (
            <button
              onClick={fetchLink}
              className="px-6 py-3 text-sm font-bold text-slate-600 hover:text-blue-600"
            >
              {language === 'vi' ? 'Tôi đã gửi tin nhắn' : 'I sent the message'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

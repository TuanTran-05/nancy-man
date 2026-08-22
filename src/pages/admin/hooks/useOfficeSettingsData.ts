import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiRequest } from '../../../lib/api/apiClient';
import { officeHolidaysQueryOptions } from '../../../lib/office/officeReferenceQueries';
import { officeQueryKeys } from '../../../lib/office/officeQueryKeys';
import type { OfficeQueryIdentity } from '../../../lib/office/officeQueryPolicy';
import { translations } from '../../../lib/i18n/translations';

export function useOfficeSettingsData(
  identity: OfficeQueryIdentity,
  language: keyof typeof translations = 'vi'
) {
  const ap = translations[language].adminPage;
  const queryClient = useQueryClient();

  const [newHoliday, setNewHoliday] = useState('');
  const [holidayActionLoading, setHolidayActionLoading] = useState<string | null>(null);

  const holidaysQuery = useQuery(
    officeHolidaysQueryOptions(identity, Boolean(identity.uid && identity.role))
  );

  const holidayDates = holidaysQuery.data || [];

  const handleAddHoliday = useCallback(async () => {
    if (!newHoliday || holidayActionLoading) return;
    if (holidayDates.includes(newHoliday)) {
      toast.error(ap.holidayDuplicate);
      return;
    }
    setHolidayActionLoading('add');
    try {
      await apiRequest('/api/v1/classes/save-settings', {
        method: 'POST',
        body: {
          settingType: 'holidays',
          dates: [...holidayDates, newHoliday].sort(),
        },
      });
      setNewHoliday('');
      toast.success(ap.holidayAddSuccess);
      await queryClient.invalidateQueries({
        queryKey: officeQueryKeys.holidays(identity),
      });
    } catch (err) {
      console.error('Error adding holiday:', err);
      toast.error(ap.holidayAddFailed);
    } finally {
      setHolidayActionLoading(null);
    }
  }, [ap, holidayActionLoading, holidayDates, identity, newHoliday, queryClient]);

  const handleRemoveHoliday = useCallback(
    async (date: string) => {
      if (holidayActionLoading) return;
      setHolidayActionLoading(date);
      try {
        await apiRequest('/api/v1/classes/save-settings', {
          method: 'POST',
          body: {
            settingType: 'holidays',
            dates: holidayDates.filter((d) => d !== date),
          },
        });
        toast.success(ap.holidayDeleteSuccess);
        await queryClient.invalidateQueries({
          queryKey: officeQueryKeys.holidays(identity),
        });
      } catch (err) {
        console.error('Error removing holiday:', err);
        toast.error(ap.holidayDeleteFailed);
      } finally {
        setHolidayActionLoading(null);
      }
    },
    [ap, holidayActionLoading, holidayDates, identity, queryClient]
  );

  return {
    holidayDates,
    newHoliday,
    setNewHoliday,
    holidayActionLoading,
    handleAddHoliday,
    handleRemoveHoliday,
    loading: holidaysQuery.isLoading,
    error: holidaysQuery.error,
  };
}

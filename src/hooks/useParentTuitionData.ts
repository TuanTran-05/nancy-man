import { useCallback, useEffect, useState } from 'react';
import { CourseFeeLedger, Receipt, UserProfile } from '../types';
import { readChannel } from '../lib/api/readApi';
import { useInvalidationRefresh } from './useInvalidationRefresh';

type ParentTuitionResponse = {
  ledgers?: CourseFeeLedger[];
  receipts?: Receipt[];
};

function normalizeError(error: unknown) {
  return error instanceof Error ? error : new Error('Failed to load tuition data');
}

export function useParentTuitionData(profile: UserProfile | null) {
  const studentId = profile?.studentId;
  const [feeLedgers, setFeeLedgers] = useState<CourseFeeLedger[]>([]);
  const [feeReceipts, setFeeReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(() => !!studentId);
  const [error, setError] = useState<Error | null>(null);

  const applyTuitionData = useCallback((data: ParentTuitionResponse) => {
    setFeeLedgers(data.ledgers || []);
    setFeeReceipts((data.receipts || []).filter((receipt) => receipt.status === 'posted'));
  }, []);

  const refresh = useCallback(async () => {
    if (!studentId) {
      setFeeLedgers([]);
      setFeeReceipts([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await readChannel<ParentTuitionResponse>('parent-tuition');
      applyTuitionData(data);
    } catch (err) {
      setError(normalizeError(err));
      setFeeLedgers([]);
      setFeeReceipts([]);
    } finally {
      setLoading(false);
    }
  }, [applyTuitionData, studentId]);

  useInvalidationRefresh({
    channelKey: 'parent-tuition',
    enabled: !!studentId,
    onInvalidate: refresh,
  });

  useEffect(() => {
    let cancelled = false;
    if (!studentId) {
      setFeeLedgers([]);
      setFeeReceipts([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    readChannel<ParentTuitionResponse>('parent-tuition')
      .then((data) => {
        if (cancelled) return;
        applyTuitionData(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(normalizeError(err));
        setFeeLedgers([]);
        setFeeReceipts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyTuitionData, studentId]);

  return { feeLedgers, feeReceipts, loading, error, refresh };
}

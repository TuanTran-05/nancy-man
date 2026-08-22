import { randomInt, randomUUID } from 'node:crypto';
import type { ApiRequest, ApiResponse } from '../../lib/http/types.js';
import { getPostgresPool } from '../../../db/client.js';
import { hashSecret, verifySecret } from '../../lib/student/studentPassword.js';
import { normalizePhoneVN } from '../../../../shared/phone.js';
import { createLookupToken, verifyLookupToken } from './shared.js';

const OTP_TTL_MINUTES = 5;

async function sendSmsOtp(phone: string, otp: string): Promise<void> {
  const endpoint = process.env.SMS_API_URL?.trim();
  const token = process.env.SMS_API_TOKEN?.trim();
  if (!endpoint || !token) {
    throw Object.assign(new Error('SMS provider is not configured'), { statusCode: 503 });
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: phone,
      sender: process.env.SMS_SENDER_ID?.trim() || 'EduTrack',
      message: `EduTrack OTP: ${otp}. Ma co hieu luc ${OTP_TTL_MINUTES} phut.`,
    }),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`SMS provider rejected request (${response.status})`), {
      statusCode: 502,
    });
  }
}
export async function handleRequestSmsOtp(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const studentId = typeof req.body?.studentDocId === 'string' ? req.body.studentDocId.trim() : '';
  const loginType = req.body?.loginType === 'parent' ? 'parent' : req.body?.loginType === 'student' ? 'student' : '';
  const phone = normalizePhoneVN(typeof req.body?.phone === 'string' ? req.body.phone : '');
  const lookupToken = typeof req.body?.lookupToken === 'string' ? req.body.lookupToken : '';
  if (!studentId || !loginType || !phone || !verifyLookupToken(lookupToken, studentId)) {
    return res.status(400).json({ success: false, error: 'Invalid OTP request' });
  }

  const student = await getPostgresPool().query<{ contact: string | null }>(
    'select contact from students where id = $1 and is_revoked = false limit 1',
    [studentId]
  );
  const storedPhone = normalizePhoneVN(student.rows[0]?.contact || '');
  if (!storedPhone || storedPhone !== phone) {
    return res.status(400).json({ success: false, error: 'Phone number does not match the student profile' });
  }

  const recent = await getPostgresPool().query<{ count: string }>(
    `select count(*)::text as count
       from auth_otp_challenges
      where phone = $1 and created_at > now() - interval '15 minutes'`,
    [phone]
  );
  if (Number(recent.rows[0]?.count || 0) >= 5) {
    return res.status(429).json({ success: false, error: 'Too many OTP requests' });
  }

  const id = randomUUID();
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await getPostgresPool().query(
    `insert into auth_otp_challenges
       (id, student_id, login_type, phone, otp_hash, expires_at)
     values ($1, $2, $3, $4, $5, now() + interval '${OTP_TTL_MINUTES} minutes')`,
    [id, studentId, loginType, phone, hashSecret(otp)]
  );
  try {
    await sendSmsOtp(phone, otp);
  } catch (error) {
    await getPostgresPool().query('delete from auth_otp_challenges where id = $1', [id]);
    throw error;
  }
  return res.status(200).json({ success: true, challengeId: id });
}

export async function handleVerifySmsOtp(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const challengeId = typeof req.body?.challengeId === 'string' ? req.body.challengeId.trim() : '';
  const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
  const lookupToken = typeof req.body?.lookupToken === 'string' ? req.body.lookupToken : '';
  if (!challengeId || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ success: false, error: 'Invalid OTP' });
  }

  const client = await getPostgresPool().connect();
  try {
    await client.query('begin');
    const result = await client.query<{
      student_id: string;
      otp_hash: string;
      attempts: number;
    }>(
      `select student_id, otp_hash, attempts
         from auth_otp_challenges
        where id = $1
          and expires_at > now()
          and consumed_at is null
        for update`,
      [challengeId]
    );
    const challenge = result.rows[0];
    if (!challenge || !verifyLookupToken(lookupToken, challenge.student_id)) {
      await client.query('rollback');
      return res.status(400).json({ success: false, error: 'OTP is invalid or expired' });
    }
    if (challenge.attempts >= 5 || !verifySecret(challenge.otp_hash, otp)) {
      await client.query(
        'update auth_otp_challenges set attempts = least(attempts + 1, 10) where id = $1',
        [challengeId]
      );
      await client.query('commit');
      return res.status(400).json({ success: false, error: 'OTP is invalid or expired' });
    }
    await client.query(
      'update auth_otp_challenges set verified_at = now(), consumed_at = now() where id = $1',
      [challengeId]
    );
    await client.query('commit');
    return res.status(200).json({
      success: true,
      resetToken: createLookupToken(challenge.student_id),
    });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5173';
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || '';
const TEACHER_TOKEN = __ENV.TEACHER_TOKEN || '';
const PARENT_TOKEN = __ENV.PARENT_TOKEN || '';

const studentIndexWarmDuration = new Trend('student_index_warm_duration', true);
const studentIndexColdDuration = new Trend('student_index_cold_duration', true);

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500'],
    student_index_warm_duration: ['p(95)<1200'],
    student_index_cold_duration: ['p(95)<4000'],
  },
};

function headers(token: string) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: '10s',
  };
}

export default function () {
  if (ADMIN_TOKEN) {
    const studentIndexResponse = http.get(
      `${BASE_URL}/api/v1/read/students?channel=students&view=index`,
      {
        ...headers(ADMIN_TOKEN),
        tags: { endpoint: 'student-index' },
      }
    );
    const coldStart = studentIndexResponse.headers['X-Function-Cold-Start'] === '1';
    if (studentIndexResponse.status === 200) {
      const durationMetric = coldStart ? studentIndexColdDuration : studentIndexWarmDuration;
      durationMetric.add(studentIndexResponse.timings.duration);
    }

    let studentIndex: any;
    try {
      studentIndex = studentIndexResponse.json();
    } catch {
      // Non-JSON responses are handled by the checks below.
    }
    const students = studentIndex?.data?.students;
    const meta = studentIndex?.data?.meta;
    check(studentIndexResponse, {
      'student index ok': (res) => res.status === 200,
      'student index is complete': () =>
        meta?.complete === true &&
        Array.isArray(students) &&
        students.length === meta.total &&
        meta.total <= 3000,
      'student index payload below 3.5 MB': (res) =>
        String(res.body || '').length < 3.5 * 1024 * 1024,
      'student index exposes runtime diagnostics': (res) =>
        Boolean(res.headers['X-Function-Cold-Start']) && Boolean(res.headers['X-Function-Region']),
    });

    check(
      http.get(
        `${BASE_URL}/api/v1/read/office-academic?view=summary&limit=50`,
        headers(ADMIN_TOKEN)
      ),
      { 'office summary ok': (res) => res.status === 200 }
    );
    check(
      http.get(
        `${BASE_URL}/api/v1/read/reports-monthly?scope=academic&month=2026-06`,
        headers(ADMIN_TOKEN)
      ),
      { 'reports monthly ok': (res) => res.status === 200 }
    );
  }

  if (TEACHER_TOKEN) {
    check(http.get(`${BASE_URL}/api/v1/read/classes?limit=50`, headers(TEACHER_TOKEN)), {
      'teacher classes ok': (res) => res.status === 200,
    });
  }

  if (PARENT_TOKEN) {
    check(http.get(`${BASE_URL}/api/v1/read/parent-tuition`, headers(PARENT_TOKEN)), {
      'parent tuition ok': (res) => res.status === 200,
    });
  }

  sleep(1);
}

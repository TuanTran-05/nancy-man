/**
 * Lightweight User Agent parser.
 * Returns human-readable browser + OS info without external dependencies.
 */

interface ParsedUA {
  browser: string;
  os: string;
  /** Combined short label, e.g. "Chrome 120 / Windows 10" */
  label: string;
}

const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A)?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/SamsungBrowser\/(\d+)/, 'Samsung'],
  [/UCBrowser\/(\d+)/, 'UC Browser'],
  [/CriOS\/(\d+)/, 'Chrome iOS'],
  [/FxiOS\/(\d+)/, 'Firefox iOS'],
  [/Chrome\/(\d+)/, 'Chrome'],
  [/Firefox\/(\d+)/, 'Firefox'],
  [/Safari\/(\d+).*Version\/(\d+)/, 'Safari'],
  [/Version\/(\d+).*Safari/, 'Safari'],
  [/MSIE (\d+)/, 'IE'],
  [/Trident.*rv:(\d+)/, 'IE'],
];

const OS_PATTERNS: [RegExp, string][] = [
  [/Windows NT 10\.0/, 'Windows 10+'],
  [/Windows NT 6\.3/, 'Windows 8.1'],
  [/Windows NT 6\.2/, 'Windows 8'],
  [/Windows NT 6\.1/, 'Windows 7'],
  [/Windows/, 'Windows'],
  [/Mac OS X (\d+)[_.](\d+)/, 'macOS'],
  [/Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Android (\d+)/, 'Android'],
  [/Android/, 'Android'],
  [/iPhone OS (\d+)/, 'iOS'],
  [/iPad.*OS (\d+)/, 'iPadOS'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Linux/, 'Linux'],
];

export function parseUserAgent(ua?: string | null): ParsedUA {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', label: 'Unknown' };

  // Detect browser
  let browser = 'Unknown';
  for (const [regex, name] of BROWSERS) {
    const m = ua.match(regex);
    if (m) {
      // Safari has version in a different capture group
      const version = name === 'Safari' ? m[2] || m[1] : m[1];
      browser = version ? `${name} ${version}` : name;
      break;
    }
  }

  // Detect OS
  let os = 'Unknown';
  for (const [regex, name] of OS_PATTERNS) {
    const m = ua.match(regex);
    if (m) {
      if (name === 'Android' && m[1]) {
        os = `Android ${m[1]}`;
      } else if (name === 'iOS' && m[1]) {
        os = `iOS ${m[1]}`;
      } else if (name === 'iPadOS' && m[1]) {
        os = `iPadOS ${m[1]}`;
      } else {
        os = name;
      }
      break;
    }
  }

  const label = browser !== 'Unknown' || os !== 'Unknown' ? `${browser} / ${os}` : 'Unknown';

  return { browser, os, label };
}

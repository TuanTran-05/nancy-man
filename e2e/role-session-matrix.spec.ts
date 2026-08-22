import { expect, test, type Page } from '@playwright/test';

type Role = 'admin' | 'office' | 'accounting' | 'teacher' | 'student' | 'parent';

type RoleCase = {
  role: Role;
  identityEnv: string;
  passwordEnv: string;
  loginType: 'staff' | 'student' | 'parent';
  landingPath: RegExp;
  allowedPath: string;
  forbiddenPath: string;
};

const roleCases: RoleCase[] = [
  {
    role: 'admin',
    identityEnv: 'E2E_ADMIN_EMAIL',
    passwordEnv: 'E2E_ADMIN_PASSWORD',
    loginType: 'staff',
    landingPath: /\/admin(?:[/?#]|$)/,
    allowedPath: '/audit-log',
    forbiddenPath: '/office-dashboard',
  },
  {
    role: 'office',
    identityEnv: 'E2E_OFFICE_EMAIL',
    passwordEnv: 'E2E_OFFICE_PASSWORD',
    loginType: 'staff',
    landingPath: /\/office-dashboard(?:[/?#]|$)/,
    allowedPath: '/admissions',
    forbiddenPath: '/audit-log',
  },
  {
    role: 'accounting',
    identityEnv: 'E2E_ACCOUNTING_EMAIL',
    passwordEnv: 'E2E_ACCOUNTING_PASSWORD',
    loginType: 'staff',
    landingPath: /\/tuition(?:[/?#]|$)/,
    allowedPath: '/payroll',
    forbiddenPath: '/audit-log',
  },
  {
    role: 'teacher',
    identityEnv: 'E2E_TEACHER_EMAIL',
    passwordEnv: 'E2E_TEACHER_PASSWORD',
    loginType: 'staff',
    landingPath: /\/(?:$|assignments|classes|calendar|reports)/,
    allowedPath: '/assignments',
    forbiddenPath: '/audit-log',
  },
  {
    role: 'student',
    identityEnv: 'E2E_STUDENT_CODE',
    passwordEnv: 'E2E_STUDENT_PASSWORD',
    loginType: 'student',
    landingPath: /\/(?:$|assignments)/,
    allowedPath: '/assignments',
    forbiddenPath: '/audit-log',
  },
  {
    role: 'parent',
    identityEnv: 'E2E_PARENT_CODE',
    passwordEnv: 'E2E_PARENT_PASSWORD',
    loginType: 'parent',
    landingPath: /\/(?:$|parent\/tuition)/,
    allowedPath: '/parent/tuition',
    forbiddenPath: '/audit-log',
  },
];

async function login(page: Page, roleCase: RoleCase, identity: string, password: string) {
  await page.goto('/login');
  await page.getByTestId(`login-role-${roleCase.loginType}`).click();

  if (roleCase.loginType === 'staff') {
    await page.locator('#staff-email').fill(identity);
    await page.locator('#staff-password').fill(password);
  } else {
    await page.locator('#student-code').fill(identity);
    await page.locator('#student-password').fill(password);
  }

  const submit = page.locator('button[type="submit"]');
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
  await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/, { timeout: 30_000 });
}

for (const roleCase of roleCases) {
  test(`${roleCase.role}: login, reload, authorization and logout`, async ({ page }) => {
    const identity = process.env[roleCase.identityEnv];
    const password = process.env[roleCase.passwordEnv];
    test.skip(
      !identity || !password,
      `Requires ${roleCase.identityEnv} and ${roleCase.passwordEnv}`
    );

    await login(page, roleCase, identity!, password!);
    await expect(page).toHaveURL(roleCase.landingPath);

    const session = await page.request.get('/api/v1/auth/session');
    expect(session.status()).toBe(200);
    await expect(session.json()).resolves.toMatchObject({
      success: true,
      user: { role: roleCase.role },
    });

    await page.reload();
    await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);

    await page.goto(roleCase.allowedPath);
    await expect(page).toHaveURL(new RegExp(roleCase.allowedPath.replace('/', '\\/')));
    await expect(page.locator('body')).toBeVisible();

    await page.goto(roleCase.forbiddenPath);
    await expect(page).not.toHaveURL(new RegExp(roleCase.forbiddenPath.replace('/', '\\/')));

    await page.getByTestId('sign-out-button').click();
    await expect(page).toHaveURL(/\/login(?:[/?#]|$)/);
    expect((await page.request.get('/api/v1/auth/session')).status()).toBe(401);
  });
}

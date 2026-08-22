import { common as commonVi } from './locales/vi/common';
import { pages as pagesVi } from './locales/vi/pages';
import { components as componentsVi } from './locales/vi/components';

import { common as commonEn } from './locales/en/common';
import { pages as pagesEn } from './locales/en/pages';
import { components as componentsEn } from './locales/en/components';

export const translations: Record<'vi' | 'en', any> = {
  vi: {
    ...commonVi,
    ...pagesVi,
    ...componentsVi,
  },
  en: {
    ...commonEn,
    ...pagesEn,
    ...componentsEn,
  },
};

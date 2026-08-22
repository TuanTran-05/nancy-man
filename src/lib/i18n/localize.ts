export type Language = 'vi' | 'en';
export type LanguageLike = Language | string | null | undefined;

export type Localizer = <Vi, En>(viValue: Vi, enValue: En) => Vi | En;

export function localize<Vi, En>(language: LanguageLike, viValue: Vi, enValue: En): Vi | En {
  return language === 'vi' ? viValue : enValue;
}

export function createLocalizer(language: LanguageLike): Localizer {
  return (viValue, enValue) => localize(language, viValue, enValue);
}

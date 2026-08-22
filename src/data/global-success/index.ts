import { LessonDeck } from '../../types';

import grade6Decks from './grade6';
import grade7Decks from './grade7';
import grade8Decks from './grade8';
import grade9Decks from './grade9';

export type GlobalSuccessGrade = 6 | 7 | 8 | 9;

export interface GlobalSuccessUnit {
  unitNumber: number;
  title: string;
}

export const GLOBAL_SUCCESS_GRADES: GlobalSuccessGrade[] = [6, 7, 8, 9];

export const GLOBAL_SUCCESS_UNITS: GlobalSuccessUnit[] = Array.from({ length: 12 }, (_, index) => ({
  unitNumber: index + 1,
  title: `Unit ${index + 1}`,
}));

export const getGlobalSuccessProgramName = (grade: GlobalSuccessGrade) =>
  `Grade ${grade} Global Success`;

export const isGlobalSuccessGrade = (value: number): value is GlobalSuccessGrade =>
  GLOBAL_SUCCESS_GRADES.includes(value as GlobalSuccessGrade);

export const getGlobalSuccessUnitTitle = (unitNumber: number) =>
  GLOBAL_SUCCESS_UNITS.find((unit) => unit.unitNumber === unitNumber)?.title ||
  `Unit ${unitNumber}`;

export const globalSuccessLessonDecks: LessonDeck[] = [
  ...grade6Decks,
  ...grade7Decks,
  ...grade8Decks,
  ...grade9Decks,
];

export const getLessonDecksForUnit = (grade: GlobalSuccessGrade, unitNumber: number) =>
  globalSuccessLessonDecks.filter((deck) => deck.grade === grade && deck.unitNumber === unitNumber);

export const getLessonDeckById = (deckId: string) =>
  globalSuccessLessonDecks.find((deck) => deck.id === deckId);

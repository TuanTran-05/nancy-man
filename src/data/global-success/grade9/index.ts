import { LessonDeck } from '../../../types';

import unit01Import from './unit01';
import unit02Import from './unit02';
import unit03Import from './unit03';
import unit04Import from './unit04';
import unit05Import from './unit05';
import unit06Import from './unit06';
import unit07Import from './unit07';
import unit08Import from './unit08';
import unit09Import from './unit09';
import unit10Import from './unit10';
import unit11Import from './unit11';
import unit12Import from './unit12';

// Normalize: each unit file exports a single LessonDeck or LessonDeck[]
function flatten(value: LessonDeck | LessonDeck[]): LessonDeck[] {
  return Array.isArray(value) ? value : [value];
}

const grade9Decks: LessonDeck[] = [
  ...flatten(unit01Import),
  ...flatten(unit02Import),
  ...flatten(unit03Import),
  ...flatten(unit04Import),
  ...flatten(unit05Import),
  ...flatten(unit06Import),
  ...flatten(unit07Import),
  ...flatten(unit08Import),
  ...flatten(unit09Import),
  ...flatten(unit10Import),
  ...flatten(unit11Import),
  ...flatten(unit12Import),
];

export default grade9Decks;

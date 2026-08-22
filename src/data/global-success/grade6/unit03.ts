import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g6-u3-my-friends',
  curriculumFamily: 'global-success',
  grade: 6,
  unitNumber: 3,
  title: 'Unit 3: My Friends',
  description: 'Bai giang ve tinh cach, ngoai hinh va cach mo ta ban be.',
  createdAt: '2026-05-15T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'My Friends',
      layout: 'title-content',
      text: 'Lead in with one question: What makes a good friend? Collect answers on the board before teaching adjectives.',
    },
    {
      id: 's2',
      title: 'Personality Words',
      layout: 'cards',
      cards: [
        { title: 'kind', content: 'A kind person helps others.' },
        { title: 'funny', content: 'A funny person makes people laugh.' },
        { title: 'clever', content: 'A clever person learns quickly.' },
        { title: 'active', content: 'An active person likes moving and doing things.' },
      ],
    },
    {
      id: 's3',
      title: 'Describe A Friend',
      layout: 'title-content',
      text: 'Model sentence: "My friend is tall and kind. She has long hair. She likes English." Students write three sentences about a classmate.',
    },
    {
      id: 's4',
      title: 'Class Interview',
      layout: 'audio-text',
      text: 'Students walk around and ask: "What is your best friend like?" Then report one answer to the class.',
    },
  ],
};

export default deck;

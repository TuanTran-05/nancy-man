import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g8-u5-customs-traditions',
  curriculumFamily: 'global-success',
  grade: 8,
  unitNumber: 5,
  title: 'Grammar Grade 8 - Unit 5: Our Customs and Traditions',
  description:
    'Bài giảng Unit 5 Global Success 8 về articles: a/an, the, zero article và cách dùng trong chủ đề customs and traditions.',
  createdAt: '2026-05-15T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 8',
      subtitle: 'UNIT 5: OUR CUSTOMS AND TRADITIONS',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'A / AN',
          subtitle: '(Mạo từ không xác định)',
          accent: 'orange',
        },
        {
          title: 'THE',
          subtitle: '(Mạo từ xác định)',
          accent: 'pink',
        },
        {
          title: 'ZERO ARTICLE',
          subtitle: '(Không dùng mạo từ)',
          accent: 'blue',
        },
        {
          title: 'PRACTICE',
          subtitle: '(Customs and Traditions)',
          accent: 'green',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      accent: 'blue',
      bullets: [
        {
          content: [
            { text: 'Phân biệt ' },
            { text: 'a/an', accent: 'orange', bold: true },
            { text: ', ' },
            { text: 'the', accent: 'pink', bold: true },
            { text: ' và ' },
            { text: 'zero article', accent: 'blue', bold: true },
          ],
        },
        {
          content: 'Dùng a/an với danh từ đếm được số ít chưa xác định.',
        },
        {
          content: 'Dùng the với danh từ đã xác định hoặc duy nhất.',
        },
        {
          content: 'Nhận biết các trường hợp không dùng mạo từ.',
        },
      ],
    },
    {
      id: 's3',
      title: 'A / AN',
      subtitle: 'Mạo từ không xác định',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'A / An: Cách dùng',
      subtitle: 'Dùng khi nói về một người/vật chưa xác định.',
      layout: 'cards',
      accent: 'orange',
      cards: [
        {
          title: 'a',
          accent: 'orange',
          content: 'Dùng trước âm phụ âm.',
          example: 'a custom, a university, a wonderful tradition',
        },
        {
          title: 'an',
          accent: 'green',
          content: 'Dùng trước âm nguyên âm.',
          example: 'an interesting tradition, an hour',
        },
        {
          title: 'First mention',
          accent: 'blue',
          content: 'Lần đầu nhắc đến người/vật chưa xác định.',
          example: 'I visited a temple yesterday.',
        },
        {
          title: 'Jobs / identity',
          accent: 'purple',
          content: 'Dùng với nghề nghiệp hoặc danh tính.',
          example: 'My father is a doctor.',
        },
      ],
    },
    {
      id: 's5',
      title: 'THE',
      subtitle: 'Mạo từ xác định',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's6',
      title: 'The: Khi nào dùng?',
      subtitle: 'Dùng khi người nghe biết rõ ta đang nói tới ai/cái gì.',
      layout: 'cards',
      accent: 'pink',
      cards: [
        {
          title: 'Đã nhắc trước đó',
          accent: 'pink',
          content: 'Lần đầu dùng a/an, lần sau dùng the.',
          example: 'I saw a cat. The cat was sleeping.',
        },
        {
          title: 'Cả hai đều biết',
          accent: 'blue',
          content: 'Đối tượng đã rõ trong tình huống.',
          example: 'Can you open the door?',
        },
        {
          title: 'Vật duy nhất',
          accent: 'green',
          bullets: ['the sun', 'the moon', 'the earth', 'the sky'],
        },
        {
          title: 'Superlatives / Ordinals',
          accent: 'orange',
          bullets: ['the best student', 'the oldest tradition', 'the first day'],
        },
      ],
    },
    {
      id: 's7',
      title: 'The: Các nhóm tên riêng',
      subtitle: 'Một số loại danh từ riêng luôn đi với the.',
      layout: 'cards',
      accent: 'purple',
      cards: [
        {
          title: 'Geography',
          accent: 'blue',
          bullets: ['the Red River', 'the Pacific Ocean', 'the Himalayas', 'the Sahara Desert'],
        },
        {
          title: 'Instruments',
          accent: 'green',
          bullets: ['play the piano', 'play the guitar', 'play the violin'],
        },
        {
          title: 'Groups of people',
          accent: 'pink',
          bullets: ['the rich', 'the poor', 'the young', 'the old'],
        },
        {
          title: 'Countries / places',
          accent: 'orange',
          bullets: ['the United Kingdom', 'the United States', 'the Eiffel Tower'],
        },
      ],
    },
    {
      id: 's8',
      title: 'ZERO ARTICLE',
      subtitle: 'Không dùng mạo từ',
      label: 'Phần 3',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's9',
      title: 'Zero Article: Cách dùng',
      subtitle: 'Một số danh từ không cần a/an/the.',
      layout: 'cards',
      accent: 'blue',
      cards: [
        {
          title: 'Nói chung',
          accent: 'blue',
          content: 'Danh từ số nhiều hoặc không đếm được khi nói chung.',
          example: 'Students should respect their traditions.',
        },
        {
          title: 'Meals / sports',
          accent: 'green',
          bullets: ['have breakfast', 'have dinner', 'play football', 'play badminton'],
        },
        {
          title: 'Subjects / languages',
          accent: 'orange',
          bullets: ['study Math', 'learn English', 'speak Vietnamese'],
        },
        {
          title: 'By + transport',
          accent: 'pink',
          bullets: ['by bus', 'by train', 'by plane', 'by car'],
        },
      ],
    },
    {
      id: 's10',
      title: 'Practice',
      subtitle: 'Điền a, an, the hoặc để trống.',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'We have _____ custom of giving lucky money during Tet.' },
        { content: 'That is _____ interesting tradition.' },
        { content: '_____ sun rises in _____ east.' },
        { content: 'Vietnamese people love playing _____ football.' },
      ],
      examples: ['a', 'an', 'The / the', 'zero article'],
    },
  ],
};

export default deck;

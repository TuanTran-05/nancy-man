import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g7-u2-healthy-living',
  curriculumFamily: 'global-success',
  grade: 7,
  unitNumber: 2,
  title: 'Grammar Grade 7 - Unit 2: Healthy Living',
  description: 'Bài giảng Unit 2 Global Success 7 về simple sentences và từ vựng Healthy Living.',
  createdAt: '2026-05-17T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 7',
      subtitle: 'UNIT 2: HEALTHY LIVING',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'SIMPLE SENTENCES',
          subtitle: '(Câu đơn)',
          accent: 'orange',
        },
        {
          title: 'SENTENCE PATTERNS',
          subtitle: '(S + V / O / C / Adv)',
          accent: 'pink',
        },
        {
          title: 'HEALTHY LIVING',
          subtitle: '(Thói quen và vấn đề sức khỏe)',
          accent: 'blue',
        },
        {
          title: 'COMMUNICATION',
          subtitle: '(Nói về bệnh và lời khuyên)',
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
            { text: 'Nhận diện một ' },
            { text: 'simple sentence', accent: 'orange', bold: true },
            { text: ' và các thành phần chính của câu.' },
          ],
        },
        {
          content:
            'Phân biệt các mẫu câu S + V, S + V + O, S + V + C, S + V + Adv và S + V + O + Adv.',
        },
        {
          content: 'Dùng câu đơn với Present Simple và should / should not để nói về sức khỏe.',
        },
        {
          content: 'Nói về thói quen lành mạnh, vấn đề sức khỏe và lời khuyên bằng từ vựng Unit 2.',
        },
      ],
    },
    {
      id: 's3',
      title: 'SIMPLE SENTENCES',
      subtitle: 'Câu đơn',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Câu đơn là gì?',
      subtitle: 'Một câu đơn diễn đạt một ý hoàn chỉnh với một động từ chính.',
      layout: 'cards',
      cards: [
        {
          title: 'Subject',
          accent: 'orange',
          bullets: ['I', 'she', 'my father', 'people'],
        },
        {
          title: 'Verb',
          accent: 'pink',
          bullets: ['eat', 'drink', 'exercise', 'sleep'],
        },
        {
          title: 'Object / Complement',
          accent: 'blue',
          bullets: ['vegetables', 'water', 'healthy', 'tired'],
        },
        {
          title: 'Adverbial',
          accent: 'green',
          bullets: ['every day', 'in the morning', 'at night'],
        },
      ],
    },
    {
      id: 's5',
      title: 'Các mẫu câu cơ bản',
      subtitle: 'Ba mẫu nền tảng xuất hiện nhiều nhất trong bài.',
      layout: 'cards',
      cards: [
        {
          title: 'S + V',
          accent: 'orange',
          bullets: ['I exercise.', 'She sleeps.', 'They swim.'],
        },
        {
          title: 'S + V + O',
          accent: 'pink',
          bullets: ['I eat vegetables.', 'She drinks water.'],
        },
        {
          title: 'S + V + C',
          accent: 'blue',
          bullets: ['I am healthy.', 'He feels sick.', 'The food is fresh.'],
        },
      ],
    },
    {
      id: 's6',
      title: 'Thêm trạng ngữ vào câu',
      subtitle: 'Câu đơn có thể dài hơn nhưng vẫn chỉ có một ý chính.',
      layout: 'cards',
      cards: [
        {
          title: 'S + V + Adv',
          accent: 'green',
          bullets: ['I exercise every morning.', 'He runs in the park.'],
        },
        {
          title: 'S + V + O + Adv',
          accent: 'blue',
          bullets: ['I drink water every day.', 'She eats vegetables for dinner.'],
        },
        {
          title: 'Vẫn là câu đơn',
          accent: 'purple',
          bullets: ['I drink a lot of water every day.', 'We should brush our teeth twice a day.'],
        },
      ],
    },
    {
      id: 's7',
      title: 'And trong câu đơn',
      subtitle: 'And có thể nối từ cùng loại mà câu vẫn là câu đơn.',
      layout: 'cards',
      cards: [
        {
          title: 'Nối danh từ',
          accent: 'orange',
          bullets: ['fruit and vegetables', 'soap and clean water'],
        },
        {
          title: 'Nối động từ',
          accent: 'pink',
          bullets: ['brush teeth and wash face', 'exercise and drink water'],
        },
        {
          title: 'Nối tính từ',
          accent: 'blue',
          bullets: ['fresh and healthy', 'strong and active'],
        },
        {
          title: 'Phân biệt',
          accent: 'green',
          bullets: [
            'Simple: I eat fruit and vegetables.',
            'Compound: I eat fruit, and my sister drinks milk.',
          ],
        },
      ],
    },
    {
      id: 's8',
      title: 'Câu đơn với Present Simple',
      subtitle: 'Thói quen sống lành mạnh thường dùng thì hiện tại đơn.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          bullets: ['I / You / We / They + V', 'He / She / It + V-s/es'],
          example: 'She eats vegetables every day.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          bullets: ['I / You / We / They + do not + V', 'He / She / It + does not + V'],
          example: 'He does not eat fast food.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          bullets: ['Do + S + V?', 'Does + S + V?'],
          example: 'Does she brush her teeth twice a day?',
        },
      ],
    },
    {
      id: 's9',
      title: 'Câu đơn với should',
      subtitle: 'Dùng để đưa ra lời khuyên về sức khỏe.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Công thức',
          accent: 'pink',
          content: [
            { text: 'S + ' },
            { text: 'should / should not + V nguyên mẫu', accent: 'pink', bold: true },
          ],
        },
        {
          title: 'Nên làm',
          accent: 'green',
          bullets: ['You should drink more water.', 'You should eat more vegetables.'],
        },
        {
          title: 'Không nên làm',
          accent: 'red',
          bullets: ['You should not eat too much fast food.', 'Children should not stay up late.'],
        },
      ],
    },
    {
      id: 's10',
      title: 'Lỗi thường gặp',
      subtitle: 'Câu đơn cần động từ chính rõ ràng.',
      layout: 'cards',
      cards: [
        {
          title: 'Thiếu động từ',
          accent: 'red',
          bullets: ['Sai: I healthy.', 'Đúng: I am healthy.'],
        },
        {
          title: 'He / She / It',
          accent: 'orange',
          bullets: ['Sai: She drink milk.', 'Đúng: She drinks milk.'],
        },
        {
          title: 'Sau does not',
          accent: 'blue',
          bullets: ['Sai: He does not eats.', 'Đúng: He does not eat.'],
        },
        {
          title: 'Sau should',
          accent: 'green',
          bullets: ['Sai: You should to drink.', 'Đúng: You should drink.'],
        },
      ],
    },
    {
      id: 's11',
      title: 'HEALTHY LIVING',
      subtitle: 'Từ vựng chủ đề sống lành mạnh',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's12',
      title: 'Healthy Habits',
      subtitle: 'Những thói quen nên có mỗi ngày.',
      layout: 'cards',
      cards: [
        {
          title: 'Exercise',
          accent: 'orange',
          bullets: ['exercise', 'do exercise', 'go jogging', 'play sports'],
        },
        {
          title: 'Food & drink',
          accent: 'pink',
          bullets: ['eat vegetables', 'eat fruit', 'drink water'],
        },
        {
          title: 'Daily care',
          accent: 'blue',
          bullets: ['sleep early', 'brush teeth', 'wash hands', 'keep clean'],
        },
      ],
    },
    {
      id: 's13',
      title: 'Unhealthy Habits & Problems',
      subtitle: 'Từ vựng về thói quen xấu và bệnh thường gặp.',
      layout: 'cards',
      cards: [
        {
          title: 'Bad habits',
          accent: 'red',
          bullets: ['eat fast food', 'drink soft drinks', 'stay up late', 'skip breakfast'],
        },
        {
          title: 'Health problems',
          accent: 'orange',
          bullets: ['headache', 'toothache', 'stomachache', 'sore throat'],
        },
        {
          title: 'Adjectives',
          accent: 'blue',
          bullets: ['healthy', 'unhealthy', 'tired', 'sick'],
        },
      ],
    },
    {
      id: 's14',
      title: 'Giao tiếp về sức khỏe',
      subtitle: 'Các mẫu câu thường gặp trong Unit 2.',
      layout: 'explain',
      accent: 'purple',
      sections: [
        {
          title: 'Nói vấn đề sức khỏe',
          accent: 'orange',
          content: 'S + have / has + health problem',
          example: 'She has a toothache.',
        },
        {
          title: 'Đưa lời khuyên',
          accent: 'pink',
          content: 'S + should / should not + V',
          example: 'You should drink warm water.',
        },
        {
          title: 'Nói thói quen lành mạnh',
          accent: 'blue',
          content: 'S + V / V-s/es + time expression',
          example: 'He brushes his teeth twice a day.',
        },
      ],
    },
    {
      id: 's15',
      title: 'Luyện tập nhanh',
      subtitle: 'Xác định hoặc hoàn thành câu đơn.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'She _____ a lot of water every day. (drink)' },
        { content: 'Fast food _____ unhealthy. (be)' },
        { content: 'You _____ stay up late. (should not)' },
        { content: 'I eat fruit _____ vegetables. (and)' },
      ],
      examples: ['drinks', 'is', 'should not', 'and'],
    },
    {
      id: 's16',
      title: 'Unit 2 Recap',
      subtitle: 'Healthy Living',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Câu đơn diễn đạt một ý chính với một động từ chính.' },
        { content: 'Các mẫu quen thuộc: S + V, S + V + O, S + V + C, S + V + Adv.' },
        { content: 'And có thể nối từ cùng loại mà câu vẫn là câu đơn.' },
        { content: 'Healthy Living thường dùng Present Simple và should / should not.' },
      ],
      examples: [
        'I exercise every morning.',
        'Vegetables are fresh and healthy.',
        'You should drink more water.',
      ],
    },
  ],
};

export default deck;

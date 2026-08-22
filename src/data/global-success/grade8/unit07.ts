import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g8-u7-environmental-protection',
  curriculumFamily: 'global-success',
  grade: 8,
  unitNumber: 7,
  title: 'Grammar Grade 8 - Unit 7: Environmental Protection',
  description:
    'Bài giảng Unit 7 Global Success 8 về First Conditional, Passive Voice, time clauses và từ vựng Environmental Protection.',
  createdAt: '2026-05-15T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 8',
      subtitle: 'UNIT 7: ENVIRONMENTAL PROTECTION',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'FIRST CONDITIONAL',
          subtitle: '(Câu điều kiện loại 1)',
          accent: 'orange',
        },
        {
          title: 'PASSIVE VOICE',
          subtitle: '(Câu bị động cơ bản)',
          accent: 'pink',
        },
        {
          title: 'TIME CLAUSES',
          subtitle: '(Mệnh đề trạng ngữ chỉ thời gian)',
          accent: 'blue',
        },
        {
          title: 'ENVIRONMENT VOCABULARY',
          subtitle: '(Pollution, causes, effects, solutions)',
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
            { text: 'Dùng ' },
            { text: 'First Conditional', accent: 'orange', bold: true },
            { text: ' để nói về điều kiện có thể xảy ra' },
          ],
        },
        {
          content: [
            { text: 'Chuyển câu chủ động sang ' },
            { text: 'Passive Voice', accent: 'pink', bold: true },
            { text: ' ở các thì cơ bản' },
          ],
        },
        {
          content: [
            { text: 'Không dùng ' },
            { text: 'will', accent: 'red', bold: true },
            { text: ' trong mệnh đề thời gian chỉ tương lai' },
          ],
        },
        {
          content: 'Sử dụng từ vựng về ô nhiễm, nguyên nhân, hậu quả và giải pháp.',
        },
      ],
    },
    {
      id: 's3',
      title: 'FIRST CONDITIONAL',
      subtitle: 'Câu điều kiện loại 1',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'First Conditional',
      subtitle: 'Điều kiện có thể xảy ra ở hiện tại hoặc tương lai.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'If-clause',
          accent: 'orange',
          content: 'If + S + V (Present Simple)',
          example: 'If we recycle more,',
        },
        {
          title: 'Main clause',
          accent: 'green',
          content: 'S + will / can / may / must + V',
          example: 'we will reduce waste.',
        },
        {
          title: 'Câu hoàn chỉnh',
          accent: 'blue',
          content: 'If + Present Simple, will + V',
          example: 'If people plant more trees, the air will be cleaner.',
        },
        {
          title: 'So sánh loại 0',
          accent: 'purple',
          content: 'Loại 0 nói sự thật chung; loại 1 nói khả năng trong tương lai.',
        },
      ],
    },
    {
      id: 's5',
      title: 'PASSIVE VOICE',
      subtitle: 'Câu bị động cơ bản',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's6',
      title: 'Passive Voice: Công thức',
      subtitle: 'Nhấn mạnh người/vật chịu tác động của hành động.',
      layout: 'cards',
      accent: 'pink',
      cards: [
        {
          title: 'Present Simple',
          accent: 'blue',
          content: 'S + am/is/are + V3/ed',
          example: 'Plastic bags are reused.',
        },
        {
          title: 'Present Continuous',
          accent: 'green',
          content: 'S + am/is/are + being + V3/ed',
          example: 'The river is being cleaned.',
        },
        {
          title: 'Past Simple',
          accent: 'orange',
          content: 'S + was/were + V3/ed',
          example: 'Trees were planted last week.',
        },
        {
          title: 'by + O',
          accent: 'purple',
          content: 'Dùng khi cần nói tác nhân thực hiện hành động.',
          example: 'The park was cleaned by volunteers.',
        },
      ],
    },
    {
      id: 's7',
      title: 'Chuyển chủ động sang bị động',
      subtitle: 'Làm theo từng bước để tránh sai cấu trúc.',
      layout: 'explain',
      accent: 'purple',
      sections: [
        {
          title: 'Bước 1',
          accent: 'blue',
          content: 'Xác định tân ngữ của câu chủ động.',
        },
        {
          title: 'Bước 2',
          accent: 'green',
          content: 'Đưa tân ngữ lên làm chủ ngữ mới.',
        },
        {
          title: 'Bước 3',
          accent: 'orange',
          content: 'Chọn đúng be theo thì và chủ ngữ mới.',
        },
        {
          title: 'Bước 4',
          accent: 'pink',
          content: 'Đổi động từ chính sang V3/ed và thêm by nếu cần.',
        },
      ],
    },
    {
      id: 's8',
      title: 'TIME CLAUSES',
      subtitle: 'Mệnh đề trạng ngữ chỉ thời gian',
      label: 'Phần 3',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's9',
      title: 'Time Clauses: Liên từ chính',
      subtitle: 'Khi mệnh đề thời gian đứng đầu câu, dùng dấu phẩy.',
      layout: 'cards',
      accent: 'blue',
      cards: [
        {
          title: 'when',
          accent: 'blue',
          content: 'Khi một sự việc xảy ra.',
          example: 'When it rains, the plants grow.',
        },
        {
          title: 'while',
          accent: 'purple',
          content: 'Trong khi một hành động kéo dài.',
          example: 'While we were cleaning, it started to rain.',
        },
        {
          title: 'after / before',
          accent: 'orange',
          content: 'Sau khi / trước khi.',
          example: 'After we finish lunch, we will go to the park.',
        },
        {
          title: 'until / by the time',
          accent: 'green',
          content: 'Cho đến khi / vào lúc đã hoàn thành.',
          example: 'I will wait until 5 PM.',
        },
      ],
    },
    {
      id: 's10',
      title: 'Quy tắc quan trọng',
      subtitle: 'Trong mệnh đề thời gian chỉ tương lai, không dùng will.',
      layout: 'explain',
      accent: 'red',
      sections: [
        {
          title: 'Sai',
          accent: 'red',
          content: 'When I will arrive, I will call you.',
        },
        {
          title: 'Đúng',
          accent: 'green',
          content: 'When I arrive, I will call you.',
        },
        {
          title: 'Main clause',
          accent: 'blue',
          content: 'Có thể dùng will + V trong mệnh đề chính.',
        },
        {
          title: 'Time clause',
          accent: 'orange',
          content: 'Dùng Present Simple cho ý tương lai.',
        },
      ],
    },
    {
      id: 's11',
      title: 'Environmental Vocabulary',
      subtitle: 'Từ vựng trọng tâm Unit 7.',
      layout: 'cards',
      accent: 'green',
      cards: [
        {
          title: 'Pollution',
          accent: 'blue',
          bullets: ['air pollution', 'water pollution', 'soil pollution', 'noise pollution'],
        },
        {
          title: 'Causes',
          accent: 'orange',
          bullets: ['factory waste', 'vehicle emissions', 'deforestation', 'plastic waste'],
        },
        {
          title: 'Effects',
          accent: 'red',
          bullets: ['global warming', 'climate change', 'respiratory diseases', 'wildlife loss'],
        },
        {
          title: 'Solutions',
          accent: 'green',
          bullets: ['reduce', 'reuse', 'recycle', 'renewable energy', 'plant trees'],
        },
      ],
    },
    {
      id: 's12',
      title: 'Practice',
      subtitle: 'Hoàn thành câu với đúng cấu trúc.',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'If we _____ more trees, the air _____ cleaner. (plant / be)' },
        { content: 'Plastic bottles _____ every day. (recycle - passive)' },
        { content: 'When I _____ home, I will turn off the lights. (arrive)' },
        { content: 'The river _____ by chemicals last year. (pollute - passive)' },
      ],
      examples: ['plant / will be', 'are recycled', 'arrive', 'was polluted'],
    },
  ],
};

export default deck;

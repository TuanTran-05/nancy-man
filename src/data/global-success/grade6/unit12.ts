import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g6-u12-robots',
  curriculumFamily: 'global-success',
  grade: 6,
  unitNumber: 12,
  title: 'Grammar Grade 6 - Unit 12: Robots',
  description:
    'Bài giảng Unit 12 Global Success 6 về superlative adjectives, cấu trúc với can và từ vựng Robots.',
  createdAt: '2026-05-17T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 6',
      subtitle: 'UNIT 12: ROBOTS',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'SUPERLATIVE ADJECTIVES',
          subtitle: '(Tính từ so sánh nhất)',
          accent: 'orange',
        },
        {
          title: 'SPELLING RULES',
          subtitle: '(the -est / the most)',
          accent: 'pink',
        },
        {
          title: 'ROBOT STRUCTURES',
          subtitle: '(can / one of the...)',
          accent: 'blue',
        },
        {
          title: 'ROBOTS VOCABULARY',
          subtitle: '(Loại robot và hoạt động)',
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
            { text: 'superlative adjectives', accent: 'orange', bold: true },
            { text: ' để nói đối tượng nổi bật nhất trong một nhóm.' },
          ],
        },
        {
          content: [
            { text: 'Chọn đúng dạng ' },
            { text: 'the + adj-est', accent: 'pink', bold: true },
            { text: ' hoặc ' },
            { text: 'the most + adjective', accent: 'green', bold: true },
            { text: '.' },
          ],
        },
        {
          content: 'Phân biệt comparative với superlative khi so sánh robot.',
        },
        {
          content: 'Mô tả robot bằng can, one of the..., và từ vựng chủ đề Robots.',
        },
      ],
    },
    {
      id: 's3',
      title: 'SUPERLATIVE ADJECTIVES',
      subtitle: 'Tính từ so sánh nhất',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Hai công thức chính',
      subtitle: 'So sánh một đối tượng với cả nhóm từ ba đối tượng trở lên.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Tính từ ngắn',
          accent: 'orange',
          content: [
            { text: 'S + be + ' },
            { text: 'the + short adjective-est', accent: 'orange', bold: true },
            { text: ' + in/of + group' },
          ],
          example: 'This robot is the fastest in the race.',
        },
        {
          title: 'Tính từ dài',
          accent: 'pink',
          content: [
            { text: 'S + be + ' },
            { text: 'the most + long adjective', accent: 'pink', bold: true },
            { text: ' + in/of + group' },
          ],
          example: 'This robot is the most intelligent in the show.',
        },
        {
          title: 'Dấu hiệu',
          accent: 'blue',
          bullets: ['the', 'in + địa điểm / nhóm', 'of + nhóm cụ thể'],
        },
      ],
    },
    {
      id: 's5',
      title: 'Cách thành lập: nhóm 1',
      subtitle: 'Các quy tắc phổ biến với tính từ ngắn.',
      layout: 'cards',
      cards: [
        {
          title: 'Thêm -est',
          accent: 'orange',
          bullets: ['fast -> the fastest', 'small -> the smallest', 'quiet -> the quietest'],
        },
        {
          title: 'Kết thúc bằng -e',
          accent: 'blue',
          bullets: ['large -> the largest', 'safe -> the safest', 'wide -> the widest'],
        },
        {
          title: 'Phụ âm + y',
          accent: 'green',
          bullets: ['noisy -> the noisiest', 'busy -> the busiest', 'easy -> the easiest'],
        },
      ],
    },
    {
      id: 's6',
      title: 'Cách thành lập: nhóm 2',
      subtitle: 'Ba nhóm cần nhớ để tránh sai chính tả.',
      layout: 'cards',
      cards: [
        {
          title: '1 nguyên âm + 1 phụ âm',
          accent: 'pink',
          bullets: ['big -> the biggest', 'hot -> the hottest', 'thin -> the thinnest'],
        },
        {
          title: 'Tính từ dài',
          accent: 'purple',
          bullets: [
            'useful -> the most useful',
            'modern -> the most modern',
            'intelligent -> the most intelligent',
          ],
        },
        {
          title: 'Bất quy tắc',
          accent: 'red',
          bullets: ['good -> the best', 'bad -> the worst', 'far -> the farthest / furthest'],
        },
      ],
    },
    {
      id: 's7',
      title: 'Các dạng câu',
      subtitle: 'The là thành phần bắt buộc trong so sánh nhất thông thường.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: 'S + be + the + superlative adjective + in/of + group',
          example: 'This robot is the fastest in the class.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: 'S + be not + the + superlative adjective + ...',
          example: 'This robot is not the fastest.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: 'Be + S + the + superlative adjective + ...?',
          example: 'Is this robot the smartest?',
        },
        {
          title: 'Trả lời ngắn',
          accent: 'purple',
          bullets: ['Yes, it is.', 'No, it is not.'],
        },
      ],
    },
    {
      id: 's8',
      title: 'Comparative vs Superlative',
      subtitle: 'Hai kiểu so sánh khác nhau về số lượng đối tượng.',
      layout: 'cards',
      cards: [
        {
          title: 'Comparative',
          accent: 'orange',
          bullets: ['So sánh 2 đối tượng', 'adj-er / more adj + than'],
          example: 'This robot is faster than that robot.',
        },
        {
          title: 'Superlative',
          accent: 'blue',
          bullets: ['So sánh 1 với cả nhóm', 'the adj-est / the most adj'],
          example: 'This robot is the fastest in the group.',
        },
        {
          title: 'Nhìn dấu hiệu',
          accent: 'green',
          bullets: ['than -> comparative', 'the + in/of -> superlative'],
        },
      ],
    },
    {
      id: 's9',
      title: 'Lỗi thường gặp',
      subtitle: 'Kiểm tra the, most và dạng chính tả trước khi chốt câu.',
      layout: 'cards',
      cards: [
        {
          title: 'Thiếu the',
          accent: 'red',
          bullets: ['Sai: robot is fastest', 'Đúng: robot is the fastest'],
        },
        {
          title: 'Không dùng most + -est',
          accent: 'orange',
          bullets: ['Sai: the most fastest', 'Đúng: the fastest'],
        },
        {
          title: 'Chính tả',
          accent: 'blue',
          bullets: ['bigest -> biggest', 'easyest -> easiest', 'usefulest -> the most useful'],
        },
      ],
    },
    {
      id: 's10',
      title: 'ROBOTS',
      subtitle: 'Từ vựng chủ đề người máy',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's11',
      title: 'Types of Robots',
      subtitle: 'Các loại robot quen thuộc trong Unit 12.',
      layout: 'cards',
      cards: [
        {
          title: 'At home',
          accent: 'orange',
          bullets: ['home robot', 'cleaning robot', 'service robot'],
        },
        {
          title: 'At work',
          accent: 'blue',
          bullets: ['doctor robot', 'worker robot', 'guard robot'],
        },
        {
          title: 'Learning & rescue',
          accent: 'green',
          bullets: ['teaching robot', 'rescue robot', 'space robot'],
        },
      ],
    },
    {
      id: 's12',
      title: 'What can robots do?',
      subtitle: 'Những việc robot có thể làm.',
      layout: 'cards',
      cards: [
        {
          title: 'Housework',
          accent: 'orange',
          bullets: ['clean the house', 'wash the dishes', 'do the laundry'],
        },
        {
          title: 'Daily help',
          accent: 'pink',
          bullets: ['cook meals', 'water plants', 'help old people'],
        },
        {
          title: 'Special tasks',
          accent: 'blue',
          bullets: ['teach children', 'repair machines', 'explore space'],
        },
      ],
    },
    {
      id: 's13',
      title: 'Adjectives for Robots',
      subtitle: 'Từ vựng giúp so sánh robot.',
      layout: 'cards',
      cards: [
        {
          title: 'Short adjectives',
          accent: 'orange',
          bullets: ['smart -> the smartest', 'fast -> the fastest', 'small -> the smallest'],
        },
        {
          title: 'Long adjectives',
          accent: 'blue',
          bullets: [
            'useful -> the most useful',
            'modern -> the most modern',
            'popular -> the most popular',
          ],
        },
        {
          title: 'Irregular',
          accent: 'green',
          bullets: ['good -> the best', 'bad -> the worst'],
        },
      ],
    },
    {
      id: 's14',
      title: 'Các cấu trúc quan trọng',
      subtitle: 'Dùng khi mô tả robot trong bài nói hoặc bài viết.',
      layout: 'explain',
      accent: 'purple',
      sections: [
        {
          title: 'Robot + can + V',
          accent: 'orange',
          content: 'S + can + V nguyên mẫu',
          example: 'Robots can clean the house.',
        },
        {
          title: 'The most useful robot',
          accent: 'pink',
          content: 'Dùng để nói robot hữu ích nhất.',
          example: 'The home robot is the most useful robot for my family.',
        },
        {
          title: 'One of the...',
          accent: 'blue',
          content: 'S + be + one of the + superlative adjective + plural noun',
          example: 'This is one of the smartest robots in the world.',
        },
      ],
    },
    {
      id: 's15',
      title: 'Luyện tập nhanh',
      subtitle: 'Hoàn thành câu với dạng so sánh nhất đúng.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'This robot is _____ in the race. (fast)' },
        { content: 'The home robot is _____ robot in my house. (useful)' },
        { content: 'This is _____ robot in the exhibition. (big)' },
        { content: 'That old robot is _____ in the test. (bad)' },
      ],
      examples: ['the fastest', 'the most useful', 'the biggest', 'the worst'],
    },
    {
      id: 's16',
      title: 'Unit 12 Recap',
      subtitle: 'Robots',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Superlative dùng để so sánh một đối tượng với cả nhóm.' },
        { content: 'Tính từ ngắn dùng the + adj-est; tính từ dài dùng the most + adj.' },
        { content: 'Comparative có than; superlative thường có the và in/of.' },
        { content: 'Robot + can + V dùng để nói robot làm được gì.' },
      ],
      examples: [
        'This is the smartest robot in the class.',
        'The cleaning robot is one of the most useful robots in my house.',
      ],
    },
  ],
};

export default deck;

import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g6-u11-greener-world',
  curriculumFamily: 'global-success',
  grade: 6,
  unitNumber: 11,
  title: 'Grammar Grade 6 - Unit 11: Our Greener World',
  description:
    'Bài giảng Unit 11 Global Success 6 về articles, first conditional và từ vựng môi trường.',
  createdAt: '2026-05-16T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 6',
      subtitle: 'UNIT 11: OUR GREENER WORLD',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'ARTICLES',
          subtitle: '(a / an / the)',
          accent: 'orange',
        },
        {
          title: 'ZERO ARTICLE',
          subtitle: '(không dùng mạo từ)',
          accent: 'pink',
        },
        {
          title: 'FIRST CONDITIONAL',
          subtitle: '(Câu điều kiện loại 1)',
          accent: 'blue',
        },
        {
          title: 'GREEN VOCABULARY',
          subtitle: '(Từ vựng môi trường)',
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
            { text: 'Chọn đúng ' },
            { text: 'a, an, the', accent: 'orange', bold: true },
            { text: ' khi nói về người, vật hoặc môi trường.' },
          ],
        },
        {
          content: [
            { text: 'Biết khi nào ' },
            { text: 'không dùng mạo từ', accent: 'pink', bold: true },
            { text: ' với danh từ số nhiều hoặc không đếm được.' },
          ],
        },
        {
          content: [
            { text: 'Dùng ' },
            { text: 'If + Present Simple, will + V', accent: 'blue', bold: true },
            { text: ' để nói kết quả có thể xảy ra.' },
          ],
        },
        {
          content: 'Dùng từ vựng môi trường để đề xuất hành động xanh cho lớp học.',
        },
      ],
    },
    {
      id: 's3',
      title: 'ARTICLES',
      subtitle: 'A / An / The',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'A, An, The: dùng khi nào?',
      subtitle: 'Mạo từ đứng trước danh từ để cho biết người nghe đã biết danh từ đó chưa.',
      layout: 'cards',
      cards: [
        {
          title: 'A',
          accent: 'orange',
          bullets: ['Danh từ đếm được số ít', 'Âm đầu là phụ âm', 'Nhắc lần đầu'],
          example: 'a bottle, a useful bag',
        },
        {
          title: 'AN',
          accent: 'pink',
          bullets: [
            'Danh từ đếm được số ít',
            'Âm đầu là nguyên âm',
            'Dựa vào âm, không chỉ chữ viết',
          ],
          example: 'an apple, an hour',
        },
        {
          title: 'THE',
          accent: 'blue',
          bullets: ['Vật đã xác định', 'Nhắc lần thứ hai', 'Vật duy nhất'],
          example: 'The sun gives us energy.',
        },
        {
          title: 'Ghi nhớ',
          accent: 'green',
          bullets: [
            'a/an = một',
            'the = cái/ người đã biết',
            'Không dùng a/an với danh từ số nhiều',
          ],
        },
      ],
    },
    {
      id: 's5',
      title: 'Zero Article',
      subtitle: 'Có những trường hợp không dùng a, an hoặc the.',
      layout: 'cards',
      cards: [
        {
          title: 'Số nhiều nói chung',
          accent: 'green',
          content: 'Trees are important for our planet.',
        },
        {
          title: 'Không đếm được nói chung',
          accent: 'blue',
          content: 'Water is essential for life.',
        },
        {
          title: 'Tên riêng',
          accent: 'purple',
          bullets: ['Viet Nam', 'Ha Noi', 'Asia'],
        },
        {
          title: 'Thể thao',
          accent: 'orange',
          bullets: ['football', 'swimming', 'badminton'],
          example: 'We play football after school.',
        },
      ],
    },
    {
      id: 's6',
      title: 'Lỗi mạo từ thường gặp',
      subtitle: 'Kiểm tra số ít, số nhiều và âm đầu trước khi chọn mạo từ.',
      layout: 'cards',
      cards: [
        {
          title: 'A + số nhiều',
          accent: 'red',
          bullets: ['Không nói: a trees', 'Đúng: a tree / trees'],
        },
        {
          title: 'An useful',
          accent: 'orange',
          bullets: ['Sai vì useful bắt đầu bằng âm /ju:/', 'Đúng: a useful tip'],
        },
        {
          title: 'The + tên nước',
          accent: 'blue',
          bullets: ['Không nói: the Viet Nam', 'Đúng: Viet Nam'],
        },
      ],
    },
    {
      id: 's7',
      title: 'FIRST CONDITIONAL',
      subtitle: 'Câu điều kiện loại 1',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's8',
      title: 'First Conditional: công thức',
      subtitle: 'Nói về điều có thể xảy ra ở hiện tại hoặc tương lai.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'If ở đầu câu',
          accent: 'blue',
          content: [
            { text: 'If + S + V(s/es), ' },
            { text: 'S + will + V', accent: 'blue', bold: true },
          ],
          example: 'If we recycle more, we will reduce waste.',
        },
        {
          title: 'If ở giữa câu',
          accent: 'green',
          content: [
            { text: 'S + will + V + if + S + ' },
            { text: 'V(s/es)', accent: 'green', bold: true },
          ],
          example: 'We will save water if we take shorter showers.',
        },
        {
          title: 'Dấu phẩy',
          accent: 'orange',
          bullets: ['If đứng đầu câu: dùng dấu phẩy.', 'If đứng giữa câu: không cần dấu phẩy.'],
        },
      ],
    },
    {
      id: 's9',
      title: 'Mở rộng câu điều kiện',
      subtitle: 'Mệnh đề chính có thể dùng modal khác thay cho will.',
      layout: 'cards',
      cards: [
        {
          title: 'Can / May / Might',
          accent: 'blue',
          bullets: ['Diễn tả khả năng hoặc sự cho phép'],
          example: 'If we plant trees, birds can live there.',
        },
        {
          title: 'Should / Must',
          accent: 'purple',
          bullets: ['Đưa lời khuyên hoặc quy định'],
          example: 'If you see rubbish, you should pick it up.',
        },
        {
          title: 'Unless',
          accent: 'orange',
          bullets: ['unless = if not'],
          example: 'Unless we act now, pollution will get worse.',
        },
        {
          title: 'Lỗi cần tránh',
          accent: 'red',
          bullets: ['Không dùng will trong mệnh đề if.', 'Đúng: If it rains, we will stay home.'],
        },
      ],
    },
    {
      id: 's10',
      title: 'Green Vocabulary',
      subtitle: 'Từ vựng trọng tâm Unit 11.',
      layout: 'cards',
      cards: [
        {
          title: 'Problems',
          accent: 'red',
          bullets: ['pollution', 'deforestation', 'climate change', 'plastic waste'],
        },
        {
          title: 'Actions',
          accent: 'green',
          bullets: ['recycle', 'reuse', 'reduce', 'plant trees'],
        },
        {
          title: 'Save resources',
          accent: 'blue',
          bullets: ['save water', 'save energy', 'use eco-bags', 'pick up rubbish'],
        },
        {
          title: 'Adjectives',
          accent: 'purple',
          bullets: ['green', 'eco-friendly', 'renewable', 'reusable'],
        },
      ],
    },
    {
      id: 's11',
      title: 'Luyện tập nhanh',
      subtitle: 'Hoàn thành câu với mạo từ hoặc dạng điều kiện đúng.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'We should use _____ reusable bag.' },
        { content: '_____ water is important for all living things.' },
        { content: 'If people recycle more, they _____ reduce waste.' },
        { content: 'Unless we save energy, the problem _____ get worse.' },
      ],
      examples: ['a', 'Zero article', 'will', 'will'],
    },
    {
      id: 's12',
      title: 'Unit 11 Recap',
      subtitle: 'Our Greener World',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'A/an dùng cho danh từ đếm được số ít và nhắc lần đầu.' },
        { content: 'The dùng khi danh từ đã xác định, được nhắc lại hoặc là duy nhất.' },
        { content: 'Zero article dùng với danh từ số nhiều hoặc không đếm được nói chung.' },
        { content: 'First Conditional: If + Present Simple, will + V.' },
      ],
      examples: ['If we plant trees, our school will be greener.'],
    },
  ],
};

export default deck;

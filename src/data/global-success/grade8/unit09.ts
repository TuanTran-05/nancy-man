import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g8-u9-natural-disasters',
  curriculumFamily: 'global-success',
  grade: 8,
  unitNumber: 9,
  title: 'Grammar Grade 8 - Unit 9: Natural Disasters',
  description:
    'Bài giảng Unit 9 Global Success 8 về Past Continuous, when/while, kết hợp Past Continuous với Past Simple và từ vựng Natural Disasters.',
  createdAt: '2026-05-15T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 8',
      subtitle: 'UNIT 9: NATURAL DISASTERS',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'THE PAST CONTINUOUS',
          subtitle: '(Thì quá khứ tiếp diễn)',
          accent: 'orange',
        },
        {
          title: 'WHEN & WHILE',
          subtitle: '(Hành động xen vào / song song)',
          accent: 'pink',
        },
        {
          title: 'PAST CONTINUOUS + PAST SIMPLE',
          subtitle: '(Kể chuyện thiên tai)',
          accent: 'blue',
        },
        {
          title: 'VOCABULARY & PRACTICE',
          subtitle: '(Natural Disasters)',
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
            { text: 'Nắm công thức ' },
            { text: 'was/were + V-ing', accent: 'orange', bold: true },
            { text: ' của Past Continuous' },
          ],
        },
        {
          content: [
            { text: 'Biết dùng Past Continuous để mô tả ' },
            { text: 'hành động đang xảy ra', accent: 'blue', bold: true },
            { text: ' trong quá khứ' },
          ],
        },
        {
          content: [
            { text: 'Phân biệt ' },
            { text: 'when', accent: 'pink', bold: true },
            { text: ' và ' },
            { text: 'while', accent: 'green', bold: true },
            { text: ' trong câu kể chuyện' },
          ],
        },
        {
          content: 'Dùng từ vựng thiên tai để đặt câu và kể lại một sự kiện quá khứ.',
        },
      ],
    },
    {
      id: 's3',
      title: 'THE PAST CONTINUOUS',
      subtitle: 'Thì quá khứ tiếp diễn',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Past Continuous: Công thức',
      subtitle: 'Diễn tả hành động đang xảy ra tại một thời điểm trong quá khứ.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: 'S + was/were + V-ing',
          example: 'People were running to safety.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: 'S + was not / were not + V-ing',
          example: "She wasn't sleeping when the earthquake hit.",
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: 'Was/Were + S + V-ing?',
          example: 'Were they evacuating the village?',
        },
        {
          title: 'Was / Were',
          accent: 'purple',
          bullets: ['I / He / She / It → was', 'We / You / They → were'],
        },
      ],
    },
    {
      id: 's5',
      title: 'Quy tắc thêm -ing',
      subtitle: 'Nhớ spelling rules để viết đúng dạng V-ing.',
      layout: 'cards',
      accent: 'green',
      cards: [
        {
          title: 'Thông thường',
          accent: 'green',
          content: '+ ing',
          example: 'rain → raining, warn → warning',
        },
        {
          title: 'Tận cùng -e câm',
          accent: 'orange',
          content: 'Bỏ e + ing',
          example: 'shake → shaking, evacuate → evacuating',
        },
        {
          title: '1 nguyên âm + 1 phụ âm',
          accent: 'pink',
          content: 'Gấp đôi phụ âm + ing',
          example: 'run → running, hit → hitting',
        },
        {
          title: 'Tận cùng -ie',
          accent: 'blue',
          content: 'Đổi ie thành y + ing',
          example: 'die → dying, lie → lying',
        },
      ],
    },
    {
      id: 's6',
      title: 'Cách dùng chính',
      subtitle: 'Past Continuous thường xuất hiện trong kể chuyện quá khứ.',
      layout: 'cards',
      accent: 'blue',
      cards: [
        {
          title: 'At + time',
          accent: 'blue',
          content: 'Hành động đang xảy ra tại thời điểm cụ thể.',
          example: 'At 2 PM yesterday, rescue workers were searching for survivors.',
        },
        {
          title: 'Interrupted action',
          accent: 'orange',
          content: 'Hành động đang diễn ra thì hành động ngắn xen vào.',
          example: 'People were sleeping when the earthquake struck.',
        },
        {
          title: 'Parallel actions',
          accent: 'green',
          content: 'Hai hành động đang diễn ra song song.',
          example: 'While volunteers were distributing food, doctors were treating victims.',
        },
        {
          title: 'Background',
          accent: 'purple',
          content: 'Mô tả bối cảnh cho câu chuyện.',
          example: 'It was raining and the wind was howling.',
        },
      ],
    },
    {
      id: 's7',
      title: 'WHEN & WHILE',
      subtitle: 'Cách chọn liên từ trong Past Continuous.',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's8',
      title: 'When vs While',
      subtitle: 'Mẹo nhớ: WHEN là điểm, WHILE là đường.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'WHEN',
          accent: 'orange',
          content: 'Theo sau thường là hành động ngắn, tức thì.',
          example: 'When the earthquake hit, people were running outside.',
        },
        {
          title: 'WHILE',
          accent: 'green',
          content: 'Theo sau thường là hành động kéo dài.',
          example: 'While the storm was raging, the rescue team arrived.',
        },
        {
          title: 'Past Continuous + when',
          accent: 'blue',
          content: 'S + was/were + V-ing + when + S + V2',
          example: 'She was cooking when the earthquake struck.',
        },
        {
          title: 'While + Past Continuous',
          accent: 'purple',
          content: 'While + S + was/were + V-ing, S + V2',
          example: 'While it was flooding, we called for help.',
        },
      ],
    },
    {
      id: 's9',
      title: 'Dấu hiệu & lỗi thường gặp',
      subtitle: 'Nhìn dấu hiệu để chọn đúng thì.',
      layout: 'cards',
      accent: 'red',
      cards: [
        {
          title: 'Signal words',
          accent: 'blue',
          bullets: [
            'when',
            'while',
            'at that moment',
            'at 10 PM last night',
            'this time yesterday',
          ],
        },
        {
          title: 'Quên was/were',
          accent: 'red',
          content: 'Sai: People running to safety.',
          example: 'Đúng: People were running to safety.',
        },
        {
          title: 'While + Past Simple',
          accent: 'orange',
          content: 'Sau while thường dùng hành động kéo dài.',
          example: 'While the rain was pouring down, rescue workers arrived.',
        },
        {
          title: 'Stative verbs',
          accent: 'purple',
          content: 'love, know, believe, want, own... thường không dùng -ing.',
        },
      ],
    },
    {
      id: 's10',
      title: 'Natural Disasters Vocabulary',
      subtitle: 'Từ vựng dùng để kể chuyện thiên tai.',
      layout: 'cards',
      accent: 'green',
      cards: [
        {
          title: 'Types',
          accent: 'blue',
          bullets: ['earthquake', 'flood', 'tsunami', 'typhoon', 'tornado', 'wildfire'],
        },
        {
          title: 'Actions',
          accent: 'orange',
          bullets: ['strike / hit', 'evacuate', 'rescue', 'shelter', 'warn', 'flee'],
        },
        {
          title: 'People & response',
          accent: 'green',
          bullets: ['victim', 'survivor', 'rescue team', 'emergency', 'relief supplies'],
        },
        {
          title: 'Descriptions',
          accent: 'pink',
          bullets: ['devastating', 'powerful', 'deadly', 'sudden', 'severe', 'widespread'],
        },
      ],
    },
    {
      id: 's11',
      title: 'Practice',
      subtitle: 'Chia động từ ở Past Continuous hoặc Past Simple.',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'People _____ TV when the earthquake _____. (watch / hit)' },
        { content: 'While the storm _____, the rescue team _____. (rage / arrive)' },
        { content: 'At 6 AM, emergency teams _____ food. (distribute)' },
        { content: 'The floodwaters _____ rapidly when we _____. (rise / leave)' },
      ],
      examples: [
        'were watching / hit',
        'was raging / arrived',
        'were distributing',
        'were rising / left',
      ],
    },
    {
      id: 's12',
      title: 'Tổng kết Unit 9',
      subtitle: 'Kể chuyện thiên tai bằng Past Continuous.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        {
          content: [{ text: 'Form: ' }, { text: 'was/were + V-ing', accent: 'orange', bold: true }],
        },
        {
          content: [
            { text: 'WHEN + ' },
            { text: 'Past Simple', accent: 'pink', bold: true },
            { text: ' cho hành động ngắn xen vào' },
          ],
        },
        {
          content: [
            { text: 'WHILE + ' },
            { text: 'Past Continuous', accent: 'blue', bold: true },
            { text: ' cho hành động kéo dài/song song' },
          ],
        },
        { content: 'Dùng Past Continuous để tạo bối cảnh trước sự kiện chính.' },
      ],
      examples: ['was/were', 'V-ing', 'when', 'while'],
    },
  ],
};

export default deck;

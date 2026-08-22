import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g7-u3-community-service',
  curriculumFamily: 'global-success',
  grade: 7,
  unitNumber: 3,
  title: 'Grammar Grade 7 - Unit 3: Community Service',
  description:
    'Bài giảng Unit 3 Global Success 7 về Past Simple Tense và từ vựng Community Service.',
  createdAt: '2026-05-17T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 7',
      subtitle: 'UNIT 3: COMMUNITY SERVICE',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'PAST SIMPLE TENSE',
          subtitle: '(Thì quá khứ đơn)',
          accent: 'orange',
        },
        {
          title: 'VERB FORMS',
          subtitle: '(Regular / Irregular verbs)',
          accent: 'pink',
        },
        {
          title: 'QUESTION FORMS',
          subtitle: '(Did / Wh-questions)',
          accent: 'blue',
        },
        {
          title: 'COMMUNITY SERVICE',
          subtitle: '(Từ vựng và giao tiếp)',
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
            { text: 'Past Simple', accent: 'orange', bold: true },
            { text: ' để kể hoạt động đã xảy ra và kết thúc trong quá khứ.' },
          ],
        },
        {
          content:
            'Phân biệt was / were, động từ có quy tắc, động từ bất quy tắc và các dấu hiệu thời gian quá khứ.',
        },
        {
          content: 'Đặt câu phủ định, câu hỏi Did và Wh-question đúng với động từ nguyên mẫu.',
        },
        {
          content: 'Nói về hoạt động tình nguyện đã làm bằng từ vựng Community Service.',
        },
      ],
    },
    {
      id: 's3',
      title: 'PAST SIMPLE TENSE',
      subtitle: 'Thì quá khứ đơn',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Past Simple với be',
      subtitle: 'Dùng was / were khi câu không có động từ hành động chính.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: 'S + was / were + ...',
          example: 'I was at the community centre.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: 'S + was not / were not + ...',
          example: 'She was not at the charity event.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: 'Was / Were + S + ...?',
          example: 'Were you a volunteer last summer?',
        },
        {
          title: 'Was / Were',
          accent: 'purple',
          bullets: ['I / he / she / it -> was', 'we / you / they -> were'],
        },
      ],
    },
    {
      id: 's5',
      title: 'Past Simple với động từ thường',
      subtitle: 'Khẳng định dùng V2/ed; did đưa động từ về nguyên mẫu.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: 'S + V2 / V-ed + ...',
          example: 'We helped poor children.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: 'S + did not + V nguyên mẫu',
          example: 'They did not collect rubbish.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: 'Did + S + V nguyên mẫu?',
          example: 'Did you donate clothes?',
        },
      ],
      examples: ['Yes, we did.', 'No, she did not.'],
    },
    {
      id: 's6',
      title: 'Cách dùng và dấu hiệu',
      subtitle: 'Past Simple thường đi cùng thời gian trong quá khứ.',
      layout: 'cards',
      cards: [
        {
          title: 'Hành động đã kết thúc',
          accent: 'orange',
          bullets: ['planted trees last Sunday', 'helped homeless people yesterday'],
        },
        {
          title: 'Chuỗi hoạt động',
          accent: 'pink',
          bullets: ['collected rubbish', 'cleaned the park', 'watered flowers'],
        },
        {
          title: 'Dấu hiệu',
          accent: 'blue',
          bullets: ['yesterday', 'last week', 'two years ago', 'in 2020'],
        },
        {
          title: 'Trải nghiệm',
          accent: 'green',
          bullets: ['joined a club', 'raised money', 'cooked meals'],
        },
      ],
    },
    {
      id: 's7',
      title: 'Regular Verbs',
      subtitle: 'Động từ có quy tắc thường thêm -ed.',
      layout: 'cards',
      cards: [
        {
          title: 'Thông thường',
          accent: 'orange',
          bullets: ['help -> helped', 'clean -> cleaned', 'collect -> collected'],
        },
        {
          title: 'Kết thúc bằng -e',
          accent: 'pink',
          bullets: ['donate -> donated', 'volunteer -> volunteered'],
        },
        {
          title: 'Phụ âm + y',
          accent: 'blue',
          bullets: ['study -> studied'],
        },
        {
          title: '1 nguyên âm + 1 phụ âm',
          accent: 'green',
          bullets: ['stop -> stopped'],
        },
      ],
    },
    {
      id: 's8',
      title: 'Irregular Verbs',
      subtitle: 'Những động từ này cần học thuộc dạng quá khứ riêng.',
      layout: 'cards',
      cards: [
        {
          title: 'Common verbs',
          accent: 'orange',
          bullets: ['go -> went', 'do -> did', 'have -> had', 'give -> gave'],
        },
        {
          title: 'Service actions',
          accent: 'pink',
          bullets: ['buy -> bought', 'bring -> brought', 'teach -> taught'],
        },
        {
          title: 'More verbs',
          accent: 'blue',
          bullets: ['take -> took', 'meet -> met', 'spend -> spent'],
        },
      ],
    },
    {
      id: 's9',
      title: 'Phát âm đuôi -ed',
      subtitle: 'Đuôi -ed có ba cách phát âm chính.',
      layout: 'cards',
      cards: [
        {
          title: '/t/',
          accent: 'orange',
          bullets: ['helped', 'cooked', 'washed'],
        },
        {
          title: '/d/',
          accent: 'blue',
          bullets: ['cleaned', 'played', 'joined'],
        },
        {
          title: '/id/',
          accent: 'green',
          bullets: ['wanted', 'needed', 'visited'],
        },
      ],
    },
    {
      id: 's10',
      title: 'Did và Wh-questions',
      subtitle: 'Sau did, động từ chính luôn trở về nguyên mẫu.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'Yes / No question',
          accent: 'blue',
          content: 'Did + S + V nguyên mẫu?',
          example: 'Did they collect rubbish yesterday?',
        },
        {
          title: 'Wh-question',
          accent: 'green',
          content: 'Wh-word + did + S + V nguyên mẫu?',
          example: 'What did you do last weekend?',
        },
        {
          title: 'Ví dụ trả lời',
          accent: 'orange',
          bullets: [
            'Where did they volunteer? - At a nursing home.',
            'Who did you help? - Poor children.',
          ],
        },
      ],
    },
    {
      id: 's11',
      title: 'Present Simple vs Past Simple',
      subtitle: 'Nhìn thời gian và trợ động từ để chọn đúng thì.',
      layout: 'cards',
      cards: [
        {
          title: 'Present Simple',
          accent: 'green',
          bullets: ['every day', 'usually', 'do / does'],
          example: 'I help poor children every summer.',
        },
        {
          title: 'Past Simple',
          accent: 'orange',
          bullets: ['yesterday', 'last week', 'ago', 'did'],
          example: 'I helped poor children last summer.',
        },
        {
          title: 'Khác nhau',
          accent: 'blue',
          bullets: ['V / V-s-es vs V2/ed', 'do/does vs did'],
        },
      ],
    },
    {
      id: 's12',
      title: 'Lỗi thường gặp',
      subtitle: 'Câu quá khứ thường sai ở did và động từ bất quy tắc.',
      layout: 'cards',
      cards: [
        {
          title: 'Khẳng định',
          accent: 'red',
          bullets: ['Sai: We clean yesterday.', 'Đúng: We cleaned yesterday.'],
        },
        {
          title: 'Sau did not',
          accent: 'orange',
          bullets: ['Sai: She did not visited.', 'Đúng: She did not visit.'],
        },
        {
          title: 'Sau Did',
          accent: 'blue',
          bullets: ['Sai: Did you helped?', 'Đúng: Did you help?'],
        },
        {
          title: 'Irregular verbs',
          accent: 'green',
          bullets: ['goed -> went', 'gived -> gave'],
        },
      ],
    },
    {
      id: 's13',
      title: 'COMMUNITY SERVICE',
      subtitle: 'Từ vựng chủ đề dịch vụ cộng đồng',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's14',
      title: 'Volunteer Activities',
      subtitle: 'Những việc tốt thường kể bằng Past Simple.',
      layout: 'cards',
      cards: [
        {
          title: 'Helping people',
          accent: 'orange',
          bullets: ['help poor children', 'visit old people', 'give food'],
        },
        {
          title: 'Cleaning & nature',
          accent: 'pink',
          bullets: ['clean the park', 'collect rubbish', 'plant trees'],
        },
        {
          title: 'Donating',
          accent: 'blue',
          bullets: ['donate books', 'donate clothes', 'raise money'],
        },
        {
          title: 'Other actions',
          accent: 'green',
          bullets: ['cook meals', 'recycle bottles', 'tutor children'],
        },
      ],
    },
    {
      id: 's15',
      title: 'Places and People',
      subtitle: 'Nơi làm tình nguyện và người nhận giúp đỡ.',
      layout: 'cards',
      cards: [
        {
          title: 'Places',
          accent: 'blue',
          bullets: ['nursing home', 'orphanage', 'hospital', 'community centre'],
        },
        {
          title: 'More places',
          accent: 'purple',
          bullets: ['school yard', 'park', 'beach', 'charity shop'],
        },
        {
          title: 'People',
          accent: 'orange',
          bullets: ['poor children', 'homeless people', 'elderly people', 'people in need'],
        },
      ],
    },
    {
      id: 's16',
      title: 'Giao tiếp về hoạt động đã làm',
      subtitle: 'Các mẫu câu hay dùng trong Unit 3.',
      layout: 'explain',
      accent: 'purple',
      sections: [
        {
          title: 'Hỏi đã làm gì',
          accent: 'orange',
          content: 'What did + S + do + time expression?',
          example: 'What did your class do last weekend?',
        },
        {
          title: 'Hỏi có làm không',
          accent: 'pink',
          content: 'Did + S + V nguyên mẫu + ...?',
          example: 'Did you donate books?',
        },
        {
          title: 'Kể hoạt động',
          accent: 'blue',
          content: 'S + V2/ed + object + time expression',
          example: 'We cleaned the beach last Sunday.',
        },
      ],
    },
    {
      id: 's17',
      title: 'Luyện tập nhanh',
      subtitle: 'Hoàn thành câu với dạng quá khứ đúng.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'We _____ the park yesterday. (clean)' },
        { content: 'They _____ food to homeless people. (give)' },
        { content: 'She did not _____ clothes last month. (donate)' },
        { content: 'What did your class _____ last weekend? (do)' },
      ],
      examples: ['cleaned', 'gave', 'donate', 'do'],
    },
    {
      id: 's18',
      title: 'Unit 3 Recap',
      subtitle: 'Community Service',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Past Simple kể việc đã xảy ra và kết thúc trong quá khứ.' },
        { content: 'Khẳng định dùng V2/ed; did not và Did đi với V nguyên mẫu.' },
        { content: 'Was / were dùng cho động từ be trong quá khứ.' },
        { content: 'Từ vựng community service giúp kể lại hoạt động tình nguyện.' },
      ],
      examples: [
        'We visited old people last weekend.',
        'Did you collect rubbish yesterday?',
        'What did your class do last Sunday?',
      ],
    },
  ],
};

export default deck;

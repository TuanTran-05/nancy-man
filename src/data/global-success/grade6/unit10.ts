import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g6-u10-houses-future',
  curriculumFamily: 'global-success',
  grade: 6,
  unitNumber: 10,
  title: 'Grammar Grade 6 - Unit 10: Our Houses in the Future',
  description:
    'Bài giảng Unit 10 Global Success 6 về Future Simple with will, might và từ vựng nhà trong tương lai.',
  createdAt: '2026-05-16T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 6',
      subtitle: 'UNIT 10: OUR HOUSES IN THE FUTURE',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'FUTURE SIMPLE',
          subtitle: '(will + V)',
          accent: 'orange',
        },
        {
          title: 'MIGHT',
          subtitle: '(khả năng trong tương lai)',
          accent: 'pink',
        },
        {
          title: 'FUTURE HOUSES',
          subtitle: '(từ vựng nhà tương lai)',
          accent: 'blue',
        },
        {
          title: 'SPEAKING & WRITING',
          subtitle: '(mô tả ngôi nhà mơ ước)',
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
            { text: 'will + V', accent: 'orange', bold: true },
            { text: ' để dự đoán hoặc nói quyết định trong tương lai.' },
          ],
        },
        {
          content: [
            { text: 'Dùng ' },
            { text: 'might + V', accent: 'pink', bold: true },
            { text: ' để nói điều có thể xảy ra.' },
          ],
        },
        {
          content: 'Hỏi và trả lời về vị trí, kiểu nhà và thiết bị của ngôi nhà trong tương lai.',
        },
        {
          content: 'Viết đoạn văn ngắn về ngôi nhà mơ ước bằng will và might.',
        },
      ],
    },
    {
      id: 's3',
      title: 'FUTURE SIMPLE WITH WILL',
      subtitle: 'Thì tương lai đơn với will',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Will: cấu trúc cơ bản',
      subtitle: 'Sau will luôn dùng động từ nguyên mẫu.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: [{ text: 'S + ' }, { text: 'will + V', accent: 'green', bold: true }],
          example: 'My future house will have a smart kitchen.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: [{ text: 'S + ' }, { text: 'will not + V', accent: 'red', bold: true }],
          example: 'People will not use much electricity.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: [
            { text: 'Will + S + ' },
            { text: 'V', accent: 'blue', bold: true },
            { text: '?' },
          ],
          example: 'Will robots do the housework?',
        },
      ],
      examples: ['Yes, they will.', 'No, they will not.'],
    },
    {
      id: 's5',
      title: 'Cách dùng và dấu hiệu',
      subtitle: 'Will thường đi với các cụm chỉ tương lai.',
      layout: 'cards',
      cards: [
        {
          title: 'Dự đoán',
          accent: 'orange',
          bullets: ['in the future', 'in 2050', 'one day', 'someday'],
          example: 'People will live in smart homes.',
        },
        {
          title: 'Quyết định nhanh',
          accent: 'blue',
          bullets: ['Dùng khi vừa quyết định tại lúc nói.'],
          example: 'I will design a robot room.',
        },
        {
          title: 'Lời hứa',
          accent: 'green',
          bullets: ['Dùng để hứa làm việc gì đó.'],
          example: 'I will save energy at home.',
        },
        {
          title: 'Will vs going to',
          accent: 'purple',
          bullets: ['will: dự đoán chung', 'going to: có kế hoạch hoặc bằng chứng'],
        },
      ],
    },
    {
      id: 's6',
      title: 'MIGHT',
      subtitle: 'Nói điều có thể xảy ra',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's7',
      title: 'Might: khả năng không chắc chắn',
      subtitle: 'Might yếu hơn will vì người nói chưa chắc chắn.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'pink',
          content: [{ text: 'S + ' }, { text: 'might + V', accent: 'pink', bold: true }],
          example: 'We might live in floating houses.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: [{ text: 'S + ' }, { text: 'might not + V', accent: 'red', bold: true }],
          example: 'People might not live on Mars.',
        },
        {
          title: 'Mức độ chắc chắn',
          accent: 'blue',
          bullets: ['will: gần như chắc chắn', 'might: có thể', 'will not: không xảy ra'],
        },
      ],
    },
    {
      id: 's8',
      title: 'Future House Vocabulary',
      subtitle: 'Từ vựng để mô tả ngôi nhà trong tương lai.',
      layout: 'cards',
      cards: [
        {
          title: 'Types of houses',
          accent: 'blue',
          bullets: ['smart house', 'eco-house', 'floating house', 'space house'],
        },
        {
          title: 'Devices',
          accent: 'orange',
          bullets: ['solar panel', 'robot', 'smart wall', 'voice control'],
        },
        {
          title: 'Verbs',
          accent: 'green',
          bullets: ['live in', 'design', 'control', 'save energy'],
        },
        {
          title: 'Adjectives',
          accent: 'purple',
          bullets: ['smart', 'eco-friendly', 'automated', 'sustainable'],
        },
      ],
    },
    {
      id: 's9',
      title: 'Hỏi đáp về nhà tương lai',
      subtitle: 'Dùng will và might để hỏi ý kiến hoặc dự đoán.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'Hỏi về hình dáng',
          accent: 'blue',
          content: 'What will houses look like in the future?',
          example: 'They will be smart and eco-friendly.',
        },
        {
          title: 'Hỏi về nơi sống',
          accent: 'green',
          content: 'Where will people live in 2100?',
          example: 'They might live under the sea.',
        },
        {
          title: 'Hỏi về robot',
          accent: 'orange',
          content: 'Will robots do the housework?',
          example: 'Yes, they will.',
        },
      ],
    },
    {
      id: 's10',
      title: 'Luyện tập nhanh',
      subtitle: 'Hoàn thành câu với will hoặc might.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'My house _____ have solar panels in the future.' },
        { content: '_____ robots clean our rooms?' },
        { content: 'People _____ live on Mars, but we are not sure.' },
        { content: 'I think houses _____ use less energy.' },
      ],
      examples: ['will', 'Will', 'might', 'will'],
    },
    {
      id: 's11',
      title: 'Unit 10 Recap',
      subtitle: 'Our Houses in the Future',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Will + V dùng cho dự đoán, quyết định nhanh và lời hứa.' },
        { content: 'Might + V dùng cho điều có thể xảy ra nhưng chưa chắc chắn.' },
        { content: 'Từ vựng Unit 10 giúp mô tả kiểu nhà, thiết bị và chức năng.' },
        { content: 'Khi viết đoạn văn, kết hợp: My future house will... It might...' },
      ],
      examples: ['It will be an eco-house.', 'It might have a robot helper.'],
    },
  ],
};

export default deck;

import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g8-u6-lifestyles',
  curriculumFamily: 'global-success',
  grade: 8,
  unitNumber: 6,
  title: 'Grammar Grade 8 - Unit 6: Lifestyles',
  description:
    'Bài giảng Unit 6 Global Success 8 về Present Simple, frequency questions, prefer, opinion verbs, will vs be going to và từ vựng lifestyles.',
  createdAt: '2026-05-15T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 8',
      subtitle: 'UNIT 6: LIFESTYLES',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'PRESENT SIMPLE & FREQUENCY',
          subtitle: '(Thói quen và tần suất)',
          accent: 'orange',
        },
        {
          title: 'PREFER... TO...',
          subtitle: '(Diễn tả sở thích)',
          accent: 'pink',
        },
        {
          title: 'OPINION VERBS',
          subtitle: '(think, believe, feel...)',
          accent: 'blue',
        },
        {
          title: 'WILL vs BE GOING TO',
          subtitle: '(Tương lai đơn và tương lai gần)',
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
            { text: 'Ôn tập ' },
            { text: 'Present Simple', accent: 'orange', bold: true },
            { text: ' để nói về lối sống và thói quen' },
          ],
        },
        {
          content: 'Hỏi và trả lời về tần suất bằng How often.',
        },
        {
          content: [
            { text: 'Dùng ' },
            { text: 'prefer... to...', accent: 'pink', bold: true },
            { text: ' để so sánh sở thích' },
          ],
        },
        {
          content: 'Phân biệt will và be going to trong kế hoạch/dự đoán.',
        },
      ],
    },
    {
      id: 's3',
      title: 'PRESENT SIMPLE',
      subtitle: 'Thói quen, sự thật và lối sống',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Present Simple: Công thức',
      subtitle: 'Dùng với thói quen, lịch trình, sự thật chung.',
      layout: 'cards',
      accent: 'orange',
      cards: [
        {
          title: 'Động từ thường',
          accent: 'blue',
          content: 'S + V(s/es)',
          example: 'She lives in the city.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: 'S + do/does not + V',
          example: "He doesn't like fast food.",
        },
        {
          title: 'Nghi vấn',
          accent: 'green',
          content: 'Do/Does + S + V?',
          example: 'Do you exercise every day?',
        },
        {
          title: 'To be',
          accent: 'purple',
          content: 'S + am/is/are + ...',
          example: 'She is healthy.',
        },
      ],
    },
    {
      id: 's5',
      title: 'Frequency Questions',
      subtitle: 'Hỏi thói quen xảy ra thường xuyên như thế nào.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'How often?',
          accent: 'blue',
          content: 'How often + do/does + S + V?',
          example: 'How often do you read books?',
        },
        {
          title: 'Trạng từ tần suất',
          accent: 'orange',
          content: 'always, usually, often, sometimes, rarely, never',
        },
        {
          title: 'Cụm từ tần suất',
          accent: 'green',
          content: 'every day, twice a week, once a month',
        },
        {
          title: 'Số lần cụ thể',
          accent: 'purple',
          content: 'three times a week, four times a month',
        },
      ],
    },
    {
      id: 's6',
      title: 'PREFER... TO...',
      subtitle: 'Ưa thích cái gì hơn cái gì',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's7',
      title: 'Prefer Structures',
      subtitle: 'Chọn cấu trúc theo loại từ theo sau.',
      layout: 'cards',
      accent: 'pink',
      cards: [
        {
          title: 'Noun + to + noun',
          accent: 'pink',
          content: 'S + prefer + N1 + to + N2',
          example: 'I prefer tea to coffee.',
        },
        {
          title: 'V-ing + to + V-ing',
          accent: 'blue',
          content: 'S + prefer + V-ing + to + V-ing',
          example: 'She prefers reading to watching TV.',
        },
        {
          title: 'to V rather than V',
          accent: 'green',
          content: 'S + prefer + to V + rather than + V',
          example: 'He prefers to walk rather than drive.',
        },
        {
          title: 'Similar phrases',
          accent: 'orange',
          bullets: ['like A better than B', 'would rather A than B', 'would prefer to V'],
        },
      ],
    },
    {
      id: 's8',
      title: 'OPINION VERBS',
      subtitle: 'Động từ chỉ ý kiến',
      label: 'Phần 3',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's9',
      title: 'Opinion Verbs',
      subtitle: 'Dùng để nêu quan điểm về lối sống.',
      layout: 'cards',
      accent: 'blue',
      cards: [
        {
          title: 'Common verbs',
          accent: 'blue',
          bullets: ['think', 'believe', 'feel', 'suppose', 'reckon', 'consider'],
        },
        {
          title: 'that-clause',
          accent: 'green',
          content: 'S + V(opinion) + (that) + S + V',
          example: 'I think a healthy lifestyle is important.',
        },
        {
          title: 'O + to be',
          accent: 'orange',
          content: 'S + V(opinion) + O + to be + Adj/N',
          example: 'They consider him to be a role model.',
        },
        {
          title: 'Certainty',
          accent: 'purple',
          bullets: ["I'm sure that...", 'I think that...', "I'm not sure if..."],
        },
      ],
    },
    {
      id: 's10',
      title: 'WILL vs BE GOING TO',
      subtitle: 'Tương lai đơn và tương lai gần',
      label: 'Phần 4',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's11',
      title: 'Future Forms',
      subtitle: 'Chọn will hoặc be going to theo ý nghĩa.',
      layout: 'explain',
      accent: 'green',
      sections: [
        {
          title: 'will',
          accent: 'blue',
          content: 'Quyết định tức thời, lời hứa, dự đoán chủ quan.',
          example: 'I will exercise more next year.',
        },
        {
          title: 'be going to',
          accent: 'green',
          content: 'Kế hoạch đã có trước hoặc dự đoán có bằng chứng.',
          example: 'I am going to start a new diet.',
        },
        {
          title: 'Form: will',
          accent: 'purple',
          content: 'S + will + V / S + will not + V',
        },
        {
          title: 'Form: going to',
          accent: 'orange',
          content: 'S + am/is/are + going to + V',
        },
      ],
    },
    {
      id: 's12',
      title: 'Lifestyle Vocabulary',
      subtitle: 'Từ vựng trọng tâm Unit 6.',
      layout: 'cards',
      accent: 'green',
      cards: [
        {
          title: 'Healthy lifestyle',
          accent: 'green',
          bullets: ['balanced diet', 'nutritious food', 'regular exercise', 'get enough sleep'],
        },
        {
          title: 'Unhealthy habits',
          accent: 'red',
          bullets: ['junk food', 'skip meals', 'stay up late', 'sedentary lifestyle'],
        },
        {
          title: 'Activities',
          accent: 'blue',
          bullets: ['work out', 'warm up', 'jogging', 'cycling', 'meditation'],
        },
        {
          title: 'Modern life',
          accent: 'purple',
          bullets: ['digital detox', 'social media', 'screen time', 'work remotely'],
        },
      ],
    },
    {
      id: 's13',
      title: 'Practice',
      subtitle: 'Hoàn thành câu với cấu trúc phù hợp.',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'How often _____ you exercise? (do/does)' },
        { content: 'She prefers reading _____ watching TV.' },
        { content: 'I think _____ regular exercise helps reduce stress.' },
        { content: 'Look at those clouds! It _____ rain. (will / going to)' },
      ],
      examples: ['do', 'to', 'that', 'is going to'],
    },
  ],
};

export default deck;

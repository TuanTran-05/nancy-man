import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g7-u9-festivals-around-the-world',
  curriculumFamily: 'global-success',
  grade: 7,
  unitNumber: 9,
  title: 'Grammar Grade 7 - Unit 9: Festivals Around the World',
  description:
    'Bài giảng Unit 9 Global Success 7 về Yes / No Questions và từ vựng chủ đề Festivals Around the World.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 7',
      subtitle: 'UNIT 9: FESTIVALS AROUND THE WORLD',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'YES / NO QUESTIONS',
          subtitle: '(Câu hỏi Yes / No)',
          accent: 'orange',
        },
        {
          title: 'FESTIVAL QUESTIONS',
          subtitle: '(Hỏi về lễ hội và hoạt động)',
          accent: 'pink',
        },
        {
          title: 'FESTIVAL VOCABULARY',
          subtitle: '(Từ vựng lễ hội trên thế giới)',
          accent: 'blue',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        { content: 'Nhận biết câu hỏi Yes / No và cách trả lời ngắn.' },
        { content: 'Đặt câu hỏi với to be, Do / Does, Did và modal verbs.' },
        {
          content: 'Dùng đúng trợ động từ trong câu trả lời: do, does, did, be, can, should, will.',
        },
        { content: 'Hỏi và trả lời về lễ hội, hoạt động, trang phục, món ăn và kế hoạch.' },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'Yes / No Questions',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Yes / No Questions là gì?',
      subtitle: 'Dạng câu hỏi mà câu trả lời thường bắt đầu bằng Yes hoặc No.',
      layout: 'cards',
      cards: [
        {
          title: 'To be',
          accent: 'orange',
          content: 'Am / Is / Are / Was / Were + S + ...?',
          example: 'Is the festival exciting?',
        },
        {
          title: 'Present Simple',
          accent: 'blue',
          content: 'Do / Does + S + V nguyên mẫu?',
          example: 'Do you like festivals?',
        },
        {
          title: 'Past Simple',
          accent: 'pink',
          content: 'Did + S + V nguyên mẫu?',
          example: 'Did you watch the fireworks?',
        },
        {
          title: 'Modal verbs',
          accent: 'green',
          content: 'Can / Should / Must / Will + S + V?',
          example: 'Can visitors join the parade?',
        },
      ],
    },
    {
      id: 's5',
      title: 'Câu hỏi với To Be',
      subtitle: 'Dùng Am / Is / Are khi câu có động từ to be.',
      layout: 'cards',
      cards: [
        {
          title: 'I',
          accent: 'orange',
          content: 'Am + I + ...?',
          example: 'Am I ready for the festival?',
        },
        {
          title: 'He / She / It',
          accent: 'pink',
          content: 'Is + he / she / it + ...?',
          example: 'Is Halloween famous in the USA?',
        },
        {
          title: 'You / We / They',
          accent: 'blue',
          content: 'Are + you / we / they + ...?',
          example: 'Are the streets crowded?',
        },
      ],
    },
    {
      id: 's6',
      title: 'Trả lời với To Be',
      subtitle: 'Trả lời ngắn phải dùng lại động từ be.',
      layout: 'cards',
      cards: [
        {
          title: 'Is it...?',
          accent: 'orange',
          content: 'Yes, it is. / No, it is not.',
          example: 'Is Christmas popular? Yes, it is.',
        },
        {
          title: 'Are they...?',
          accent: 'blue',
          content: 'Yes, they are. / No, they are not.',
          example: 'Are the children excited? Yes, they are.',
        },
        {
          title: 'Are you...?',
          accent: 'green',
          content: 'Yes, I am. / No, I am not.',
          example: 'Are you ready? No, I’m not.',
        },
      ],
    },
    {
      id: 's7',
      title: 'Present Simple Questions',
      subtitle: 'Dùng Do / Does để hỏi về thói quen, sở thích hoặc sự thật.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Do / Does + S + V nguyên mẫu + ...?',
      bullets: [
        { content: 'I / You / We / They dùng Do.' },
        { content: 'He / She / It dùng Does.' },
        { content: 'Sau Do / Does, động từ chính luôn ở dạng nguyên mẫu.' },
      ],
      examples: [
        'Do you like festivals?',
        'Do they celebrate Christmas?',
        'Does she enjoy the Mid-Autumn Festival?',
      ],
    },
    {
      id: 's8',
      title: 'Trả lời với Do / Does',
      subtitle: 'Dùng lại đúng trợ động từ trong câu hỏi.',
      layout: 'cards',
      cards: [
        {
          title: 'Do you...?',
          accent: 'orange',
          content: 'Yes, I do. / No, I don’t.',
          example: 'Do you watch fireworks? Yes, I do.',
        },
        {
          title: 'Do they...?',
          accent: 'blue',
          content: 'Yes, they do. / No, they don’t.',
          example: 'Do they eat special food? No, they don’t.',
        },
        {
          title: 'Does she...?',
          accent: 'pink',
          content: 'Yes, she does. / No, she doesn’t.',
          example: 'Does Lan like the lantern festival? Yes, she does.',
        },
      ],
    },
    {
      id: 's9',
      title: 'Past Simple Questions',
      subtitle: 'Dùng Did để hỏi về hoạt động đã xảy ra trong quá khứ.',
      layout: 'explain',
      accent: 'pink',
      formula: 'Did + S + V nguyên mẫu + ...?',
      bullets: [
        { content: 'Dùng với thời gian quá khứ như yesterday, last night, last year.' },
        { content: 'Sau Did, động từ chính phải giữ nguyên.' },
        { content: 'Trả lời ngắn bằng did hoặc didn’t.' },
      ],
      examples: [
        'Did you join the festival last year?',
        'Did they watch the fireworks yesterday?',
        'Did she wear a costume at Halloween?',
      ],
    },
    {
      id: 's10',
      title: 'Trả lời với Did',
      subtitle: 'Không dùng V2/ed trong câu hỏi sau Did.',
      layout: 'cards',
      cards: [
        {
          title: 'Yes',
          accent: 'green',
          content: 'Yes, S + did.',
          example: 'Did you join the parade? Yes, I did.',
        },
        {
          title: 'No',
          accent: 'pink',
          content: 'No, S + didn’t.',
          example: 'Did they celebrate Christmas? No, they didn’t.',
        },
        {
          title: 'Ghi nhớ',
          accent: 'orange',
          content: 'Did + S + V nguyên mẫu',
          example: 'Did you watch fireworks?',
        },
      ],
    },
    {
      id: 's11',
      title: 'Modal Verb Questions',
      subtitle: 'Câu hỏi với can, should, must, will.',
      layout: 'cards',
      cards: [
        {
          title: 'Can',
          accent: 'blue',
          content: 'Can + S + V?',
          example: 'Can children join the parade?',
        },
        {
          title: 'Should',
          accent: 'green',
          content: 'Should + S + V?',
          example: 'Should we arrive early?',
        },
        {
          title: 'Must',
          accent: 'orange',
          content: 'Must + S + V?',
          example: 'Must visitors buy tickets?',
        },
        {
          title: 'Will',
          accent: 'pink',
          content: 'Will + S + V?',
          example: 'Will you go to the festival tomorrow?',
        },
      ],
    },
    {
      id: 's12',
      title: 'Trả lời với Modal Verbs',
      subtitle: 'Dùng lại modal verb trong câu trả lời ngắn.',
      layout: 'cards',
      cards: [
        {
          title: 'Can',
          accent: 'blue',
          content: 'Yes, S + can. / No, S + can’t.',
          example: 'Yes, they can.',
        },
        {
          title: 'Should',
          accent: 'green',
          content: 'Yes, S + should. / No, S + shouldn’t.',
          example: 'Yes, we should.',
        },
        {
          title: 'Must',
          accent: 'orange',
          content: 'Yes, S + must. / No, S + needn’t.',
          example: 'No, they needn’t.',
        },
        {
          title: 'Will',
          accent: 'pink',
          content: 'Yes, S + will. / No, S + won’t.',
          example: 'Yes, I will.',
        },
      ],
    },
    {
      id: 's13',
      title: 'Phần 2',
      subtitle: 'Yes / No Questions in Festivals',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's14',
      title: 'Hỏi về lễ hội',
      subtitle: 'Dùng Yes / No questions để hỏi thông tin chung.',
      layout: 'cards',
      cards: [
        {
          title: 'Festival type',
          accent: 'orange',
          content: 'Is + S + a/an + adjective + festival?',
          example: 'Is Tet a traditional festival in Viet Nam?',
        },
        {
          title: 'Popularity',
          accent: 'blue',
          content: 'Is + festival + popular?',
          example: 'Is Christmas popular around the world?',
        },
        {
          title: 'Importance',
          accent: 'green',
          content: 'Are + festivals + adjective?',
          example: 'Are festivals important in your country?',
        },
      ],
    },
    {
      id: 's15',
      title: 'Hỏi về hoạt động lễ hội',
      subtitle: 'Dùng Do / Does hoặc Can để hỏi việc thường làm.',
      layout: 'cards',
      cards: [
        {
          title: 'Activities',
          accent: 'orange',
          content: 'Do + people + V?',
          example: 'Do people watch fireworks at Tet?',
        },
        {
          title: 'Family',
          accent: 'blue',
          content: 'Does + your family + V?',
          example: 'Does your family decorate the house before Tet?',
        },
        {
          title: 'Visitors',
          accent: 'green',
          content: 'Can + visitors + V?',
          example: 'Can visitors join the parade?',
        },
      ],
    },
    {
      id: 's16',
      title: 'Hỏi về quá khứ và tương lai',
      subtitle: 'Dùng Did cho trải nghiệm cũ, Will cho kế hoạch.',
      layout: 'cards',
      cards: [
        {
          title: 'Past experience',
          accent: 'pink',
          content: 'Did + S + V + time?',
          example: 'Did you join the festival last year?',
        },
        {
          title: 'Past activity',
          accent: 'orange',
          content: 'Did + S + V?',
          example: 'Did she wear a costume at Halloween?',
        },
        {
          title: 'Future plan',
          accent: 'blue',
          content: 'Will + S + V + time?',
          example: 'Will you go to the festival tomorrow?',
        },
      ],
    },
    {
      id: 's17',
      title: 'Lưu ý quan trọng',
      subtitle: 'Những lỗi cần tránh với Yes / No questions.',
      layout: 'cards',
      cards: [
        {
          title: 'Sau Do / Does / Did',
          accent: 'orange',
          content: 'Động từ chính luôn ở dạng nguyên mẫu.',
          example: 'Does she like festivals?',
        },
        {
          title: 'Không dùng Wh-word',
          accent: 'blue',
          content: 'Yes / No questions bắt đầu bằng Is, Are, Do, Does, Did, Can...',
          example: 'Do you like Tet?',
        },
        {
          title: 'Trả lời đúng trợ động từ',
          accent: 'green',
          content: 'Câu hỏi dùng trợ động từ nào, câu trả lời dùng lại trợ động từ đó.',
          example: 'Did you watch fireworks? Yes, I did.',
        },
        {
          title: 'Không nhầm be và do',
          accent: 'pink',
          content: 'Is dùng với to be; Do / Does dùng với động từ thường.',
          example: 'Is Tet important? Yes, it is.',
        },
      ],
    },
    {
      id: 's18',
      title: 'Ví dụ minh họa',
      subtitle: 'Nhìn câu hỏi và chọn cách trả lời đúng.',
      layout: 'cards',
      cards: [
        {
          title: 'Do',
          accent: 'orange',
          content: 'Do + you + V?',
          example: 'Do you like festivals? Yes, I do.',
        },
        {
          title: 'Does',
          accent: 'blue',
          content: 'Does + S + V?',
          example: 'Does Lan enjoy the festival? Yes, she does.',
        },
        {
          title: 'Did',
          accent: 'pink',
          content: 'Did + S + V?',
          example: 'Did you watch fireworks? No, I didn’t.',
        },
        {
          title: 'Can',
          accent: 'green',
          content: 'Can + S + V?',
          example: 'Can visitors join the parade? Yes, they can.',
        },
      ],
    },
    {
      id: 's19',
      title: 'Phần 3',
      subtitle: 'Festivals Around the World',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's20',
      title: 'Các lễ hội phổ biến',
      subtitle: 'Từ vựng trọng tâm của Unit 9.',
      layout: 'cards',
      cards: [
        {
          title: 'Traditional',
          accent: 'orange',
          bullets: ['Tet', 'Mid-Autumn Festival', 'Thanksgiving'],
        },
        {
          title: 'International',
          accent: 'blue',
          bullets: ['Christmas', 'Halloween', 'Easter'],
        },
        {
          title: 'Special festivals',
          accent: 'pink',
          bullets: ['Cannes Film Festival', 'Cheese Rolling Festival'],
        },
        {
          title: 'Time',
          accent: 'green',
          bullets: ['New Year’s Eve', 'last night', 'tomorrow'],
        },
      ],
    },
    {
      id: 's21',
      title: 'Hoạt động trong lễ hội',
      subtitle: 'Dùng với Do / Does / Did / Can để đặt câu hỏi.',
      layout: 'cards',
      cards: [
        {
          title: 'Celebrate',
          accent: 'orange',
          bullets: ['celebrate', 'join a parade', 'have a feast'],
        },
        {
          title: 'Watch & wear',
          accent: 'blue',
          bullets: ['watch fireworks', 'wear costumes', 'carry lanterns'],
        },
        {
          title: 'Family activities',
          accent: 'green',
          bullets: ['decorate the house', 'give presents', 'visit relatives'],
        },
        {
          title: 'Children',
          accent: 'pink',
          bullets: ['receive lucky money', 'eat moon cakes', 'wear masks'],
        },
      ],
    },
    {
      id: 's22',
      title: 'Đồ vật và tính từ lễ hội',
      subtitle: 'Từ vựng giúp mô tả lễ hội rõ hơn.',
      layout: 'cards',
      cards: [
        {
          title: 'Objects',
          accent: 'orange',
          bullets: ['fireworks', 'lantern', 'costume', 'mask'],
        },
        {
          title: 'Food & gifts',
          accent: 'green',
          bullets: ['pumpkin', 'moon cake', 'turkey', 'present'],
        },
        {
          title: 'Adjectives',
          accent: 'blue',
          bullets: ['exciting', 'popular', 'traditional', 'colourful'],
        },
        {
          title: 'Atmosphere',
          accent: 'pink',
          bullets: ['crowded', 'noisy', 'fun', 'unusual'],
        },
      ],
    },
    {
      id: 's23',
      title: 'Cấu trúc giao tiếp',
      subtitle: 'Bốn mẫu câu hỏi thường gặp trong Unit 9.',
      layout: 'cards',
      cards: [
        {
          title: 'Hỏi sở thích',
          accent: 'orange',
          content: 'Do / Does + S + like + festival?',
          example: 'Do you like Tet?',
        },
        {
          title: 'Hỏi đặc điểm',
          accent: 'blue',
          content: 'Is / Are + S + adjective?',
          example: 'Is the festival exciting?',
        },
        {
          title: 'Hỏi quá khứ',
          accent: 'pink',
          content: 'Did + S + V + time expression?',
          example: 'Did you watch fireworks last night?',
        },
        {
          title: 'Hỏi khả năng',
          accent: 'green',
          content: 'Can + S + V?',
          example: 'Can visitors join the festival?',
        },
      ],
    },
    {
      id: 's24',
      title: 'Luyện tập nhanh',
      subtitle: 'Điền trợ động từ phù hợp.',
      layout: 'practice',
      accent: 'orange',
      bullets: [
        { content: '_____ you like festivals?' },
        { content: '_____ Tet an important festival in Viet Nam?' },
        { content: '_____ you watch the fireworks last night?' },
        { content: '_____ visitors join the parade?' },
      ],
      examples: ['Do', 'Is', 'Did', 'Can'],
    },
    {
      id: 's25',
      title: 'Unit 9 Recap',
      subtitle: 'Festivals Around the World',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Yes / No questions thường bắt đầu bằng be, do/does, did hoặc modal verbs.' },
        { content: 'Trả lời ngắn phải dùng lại đúng trợ động từ trong câu hỏi.' },
        { content: 'Sau Do / Does / Did / Can / Should / Will, động từ chính dùng nguyên mẫu.' },
        {
          content:
            'Chủ đề festivals thường hỏi về lễ hội, hoạt động, quá khứ, kế hoạch và khả năng tham gia.',
        },
      ],
      examples: [
        'Do you like Tet? Yes, I do.',
        'Is the festival exciting? Yes, it is.',
        'Did they join the parade? No, they didn’t.',
      ],
    },
  ],
};

export default deck;

import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g7-u7-traffic',
  curriculumFamily: 'global-success',
  grade: 7,
  unitNumber: 7,
  title: 'Grammar Grade 7 - Unit 7: Traffic',
  description:
    'Bài giảng Unit 7 Global Success 7 về cấu trúc It chỉ khoảng cách, How far, should / should not và từ vựng chủ đề Traffic.',
  createdAt: '2026-05-17T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 7',
      subtitle: 'UNIT 7: TRAFFIC',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'IT INDICATING DISTANCE',
          subtitle: '(It dùng để chỉ khoảng cách)',
          accent: 'orange',
        },
        {
          title: 'SHOULD / SHOULD NOT',
          subtitle: '(Nên / Không nên)',
          accent: 'pink',
        },
        {
          title: 'TRAFFIC VOCABULARY',
          subtitle: '(Từ vựng giao thông)',
          accent: 'blue',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        { content: 'Nói và hỏi khoảng cách bằng cấu trúc It is... from... to...' },
        { content: 'Dùng How far để hỏi khoảng cách giữa hai địa điểm.' },
        { content: 'Đưa ra lời khuyên giao thông bằng should / should not.' },
        { content: 'Ghi nhớ từ vựng về phương tiện, biển báo và an toàn giao thông.' },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'It dùng để chỉ khoảng cách',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Công thức chính',
      subtitle: 'It làm chủ ngữ giả để nói khoảng cách.',
      layout: 'explain',
      accent: 'orange',
      formula: 'It is + distance + from + place 1 + to + place 2.',
      bullets: [
        { content: 'from là điểm bắt đầu.' },
        { content: 'to là điểm đến.' },
        { content: 'Có thể thêm about để nói khoảng cách gần đúng.' },
      ],
      examples: [
        'It is 500 metres from my house to the bus stop.',
        'It is about 2 kilometres from my home to school.',
        'It is about 5 kilometres from here to the city centre.',
      ],
    },
    {
      id: 's5',
      title: 'Khẳng định, phủ định, nghi vấn',
      subtitle: 'Ba dạng câu thường gặp với It chỉ khoảng cách.',
      layout: 'cards',
      cards: [
        {
          title: 'Khẳng định',
          accent: 'orange',
          content: 'It is + distance + from A to B.',
          example: 'It is 2 kilometres from my home to school.',
        },
        {
          title: 'Phủ định',
          accent: 'pink',
          content: 'It is not + distance / far + from A to B.',
          example: 'It is not very far from here to the cinema.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: 'Is it + distance / far + from A to B?',
          example: 'Is it far from your house to school?',
        },
        {
          title: 'Trả lời ngắn',
          accent: 'green',
          content: 'Yes, it is. / No, it is not.',
          example: 'No, it is not.',
        },
      ],
    },
    {
      id: 's6',
      title: 'How far',
      subtitle: 'Hỏi khoảng cách bao xa.',
      layout: 'explain',
      accent: 'blue',
      formula: 'How far is it from + place 1 + to + place 2?',
      bullets: [
        { content: 'Dùng How far để hỏi khoảng cách.' },
        { content: 'Câu trả lời có thể chỉ nêu khoảng cách hoặc lặp lại from... to...' },
        { content: 'Nếu không xa, có thể trả lời It is not very far.' },
      ],
      examples: [
        'How far is it from your house to school?',
        'It is about 2 kilometres.',
        'How far is it from here to the bus stop?',
        'It is about 500 metres.',
      ],
    },
    {
      id: 's7',
      title: 'Đơn vị và dấu hiệu thường gặp',
      subtitle: 'Những từ hay đi cùng câu chỉ khoảng cách.',
      layout: 'cards',
      cards: [
        {
          title: 'Đơn vị',
          accent: 'orange',
          bullets: ['metre', 'kilometre', 'mile'],
        },
        {
          title: 'Ước lượng',
          accent: 'pink',
          bullets: ['about', 'nearly', 'more than'],
        },
        {
          title: 'Mẫu cụm',
          accent: 'blue',
          bullets: ['from my house to school', 'from here to the bus stop'],
        },
        {
          title: 'Ví dụ',
          accent: 'green',
          bullets: ['It is nearly 5 kilometres.', 'It is more than 10 kilometres.'],
        },
      ],
    },
    {
      id: 's8',
      title: 'How far hay How long?',
      subtitle: 'Hai câu hỏi này không thay thế cho nhau.',
      layout: 'cards',
      cards: [
        {
          title: 'How far',
          accent: 'orange',
          content: 'Hỏi khoảng cách.',
          example: 'How far is it from your house to school?',
        },
        {
          title: 'How long',
          accent: 'pink',
          content: 'Hỏi thời gian hoặc độ dài.',
          example: 'How long does it take to go to school?',
        },
        {
          title: 'Ghi nhớ',
          accent: 'blue',
          content: 'from A to B = từ A đến B',
          example: 'from Ha Noi to Hai Phong',
        },
      ],
    },
    {
      id: 's9',
      title: 'Phần 2',
      subtitle: 'Should / Should not',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's10',
      title: 'Công thức should',
      subtitle: 'Dùng để đưa ra lời khuyên.',
      layout: 'cards',
      cards: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: 'S + should + V nguyên mẫu',
          example: 'You should wear a helmet.',
        },
        {
          title: 'Phủ định',
          accent: 'pink',
          content: 'S + should not + V nguyên mẫu',
          example: 'You should not ride too fast.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: 'Should + S + V nguyên mẫu?',
          example: 'Should we wait for the green light?',
        },
        {
          title: 'Trả lời ngắn',
          accent: 'orange',
          content: 'Yes, S + should. / No, S + should not.',
          example: 'Yes, we should.',
        },
      ],
    },
    {
      id: 's11',
      title: 'An toàn giao thông',
      subtitle: 'Những việc nên và không nên làm khi đi đường.',
      layout: 'cards',
      cards: [
        {
          title: 'Nên làm',
          accent: 'green',
          bullets: [
            'wear a helmet',
            'obey traffic lights',
            'use the zebra crossing',
            'wait for the green light',
          ],
        },
        {
          title: 'Không nên làm',
          accent: 'pink',
          bullets: [
            'ride too fast',
            'run across the road',
            'play football on the road',
            'use phones while driving',
          ],
        },
      ],
    },
    {
      id: 's12',
      title: 'Lưu ý quan trọng',
      subtitle: 'Tránh các lỗi rất hay gặp.',
      layout: 'cards',
      cards: [
        {
          title: 'Sau should',
          accent: 'orange',
          content: 'Luôn dùng động từ nguyên mẫu.',
          example: 'You should wear a helmet.',
        },
        {
          title: 'Không chia theo chủ ngữ',
          accent: 'blue',
          content: 'He / She / They đều dùng should.',
          example: 'She should obey traffic rules.',
        },
        {
          title: 'Should và must',
          accent: 'pink',
          content: 'should = lời khuyên; must = bắt buộc.',
          example: 'You must obey traffic laws.',
        },
      ],
    },
    {
      id: 's13',
      title: 'Phần 3',
      subtitle: 'Traffic Vocabulary',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's14',
      title: 'Phương tiện và địa điểm',
      subtitle: 'Từ vựng giao thông cốt lõi.',
      layout: 'cards',
      cards: [
        {
          title: 'Vehicles',
          accent: 'orange',
          bullets: ['bike', 'motorbike', 'car', 'bus', 'train'],
        },
        {
          title: 'Traffic places',
          accent: 'blue',
          bullets: ['bus stop', 'bus station', 'railway station', 'airport'],
        },
        {
          title: 'Road places',
          accent: 'green',
          bullets: ['road', 'street', 'pavement', 'zebra crossing'],
        },
        {
          title: 'Examples',
          accent: 'pink',
          bullets: ['I go to school by bike.', 'The bus stop is near my school.'],
        },
      ],
    },
    {
      id: 's15',
      title: 'Biển báo và hành động',
      subtitle: 'Từ vựng dùng nhiều trong bài giao thông.',
      layout: 'cards',
      cards: [
        {
          title: 'Signs & rules',
          accent: 'orange',
          bullets: ['traffic sign', 'traffic rule', 'helmet', 'seat belt'],
        },
        {
          title: 'Actions',
          accent: 'green',
          bullets: ['ride a bike', 'cross the road', 'slow down', 'walk'],
        },
        {
          title: 'Road safety',
          accent: 'pink',
          bullets: ['wear a helmet', 'obey traffic rules', 'use the zebra crossing'],
        },
        {
          title: 'Adjectives',
          accent: 'blue',
          bullets: ['safe', 'dangerous', 'crowded', 'careful'],
        },
      ],
    },
    {
      id: 's16',
      title: 'Cấu trúc giao tiếp',
      subtitle: 'Ba mẫu câu dùng nhiều trong Unit 7.',
      layout: 'cards',
      cards: [
        {
          title: 'Hỏi khoảng cách',
          accent: 'orange',
          content: 'How far is it from A to B?',
          example: 'How far is it from your house to school?',
        },
        {
          title: 'Hỏi phương tiện',
          accent: 'blue',
          content: 'How do / does + S + go to + place?',
          example: 'How do you go to school?',
        },
        {
          title: 'Đưa lời khuyên',
          accent: 'green',
          content: 'S + should / should not + V',
          example: 'Students should not play on the road.',
        },
      ],
    },
    {
      id: 's17',
      title: 'Luyện tập nhanh',
      subtitle: 'Điền từ hoặc cụm từ phù hợp.',
      layout: 'practice',
      accent: 'orange',
      bullets: [
        { content: '_____ far is it from your house to school?' },
        { content: 'It is about 2 kilometres _____ my home _____ school.' },
        { content: 'You _____ wear a helmet when you ride a bike.' },
        { content: 'Students should not _____ across the road.' },
      ],
      examples: ['How', 'from / to', 'should', 'run'],
    },
    {
      id: 's18',
      title: 'Unit 7 Recap',
      subtitle: 'Traffic',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'It is + distance + from A to B dùng để nói khoảng cách.' },
        { content: 'How far is it from A to B? dùng để hỏi khoảng cách.' },
        { content: 'Should / should not + V dùng để đưa ra lời khuyên giao thông.' },
        { content: 'Từ vựng giao thông giúp nói về phương tiện, biển báo và an toàn đường bộ.' },
      ],
      examples: [
        'It is about 2 kilometres from my house to school.',
        'How far is it from here to the bus stop?',
        'You should wear a helmet.',
      ],
    },
  ],
};

export default deck;

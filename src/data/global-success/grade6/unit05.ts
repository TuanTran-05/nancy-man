import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g6-u5-natural-wonders',
  curriculumFamily: 'global-success',
  grade: 6,
  unitNumber: 5,
  title: 'Grammar Grade 6 - Unit 5: Natural Wonders of Viet Nam',
  description:
    'Bài giảng Unit 5 Global Success 6 về countable and uncountable nouns, must / mustn’t và từ vựng Natural Wonders of Viet Nam.',
  createdAt: '2026-05-17T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 6',
      subtitle: 'UNIT 5: NATURAL WONDERS OF VIET NAM',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'COUNTABLE & UNCOUNTABLE NOUNS',
          subtitle: '(Danh từ đếm được và không đếm được)',
          accent: 'orange',
        },
        {
          title: 'QUANTITY WORDS',
          subtitle: '(a / an, some / any, many / much)',
          accent: 'blue',
        },
        {
          title: 'MUST / MUSTN’T',
          subtitle: '(Phải / Không được)',
          accent: 'pink',
        },
        {
          title: 'NATURAL WONDERS',
          subtitle: '(Từ vựng chủ đề thiên nhiên)',
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
            { text: 'Phân biệt ' },
            { text: 'countable nouns', accent: 'orange', bold: true },
            { text: ' và ' },
            { text: 'uncountable nouns', accent: 'green', bold: true },
            { text: '.' },
          ],
        },
        {
          content: 'Dùng đúng a / an, some / any, many / much, how many / how much.',
        },
        {
          content: [
            { text: 'Dùng ' },
            { text: 'must', accent: 'pink', bold: true },
            { text: ' và ' },
            { text: 'mustn’t', accent: 'red', bold: true },
            { text: ' để nói về quy định khi đi du lịch.' },
          ],
        },
        {
          content: 'Mở rộng từ vựng về kỳ quan thiên nhiên, đồ du lịch và tính từ miêu tả.',
        },
      ],
    },
    {
      id: 's3',
      title: 'COUNTABLE & UNCOUNTABLE NOUNS',
      subtitle: 'Danh từ đếm được và không đếm được',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Hai nhóm danh từ',
      subtitle: 'Nhìn xem danh từ có thể đếm trực tiếp bằng số hay không.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Countable nouns',
          accent: 'orange',
          content: 'Có thể đếm bằng one, two, three... và có dạng số ít / số nhiều.',
          example: 'a cave -> two caves',
        },
        {
          title: 'Uncountable nouns',
          accent: 'green',
          content: 'Không đếm trực tiếp bằng số; thường chỉ chất lỏng, vật chất hoặc khái niệm.',
          example: 'water, sand, food, information',
        },
        {
          title: 'Trong Unit 5',
          accent: 'blue',
          content:
            'Ta dùng các danh từ này để nói về cảnh quan, đồ mang theo và thức ăn khi đi du lịch.',
          example: 'We need some water for the trip.',
        },
      ],
    },
    {
      id: 's5',
      title: 'Countable nouns',
      subtitle: 'Danh từ đếm được có thể đi với số lượng cụ thể.',
      layout: 'cards',
      cards: [
        {
          title: 'Natural places',
          accent: 'orange',
          bullets: ['a mountain -> mountains', 'a cave -> caves', 'an island -> islands'],
        },
        {
          title: 'Travel items',
          accent: 'blue',
          bullets: ['a backpack -> backpacks', 'a camera -> cameras', 'a bottle -> bottles'],
        },
        {
          title: 'Examples',
          accent: 'green',
          bullets: [
            'There is a mountain near my village.',
            'There are many beautiful caves in Quang Binh.',
            'We need two bottles of water.',
          ],
        },
      ],
    },
    {
      id: 's6',
      title: 'Uncountable nouns',
      subtitle: 'Danh từ không đếm được không thêm -s và không đi trực tiếp với số.',
      layout: 'cards',
      cards: [
        {
          title: 'Nature',
          accent: 'green',
          bullets: ['water', 'air', 'sand', 'weather'],
        },
        {
          title: 'Food & ideas',
          accent: 'orange',
          bullets: ['food', 'rice', 'bread', 'milk', 'information', 'advice'],
        },
        {
          title: 'Examples',
          accent: 'blue',
          bullets: [
            'The air in the mountains is fresh.',
            'There is a lot of sand on the beach.',
            'We should bring some water.',
          ],
        },
      ],
    },
    {
      id: 's7',
      title: 'A / AN, SOME / ANY',
      subtitle: 'Chọn từ chỉ lượng theo loại danh từ và dạng câu.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'a / an',
          accent: 'orange',
          content: 'Dùng với danh từ đếm được số ít.',
          example: 'a cave, a mountain, an island, an umbrella',
        },
        {
          title: 'some',
          accent: 'green',
          content: 'Thường dùng trong câu khẳng định với danh từ số nhiều hoặc không đếm được.',
          example: 'some sandwiches, some water',
        },
        {
          title: 'any',
          accent: 'pink',
          content: 'Thường dùng trong câu hỏi và câu phủ định.',
          example: 'Do you have any water? We do not have any food.',
        },
      ],
    },
    {
      id: 's8',
      title: 'MANY / MUCH',
      subtitle: 'Dùng đúng theo nhóm danh từ.',
      layout: 'cards',
      cards: [
        {
          title: 'many',
          accent: 'orange',
          content: 'many + plural countable noun',
          bullets: ['many mountains', 'many tourists', 'many islands'],
        },
        {
          title: 'much',
          accent: 'green',
          content: 'much + uncountable noun',
          bullets: ['much water', 'much food', 'much luggage'],
        },
        {
          title: 'Examples',
          accent: 'blue',
          bullets: [
            'There are many mountains in Viet Nam.',
            'We do not have much water.',
            'How much luggage do you have?',
          ],
        },
      ],
    },
    {
      id: 's9',
      title: 'HOW MANY / HOW MUCH',
      subtitle: 'Hỏi số lượng theo đúng loại danh từ.',
      layout: 'explain',
      accent: 'purple',
      sections: [
        {
          title: 'How many',
          accent: 'orange',
          content: 'How many + plural countable nouns ...?',
          example: 'How many islands are there in Ha Long Bay?',
        },
        {
          title: 'How much',
          accent: 'green',
          content: 'How much + uncountable noun ...?',
          example: 'How much water do you need?',
        },
        {
          title: 'Remember',
          accent: 'blue',
          bullets: [
            'caves -> how many',
            'bottles -> how many',
            'food -> how much',
            'rice -> how much',
          ],
        },
      ],
    },
    {
      id: 's10',
      title: 'Lưu ý quan trọng',
      subtitle: 'Ba lỗi rất dễ gặp với danh từ không đếm được.',
      layout: 'cards',
      cards: [
        {
          title: 'Không dùng a / an',
          accent: 'red',
          bullets: ['Sai: a water', 'Đúng: some water', 'Đúng: a bottle of water'],
        },
        {
          title: 'Không thêm -s',
          accent: 'orange',
          bullets: ['Sai: some waters', 'Sai: a lot of sands', 'Đúng: some water / a lot of sand'],
        },
        {
          title: 'Muốn đếm thì dùng đơn vị',
          accent: 'blue',
          bullets: ['a bottle of water', 'a glass of milk', 'a bowl of rice', 'a piece of advice'],
        },
      ],
    },
    {
      id: 's11',
      title: 'Luyện tập nhanh',
      subtitle: 'Chọn từ phù hợp để hoàn thành câu.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'There are _____ caves in Quang Binh. (many / much)' },
        { content: 'We need _____ water for the trip. (a / some)' },
        { content: '_____ islands are there in Ha Long Bay? (How many / How much)' },
        { content: 'There is a lot of _____ on the beach. (sand / sands)' },
      ],
      examples: ['many', 'some', 'How many', 'sand'],
    },
    {
      id: 's12',
      title: 'MUST / MUSTN’T',
      subtitle: 'Phải làm gì và không được làm gì',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's13',
      title: 'Công thức chính',
      subtitle: 'Sau must / mustn’t luôn là động từ nguyên mẫu.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: 'S + must + V nguyên mẫu',
          example: 'You must bring water.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: 'S + mustn’t + V nguyên mẫu',
          example: 'You mustn’t litter.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: 'Must + S + V nguyên mẫu?',
          example: 'Must we wear trainers?',
        },
        {
          title: 'Trả lời ngắn',
          accent: 'purple',
          bullets: ['Yes, you must.', 'No, you needn’t.'],
        },
      ],
    },
    {
      id: 's14',
      title: 'Khi nào dùng MUST?',
      subtitle: 'Must diễn tả điều bắt buộc hoặc lời khuyên mạnh.',
      layout: 'cards',
      cards: [
        {
          title: 'Điều bắt buộc',
          accent: 'green',
          bullets: [
            'You must wear trainers when you climb the mountain.',
            'We must follow the guide in the cave.',
          ],
        },
        {
          title: 'Lời khuyên mạnh',
          accent: 'orange',
          bullets: [
            'You must visit Ha Long Bay.',
            'You must bring a camera.',
            'You must try local food.',
          ],
        },
        {
          title: 'Nhớ',
          accent: 'blue',
          bullets: ['must giống nhau với mọi chủ ngữ', 'không thêm s / es sau must'],
        },
      ],
    },
    {
      id: 's15',
      title: 'Khi nào dùng MUSTN’T?',
      subtitle: 'Mustn’t = không được phép.',
      layout: 'cards',
      cards: [
        {
          title: 'Quy định cấm',
          accent: 'red',
          bullets: [
            'You mustn’t litter in the park.',
            'You mustn’t make noise in the cave.',
            'Visitors mustn’t pick flowers.',
          ],
        },
        {
          title: 'Không giống "không cần"',
          accent: 'orange',
          bullets: ['mustn’t = không được phép', 'needn’t / do not have to = không cần'],
        },
        {
          title: 'So sánh',
          accent: 'blue',
          bullets: ['You mustn’t swim here.', 'You do not have to bring food.'],
        },
      ],
    },
    {
      id: 's16',
      title: 'Luyện tập với MUST / MUSTN’T',
      subtitle: 'Hoàn thành các quy định khi tham quan.',
      layout: 'practice',
      accent: 'pink',
      bullets: [
        { content: 'You _____ bring a torch when you visit a cave.' },
        { content: 'Visitors _____ litter in the national park.' },
        { content: 'We _____ follow the guide.' },
        { content: 'You _____ touch the rocks in the cave.' },
      ],
      examples: ['must', 'mustn’t', 'must', 'mustn’t'],
    },
    {
      id: 's17',
      title: 'Tóm tắt ngữ pháp Unit 5',
      subtitle: 'Nhìn nhanh - nhớ đúng.',
      layout: 'cards',
      cards: [
        {
          title: 'Countable',
          accent: 'orange',
          bullets: ['a cave', 'two islands', 'many mountains', 'How many caves...?'],
        },
        {
          title: 'Uncountable',
          accent: 'green',
          bullets: ['water', 'food', 'much water', 'How much rice...?'],
        },
        {
          title: 'Rules',
          accent: 'pink',
          bullets: ['must + V', 'mustn’t + V', 'mustn’t = không được phép'],
        },
      ],
    },
    {
      id: 's18',
      title: 'NATURAL WONDERS OF VIET NAM',
      subtitle: 'Từ vựng chủ đề kỳ quan thiên nhiên',
      label: 'Phần 3',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's19',
      title: 'Natural places',
      subtitle: 'Các địa điểm thiên nhiên thường gặp trong Unit 5.',
      layout: 'cards',
      cards: [
        {
          title: 'Landforms',
          accent: 'orange',
          bullets: ['mountain', 'cave', 'island', 'valley'],
        },
        {
          title: 'Water & coast',
          accent: 'blue',
          bullets: ['beach', 'river', 'lake', 'waterfall'],
        },
        {
          title: 'Large areas',
          accent: 'green',
          bullets: ['forest', 'desert', 'national park', 'natural wonder'],
        },
      ],
    },
    {
      id: 's20',
      title: 'Travel items',
      subtitle: 'Đồ dùng cần mang khi đi tham quan.',
      layout: 'cards',
      cards: [
        {
          title: 'For directions',
          accent: 'blue',
          bullets: ['map', 'compass', 'torch'],
        },
        {
          title: 'For the trip',
          accent: 'orange',
          bullets: ['backpack', 'camera', 'trainers', 'sun cream'],
        },
        {
          title: 'For camping',
          accent: 'green',
          bullets: ['sleeping bag', 'tent', 'waterproof coat'],
        },
      ],
    },
    {
      id: 's21',
      title: 'Adjectives for natural wonders',
      subtitle: 'Tính từ để miêu tả cảnh đẹp và địa điểm.',
      layout: 'cards',
      cards: [
        {
          title: 'Positive',
          accent: 'green',
          bullets: ['beautiful', 'wonderful', 'amazing', 'peaceful'],
        },
        {
          title: 'Description',
          accent: 'blue',
          bullets: ['famous', 'clean', 'high', 'deep', 'large'],
        },
        {
          title: 'Warning',
          accent: 'red',
          bullets: ['dangerous'],
          example: 'This area is dangerous.',
        },
      ],
    },
    {
      id: 's22',
      title: 'Unit 5 Recap',
      subtitle: 'Natural Wonders of Viet Nam',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Danh từ đếm được có số ít / số nhiều: a cave -> caves.' },
        { content: 'Danh từ không đếm được đi với some / much: some water, much food.' },
        { content: 'How many hỏi danh từ đếm được; How much hỏi danh từ không đếm được.' },
        { content: 'Must là phải làm; mustn’t là không được phép.' },
      ],
      examples: [
        'How many caves are there in Phong Nha?',
        'You must bring water, but you mustn’t litter.',
      ],
    },
  ],
};

export default deck;

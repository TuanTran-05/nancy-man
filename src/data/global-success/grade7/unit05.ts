import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g7-u5-vietnamese-food-drink',
  curriculumFamily: 'global-success',
  grade: 7,
  unitNumber: 5,
  title: 'Grammar Grade 7 - Unit 5: Vietnamese Food and Drink',
  description:
    'Bài giảng Unit 5 Global Success 7 về countable / uncountable nouns, quantifiers, how much / how many và từ vựng Vietnamese Food and Drink.',
  createdAt: '2026-05-17T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 7',
      subtitle: 'UNIT 5: VIETNAMESE FOOD AND DRINK',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'COUNTABLE / UNCOUNTABLE',
          subtitle: '(Danh từ đếm được / không đếm được)',
          accent: 'orange',
        },
        {
          title: 'SOME / ANY / A LOT OF',
          subtitle: '(Từ chỉ số lượng)',
          accent: 'pink',
        },
        {
          title: 'HOW MUCH / HOW MANY',
          subtitle: '(Số lượng và giá cả)',
          accent: 'blue',
        },
        {
          title: 'FOOD AND DRINK',
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
          content: 'Phân biệt danh từ đếm được và không đếm được trong chủ đề đồ ăn, thức uống.',
        },
        {
          content: [
            { text: 'Dùng đúng ' },
            { text: 'some, any, a lot of, lots of', accent: 'orange', bold: true },
            { text: ' với từng loại câu.' },
          ],
        },
        {
          content: [
            { text: 'Đặt câu hỏi với ' },
            { text: 'how many', accent: 'pink', bold: true },
            { text: ', ' },
            { text: 'how much', accent: 'blue', bold: true },
            { text: ' và hỏi giá tiền.' },
          ],
        },
        {
          content: 'Gọi món, hỏi số lượng và nói về món ăn Việt Nam bằng từ vựng Unit 5.',
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
      title: 'Countable nouns',
      subtitle: 'Có thể đếm trực tiếp bằng one, two, three...',
      layout: 'cards',
      cards: [
        {
          title: 'Số ít',
          accent: 'orange',
          bullets: ['an egg', 'a banana', 'an apple'],
        },
        {
          title: 'Số nhiều',
          accent: 'pink',
          bullets: ['eggs', 'bananas', 'apples'],
        },
        {
          title: 'Food examples',
          accent: 'blue',
          bullets: ['sandwiches', 'spring rolls', 'bottles', 'cups'],
        },
        {
          title: 'Ví dụ',
          accent: 'green',
          bullets: ['She eats two bananas.', 'There are some spring rolls.'],
        },
      ],
    },
    {
      id: 's5',
      title: 'Plural spelling rules',
      subtitle: 'Quy tắc tạo danh từ số nhiều.',
      layout: 'cards',
      cards: [
        {
          title: 'Thêm -s',
          accent: 'orange',
          bullets: ['banana -> bananas', 'tray -> trays'],
        },
        {
          title: 'Thêm -es',
          accent: 'pink',
          bullets: ['sandwich -> sandwiches'],
        },
        {
          title: 'Phụ âm + y',
          accent: 'blue',
          bullets: ['strawberry -> strawberries'],
        },
        {
          title: 'Bất quy tắc',
          accent: 'green',
          bullets: ['child -> children'],
        },
      ],
    },
    {
      id: 's6',
      title: 'Uncountable nouns',
      subtitle: 'Không đếm trực tiếp, thường không có dạng số nhiều.',
      layout: 'cards',
      cards: [
        {
          title: 'Food',
          accent: 'orange',
          bullets: ['rice', 'beef', 'chicken', 'soup'],
        },
        {
          title: 'Drink',
          accent: 'blue',
          bullets: ['water', 'milk', 'juice', 'tea'],
        },
        {
          title: 'Ingredients',
          accent: 'green',
          bullets: ['sugar', 'salt', 'flour', 'oil'],
        },
        {
          title: 'Lưu ý',
          accent: 'red',
          bullets: ['Không thêm -s / -es', 'Không dùng a / an trực tiếp'],
        },
      ],
    },
    {
      id: 's7',
      title: 'Đếm danh từ không đếm được',
      subtitle: 'Dùng đơn vị đo lường để biến số lượng thành đếm được.',
      layout: 'cards',
      cards: [
        {
          title: 'Drinks',
          accent: 'blue',
          bullets: ['a bottle of water', 'a glass of milk', 'a cup of tea'],
        },
        {
          title: 'Food',
          accent: 'orange',
          bullets: ['a bowl of rice', 'a kilo of beef', 'a piece of cake'],
        },
        {
          title: 'More units',
          accent: 'green',
          bullets: ['a carton of milk', 'a slice of bread', 'a packet of noodles'],
        },
      ],
    },
    {
      id: 's8',
      title: 'Countable vs Uncountable',
      subtitle: 'Nhìn khả năng đếm trực tiếp để chọn cấu trúc.',
      layout: 'cards',
      cards: [
        {
          title: 'Countable',
          accent: 'orange',
          bullets: ['a / an', 'số ít / số nhiều', 'How many...?'],
          example: 'two bananas',
        },
        {
          title: 'Uncountable',
          accent: 'blue',
          bullets: ['không dùng a / an trực tiếp', 'không thêm -s', 'How much...?'],
          example: 'some rice',
        },
        {
          title: 'Ví dụ đối chiếu',
          accent: 'green',
          bullets: ['an egg / some rice', 'many apples / much milk'],
        },
      ],
    },
    {
      id: 's9',
      title: 'SOME, ANY, A LOT OF, LOTS OF',
      subtitle: 'Các từ chỉ số lượng',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's10',
      title: 'Some và Any',
      subtitle: 'Chọn theo loại câu nhiều hơn theo loại danh từ.',
      layout: 'cards',
      cards: [
        {
          title: 'SOME',
          accent: 'pink',
          bullets: ['Câu khẳng định', 'Lời mời / đề nghị'],
          example: 'There is some milk.',
        },
        {
          title: 'ANY',
          accent: 'blue',
          bullets: ['Câu phủ định', 'Câu hỏi'],
          example: 'Are there any eggs?',
        },
        {
          title: 'Lỗi cần tránh',
          accent: 'red',
          bullets: ['Sai: I do not have some milk.', 'Đúng: I do not have any milk.'],
        },
      ],
    },
    {
      id: 's11',
      title: 'A lot of và Lots of',
      subtitle: 'Đều có nghĩa là nhiều và dùng được với cả hai loại danh từ.',
      layout: 'cards',
      cards: [
        {
          title: 'Countable plural',
          accent: 'orange',
          bullets: ['a lot of apples', 'lots of eggs'],
        },
        {
          title: 'Uncountable',
          accent: 'blue',
          bullets: ['a lot of rice', 'lots of water'],
        },
        {
          title: 'There is / There are',
          accent: 'green',
          bullets: ['There are a lot of apples.', 'There is a lot of milk.'],
        },
      ],
    },
    {
      id: 's12',
      title: 'HOW MUCH & HOW MANY',
      subtitle: 'Số lượng và giá cả',
      label: 'Phần 3',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's13',
      title: 'How many',
      subtitle: 'Dùng với danh từ đếm được số nhiều.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'Công thức',
          accent: 'blue',
          content: 'How many + plural countable noun + ...?',
          example: 'How many eggs do we need?',
        },
        {
          title: 'Ví dụ',
          accent: 'green',
          bullets: ['How many apples do you want?', 'How many bottles of water should we buy?'],
        },
        {
          title: 'Lưu ý',
          accent: 'red',
          bullets: ['Sau how many dùng danh từ số nhiều.'],
        },
      ],
    },
    {
      id: 's14',
      title: 'How much',
      subtitle: 'Dùng với danh từ không đếm được và hỏi giá tiền.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Hỏi lượng',
          accent: 'pink',
          content: 'How much + uncountable noun + ...?',
          example: 'How much rice do you need?',
        },
        {
          title: 'Hỏi giá',
          accent: 'orange',
          content: 'How much + be + S?',
          example: 'How much is a bowl of pho?',
        },
        {
          title: 'Trả lời',
          accent: 'green',
          bullets: ['It is 40,000 dong.', 'They are 60,000 dong.'],
        },
      ],
    },
    {
      id: 's15',
      title: 'How much vs How many',
      subtitle: 'Nhìn danh từ ngay sau từ hỏi.',
      layout: 'cards',
      cards: [
        {
          title: 'HOW MANY',
          accent: 'blue',
          bullets: ['eggs', 'apples', 'spring rolls', 'bottles'],
        },
        {
          title: 'HOW MUCH',
          accent: 'pink',
          bullets: ['rice', 'milk', 'beef', 'price'],
        },
        {
          title: 'Lỗi thường gặp',
          accent: 'red',
          bullets: ['Sai: How many milk?', 'Đúng: How much milk?'],
        },
      ],
    },
    {
      id: 's16',
      title: 'VIETNAMESE FOOD AND DRINK',
      subtitle: 'Từ vựng chủ đề đồ ăn và thức uống Việt Nam',
      label: 'Phần 4',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's17',
      title: 'Food and Drink Vocabulary',
      subtitle: 'Những nhóm từ quan trọng trong Unit 5.',
      layout: 'cards',
      cards: [
        {
          title: 'Vietnamese food',
          accent: 'orange',
          bullets: ['pho', 'spring rolls', 'sticky rice', 'banh mi'],
        },
        {
          title: 'Drinks',
          accent: 'pink',
          bullets: ['water', 'milk', 'tea', 'orange juice'],
        },
        {
          title: 'Ingredients',
          accent: 'blue',
          bullets: ['beef', 'chicken', 'flour', 'oil'],
        },
        {
          title: 'Units',
          accent: 'green',
          bullets: ['a bowl of', 'a glass of', 'a kilo of', 'a packet of'],
        },
      ],
    },
    {
      id: 's18',
      title: 'Giao tiếp thường gặp',
      subtitle: 'Các mẫu câu để gọi món, hỏi lượng và hỏi giá.',
      layout: 'explain',
      accent: 'purple',
      sections: [
        {
          title: 'Gọi món',
          accent: 'orange',
          content: 'What would you like to eat / drink?',
          example: 'I would like a bowl of pho.',
        },
        {
          title: 'Hỏi số lượng',
          accent: 'pink',
          content: 'How much / How many + noun + do we need?',
          example: 'How many eggs do we need?',
        },
        {
          title: 'Hỏi giá',
          accent: 'blue',
          content: 'How much is / are + noun?',
          example: 'How much are these spring rolls?',
        },
      ],
    },
    {
      id: 's19',
      title: 'Luyện tập nhanh',
      subtitle: 'Hoàn thành câu với từ phù hợp.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'There is _____ rice in the bowl.' },
        { content: 'There are not _____ eggs in the fridge.' },
        { content: '_____ bananas do you want?' },
        { content: '_____ milk do we need?' },
      ],
      examples: ['some', 'any', 'How many', 'How much'],
    },
    {
      id: 's20',
      title: 'Unit 5 Recap',
      subtitle: 'Vietnamese Food and Drink',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        {
          content: 'Countable nouns có số ít / số nhiều; uncountable nouns không đếm trực tiếp.',
        },
        { content: 'Some thường dùng trong câu khẳng định; any trong phủ định và câu hỏi.' },
        { content: 'A lot of / lots of dùng được với cả hai loại danh từ.' },
        {
          content:
            'How many hỏi danh từ đếm được; how much hỏi danh từ không đếm được hoặc giá tiền.',
        },
      ],
      examples: [
        'There are some spring rolls.',
        'How many eggs do we need?',
        'How much is a bowl of pho?',
      ],
    },
  ],
};

export default deck;

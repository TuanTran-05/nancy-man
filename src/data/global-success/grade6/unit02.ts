import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g6-u2-my-house',
  curriculumFamily: 'global-success',
  grade: 6,
  unitNumber: 2,
  title: 'Grammar Grade 6 - Unit 2: My Home',
  description:
    'Bài giảng Unit 2 Global Success 6 về sở hữu cách, giới từ chỉ nơi chốn và từ vựng My Home.',
  createdAt: '2026-05-17T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 6',
      subtitle: 'UNIT 2: MY HOME',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'POSSESSIVE CASE',
          subtitle: "(Sở hữu cách: 's / s')",
          accent: 'orange',
        },
        {
          title: 'PREPOSITIONS OF PLACE',
          subtitle: '(Giới từ chỉ nơi chốn)',
          accent: 'pink',
        },
        {
          title: 'MY HOME VOCABULARY',
          subtitle: '(Phòng, đồ vật, loại nhà)',
          accent: 'blue',
        },
        {
          title: 'DESCRIBING A HOME',
          subtitle: '(Kết hợp cấu trúc trong câu)',
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
            { text: 'Dùng đúng ' },
            { text: "'s / s'", accent: 'orange', bold: true },
            { text: ' để nói ai sở hữu đồ vật hoặc căn phòng.' },
          ],
        },
        {
          content: [
            { text: 'Phân biệt các giới từ vị trí như ' },
            { text: 'in, on, at, under, behind', accent: 'pink', bold: true },
            { text: '.' },
          ],
        },
        {
          content: [
            { text: 'Hỏi và trả lời với ' },
            { text: 'Where is / Where are', accent: 'blue', bold: true },
            { text: ' khi mô tả vị trí đồ vật.' },
          ],
        },
        {
          content: 'Kết hợp sở hữu cách, giới từ và từ vựng để mô tả ngôi nhà hoặc căn phòng.',
        },
      ],
    },
    {
      id: 's3',
      title: 'POSSESSIVE CASE',
      subtitle: 'Sở hữu cách',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Sở hữu cách: công thức',
      subtitle: 'Dùng để nói người hoặc vật nào sở hữu một thứ khác.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Công thức chung',
          accent: 'orange',
          content: [
            { text: 'Người/Vật sở hữu + ' },
            { text: "'s / s' + danh từ", accent: 'orange', bold: true },
          ],
          example: "Lan's bedroom, my parents' room",
        },
        {
          title: 'Người số ít',
          accent: 'green',
          content: [
            { text: 'Tên riêng hoặc danh từ số ít + ' },
            { text: "'s", accent: 'green', bold: true },
          ],
          example: "Tom's house, my mother's kitchen",
        },
        {
          title: 'Danh từ số nhiều có -s',
          accent: 'blue',
          content: [{ text: 'Danh từ số nhiều + ' }, { text: "dấu '", accent: 'blue', bold: true }],
          example: "my parents' room, the students' lockers",
        },
      ],
    },
    {
      id: 's5',
      title: 'Các trường hợp cần nhớ',
      subtitle: 'Không phải mọi danh từ đều thêm sở hữu cách theo cùng một kiểu.',
      layout: 'cards',
      cards: [
        {
          title: 'Số nhiều bất quy tắc',
          accent: 'pink',
          bullets: ["children -> children's", "men -> men's", "women -> women's"],
        },
        {
          title: 'Hai người cùng sở hữu',
          accent: 'blue',
          bullets: ["Nam and Lan's house", "Tom and Jerry's room"],
          example: "Chỉ thêm 's vào người cuối cùng.",
        },
        {
          title: "'s sở hữu vs viết tắt",
          accent: 'red',
          bullets: ["Lan's room = sở hữu", "Lan's happy = Lan is happy"],
          example: 'Nhìn từ đứng sau để phân biệt.',
        },
      ],
    },
    {
      id: 's6',
      title: 'PREPOSITIONS OF PLACE',
      subtitle: 'Giới từ chỉ nơi chốn',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's7',
      title: 'In, On, At',
      subtitle: 'Ba giới từ nền tảng nhưng rất dễ nhầm.',
      layout: 'cards',
      cards: [
        {
          title: 'IN',
          accent: 'green',
          bullets: ['Bên trong không gian kín', 'in a room', 'in the box'],
          example: 'The books are in the bookcase.',
        },
        {
          title: 'ON',
          accent: 'orange',
          bullets: ['Trên bề mặt tiếp xúc', 'on the table', 'on the wall'],
          example: 'The lamp is on the desk.',
        },
        {
          title: 'AT',
          accent: 'blue',
          bullets: ['Tại một điểm cụ thể', 'at home', 'at the door'],
          example: 'He is at the window.',
        },
      ],
    },
    {
      id: 's8',
      title: 'Các cặp giới từ hay nhầm',
      subtitle: 'Nhìn vị trí tương quan để chọn giới từ đúng.',
      layout: 'cards',
      cards: [
        {
          title: 'under / below',
          accent: 'blue',
          bullets: ['under: ngay bên dưới', 'below: thấp hơn'],
          example: 'The cat is under the table.',
        },
        {
          title: 'behind / in front of',
          accent: 'pink',
          bullets: ['behind: phía sau', 'in front of: phía trước'],
          example: 'The garden is behind the house.',
        },
        {
          title: 'between / among',
          accent: 'green',
          bullets: ['between: giữa 2 vật', 'among: giữa nhiều vật'],
          example: 'The kitchen is between two rooms.',
        },
      ],
    },
    {
      id: 's9',
      title: 'Mô tả vị trí trong câu',
      subtitle: 'Kết hợp giới từ với There is / There are và câu hỏi Where.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'There is / There are',
          accent: 'green',
          bullets: [
            'There is + danh từ số ít + giới từ.',
            'There are + danh từ số nhiều + giới từ.',
          ],
          example: 'There is a sofa in front of the TV.',
        },
        {
          title: 'Câu hỏi vị trí',
          accent: 'blue',
          bullets: ['Where is + danh từ số ít?', 'Where are + danh từ số nhiều?'],
          example: 'Where are my keys? They are on the counter.',
        },
        {
          title: 'Câu mô tả',
          accent: 'orange',
          bullets: ['S + be + giới từ + nơi chốn.', 'S + V + giới từ + nơi chốn.'],
          example: 'The cat is under the table.',
        },
      ],
    },
    {
      id: 's10',
      title: 'My Home Vocabulary',
      subtitle: 'Từ vựng trọng tâm để mô tả ngôi nhà.',
      layout: 'cards',
      cards: [
        {
          title: 'Rooms',
          accent: 'blue',
          bullets: ['living room', 'bedroom', 'kitchen', 'bathroom'],
        },
        {
          title: 'Furniture',
          accent: 'orange',
          bullets: ['sofa', 'wardrobe', 'desk', 'bookcase'],
        },
        {
          title: 'Types of houses',
          accent: 'green',
          bullets: ['house', 'apartment', 'villa', 'cottage'],
        },
      ],
    },
    {
      id: 's11',
      title: 'Kết hợp cấu trúc',
      subtitle: 'Một câu hay thường dùng đồng thời sở hữu cách và giới từ vị trí.',
      layout: 'explain',
      accent: 'purple',
      sections: [
        {
          title: 'Mẫu 1',
          accent: 'orange',
          content: "Lan's bedroom is on the first floor.",
        },
        {
          title: 'Mẫu 2',
          accent: 'pink',
          content: "My parents' room is next to the bathroom.",
        },
        {
          title: 'Mẫu 3',
          accent: 'blue',
          content: "The children's toys are under the bed.",
        },
      ],
      footerNote: 'Khi mô tả nhà, hãy nói rõ: của ai, ở đâu, và đồ vật nằm ở vị trí nào.',
    },
    {
      id: 's12',
      title: 'Luyện tập nhanh',
      subtitle: 'Hoàn thành câu với sở hữu cách hoặc giới từ phù hợp.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'This is Minh_____ bedroom.' },
        { content: 'My parents_____ room is next to the bathroom.' },
        { content: 'The lamp is _____ the desk.' },
        { content: 'The kitchen is _____ the living room and the dining room.' },
      ],
      examples: ["Minh's", "parents'", 'on', 'between'],
    },
    {
      id: 's13',
      title: 'Unit 2 Recap',
      subtitle: 'My Home',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: "Tên người số ít thường thêm 's: Lan's room." },
        { content: "Danh từ số nhiều có -s chỉ thêm dấu ': parents' room." },
        { content: 'In, on, at mô tả những kiểu vị trí khác nhau.' },
        { content: 'Where is/are...? dùng để hỏi vị trí đồ vật hoặc người.' },
      ],
      examples: ["Tom's desk is next to the window."],
    },
  ],
};

export default deck;

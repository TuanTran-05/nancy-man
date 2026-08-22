import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g8-u8-shopping',
  curriculumFamily: 'global-success',
  grade: 8,
  unitNumber: 8,
  title: 'Grammar Grade 8 - Unit 8: Shopping',
  description:
    'Bài giảng Unit 8 Global Success 8 về adverbs of frequency, Present Simple for future, lịch trình mua sắm và từ vựng Shopping.',
  createdAt: '2026-05-15T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 8',
      subtitle: 'UNIT 8: SHOPPING',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'ADVERBS OF FREQUENCY',
          subtitle: '(Trạng từ chỉ tần suất)',
          accent: 'orange',
        },
        {
          title: 'PRESENT SIMPLE FOR FUTURE',
          subtitle: '(Lịch trình / thời gian biểu)',
          accent: 'pink',
        },
        {
          title: 'SHOPPING VOCABULARY',
          subtitle: '(Cửa hàng, mua bán, giá cả)',
          accent: 'blue',
        },
        {
          title: 'QUESTIONS & PRACTICE',
          subtitle: '(How often? / schedules)',
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
            {
              text: 'always, usually, often, sometimes, rarely, never',
              accent: 'orange',
              bold: true,
            },
          ],
        },
        {
          content: 'Đặt trạng từ tần suất đúng vị trí trong câu.',
        },
        {
          content: [
            { text: 'Dùng ' },
            { text: 'Present Simple', accent: 'pink', bold: true },
            { text: ' để nói về lịch trình tương lai cố định' },
          ],
        },
        {
          content: 'Hỏi và trả lời về thói quen mua sắm.',
        },
      ],
    },
    {
      id: 's3',
      title: 'ADVERBS OF FREQUENCY',
      subtitle: 'Trạng từ chỉ tần suất',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Frequency Scale',
      subtitle: 'Từ xảy ra nhiều nhất đến ít nhất.',
      layout: 'cards',
      accent: 'orange',
      cards: [
        {
          title: '100% - 90%',
          accent: 'green',
          bullets: ['always = luôn luôn', 'usually = thường xuyên'],
          example: 'She always pays by card.',
        },
        {
          title: '75% - 50%',
          accent: 'blue',
          bullets: ['often = thường', 'sometimes = thỉnh thoảng'],
          example: 'We sometimes shop online.',
        },
        {
          title: '25% - 10%',
          accent: 'orange',
          bullets: ['rarely = hiếm khi', 'seldom = hiếm khi'],
          example: 'He rarely buys expensive clothes.',
        },
        {
          title: '0%',
          accent: 'red',
          content: 'never = không bao giờ',
          example: 'I never forget to check the price tag.',
        },
      ],
    },
    {
      id: 's5',
      title: 'Vị trí trong câu',
      subtitle: 'Trạng từ tần suất đổi vị trí theo loại động từ.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'Trước động từ thường',
          accent: 'blue',
          content: 'S + adverb + V',
          example: 'She always goes shopping on weekends.',
        },
        {
          title: 'Sau to be',
          accent: 'green',
          content: 'S + be + adverb',
          example: 'The mall is usually crowded.',
        },
        {
          title: 'Sau modal / auxiliary',
          accent: 'purple',
          content: 'S + modal + adverb + V',
          example: 'You should always check the receipt.',
        },
        {
          title: 'Đầu/cuối câu',
          accent: 'orange',
          content: 'Sometimes có thể đứng đầu hoặc cuối câu.',
          example: 'Sometimes I go to the night market.',
        },
      ],
    },
    {
      id: 's6',
      title: 'Cụm từ chỉ tần suất',
      subtitle: 'Dùng khi muốn nói số lần cụ thể.',
      layout: 'cards',
      accent: 'purple',
      cards: [
        {
          title: 'every...',
          accent: 'blue',
          content: 'every day / week / month',
          example: 'She goes to the market every day.',
        },
        {
          title: 'once / twice',
          accent: 'green',
          content: 'once a week, twice a month',
          example: 'I shop online once a week.',
        },
        {
          title: 'times',
          accent: 'orange',
          content: 'three times a week, four times a month',
          example: 'He visits the mall twice a week.',
        },
        {
          title: 'Question',
          accent: 'pink',
          content: 'How often do/does + S + V?',
          example: 'How often do you buy clothes?',
        },
      ],
    },
    {
      id: 's7',
      title: 'PRESENT SIMPLE FOR FUTURE',
      subtitle: 'Hiện tại đơn chỉ tương lai',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's8',
      title: 'Present Simple for Future',
      subtitle: 'Dùng với lịch trình cố định, thời gian biểu, sự kiện đã lên lịch.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: 'S + V(s/es) + future time',
          example: 'The sale starts tomorrow.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: 'S + do/does not + V',
          example: "The mall doesn't open until 9 AM.",
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: 'Do/Does + S + V?',
          example: 'Does the sale end tomorrow?',
        },
        {
          title: 'Dấu hiệu',
          accent: 'orange',
          bullets: ['tomorrow', 'tonight', 'next Monday', 'at 8 PM', 'on weekends'],
        },
      ],
    },
    {
      id: 's9',
      title: 'Present Simple vs Future Forms',
      subtitle: 'Không phải cứ tương lai là dùng will.',
      layout: 'cards',
      accent: 'purple',
      cards: [
        {
          title: 'Present Simple',
          accent: 'pink',
          content: 'Lịch trình chính thức/cố định.',
          example: 'The store closes at 10 PM tonight.',
        },
        {
          title: 'will',
          accent: 'blue',
          content: 'Quyết định tức thời, dự đoán, lời hứa.',
          example: 'I will buy those shoes.',
        },
        {
          title: 'be going to',
          accent: 'green',
          content: 'Kế hoạch đã có trước hoặc dự đoán có bằng chứng.',
          example: 'She is going to buy a new bag this weekend.',
        },
        {
          title: 'Shopping schedules',
          accent: 'orange',
          bullets: ['The bus leaves...', 'The flash sale begins...', 'The mall opens...'],
        },
      ],
    },
    {
      id: 's10',
      title: 'Shopping Vocabulary',
      subtitle: 'Từ vựng trọng tâm Unit 8.',
      layout: 'cards',
      accent: 'green',
      cards: [
        {
          title: 'Shops',
          accent: 'blue',
          bullets: ['supermarket', 'shopping mall', 'department store', 'night market'],
        },
        {
          title: 'Verbs',
          accent: 'green',
          bullets: ['shop', 'buy', 'sell', 'pay', 'order', 'return'],
        },
        {
          title: 'Money & sale',
          accent: 'orange',
          bullets: ['price', 'discount', 'sale', 'receipt', 'cash', 'card'],
        },
        {
          title: 'Adjectives',
          accent: 'pink',
          bullets: ['cheap', 'expensive', 'affordable', 'crowded', 'convenient'],
        },
      ],
    },
    {
      id: 's11',
      title: 'Practice',
      subtitle: 'Hoàn thành câu với trạng từ hoặc thì hiện tại đơn.',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'She _____ pays by card at the supermarket. (100%)' },
        { content: 'The new shopping mall _____ next Monday. (open)' },
        { content: 'How _____ do you shop online?' },
        { content: 'The sale _____ at midnight tonight. (begin)' },
      ],
      examples: ['always', 'opens', 'often', 'begins'],
    },
  ],
};

export default deck;

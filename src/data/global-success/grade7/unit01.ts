import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g7-u1-my-hobbies',
  curriculumFamily: 'global-success',
  grade: 7,
  unitNumber: 1,
  title: 'Grammar Grade 7 - Unit 1: My Hobbies',
  description:
    'Bài giảng Unit 1 Global Success 7 về verbs of liking, Present Simple và từ vựng My Hobbies.',
  createdAt: '2026-05-17T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 7',
      subtitle: 'UNIT 1: MY HOBBIES',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'VERBS OF LIKING',
          subtitle: '(Động từ chỉ sự yêu thích)',
          accent: 'orange',
        },
        {
          title: 'PRESENT SIMPLE',
          subtitle: '(Thì hiện tại đơn)',
          accent: 'pink',
        },
        {
          title: 'HOBBY VOCABULARY',
          subtitle: '(Từ vựng sở thích)',
          accent: 'blue',
        },
        {
          title: 'COMMUNICATION',
          subtitle: '(Hỏi và nói về sở thích)',
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
            { text: 'like, love, enjoy, hate, dislike', accent: 'orange', bold: true },
            { text: ' với ' },
            { text: 'V-ing', accent: 'pink', bold: true },
            { text: ' để nói về sở thích.' },
          ],
        },
        {
          content: [
            { text: 'Dùng đúng cấu trúc ' },
            { text: 'be interested in + V-ing / noun', accent: 'green', bold: true },
            { text: '.' },
          ],
        },
        {
          content:
            'Chia đúng Present Simple với be và động từ thường trong câu khẳng định, phủ định, nghi vấn.',
        },
        {
          content: 'Hỏi, trả lời và nêu lý do về sở thích bằng từ vựng Unit 1.',
        },
      ],
    },
    {
      id: 's3',
      title: 'VERBS OF LIKING',
      subtitle: 'Động từ chỉ sự yêu thích',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Các động từ chỉ sở thích',
      subtitle: 'Mức độ yêu thích có thể mạnh hoặc nhẹ khác nhau.',
      layout: 'cards',
      cards: [
        {
          title: 'Thích mạnh',
          accent: 'orange',
          bullets: ['love', 'enjoy', 'fancy'],
        },
        {
          title: 'Thích thông thường',
          accent: 'blue',
          bullets: ['like', 'be interested in'],
        },
        {
          title: 'Không thích',
          accent: 'red',
          bullets: ['dislike', 'hate'],
        },
        {
          title: 'Ví dụ',
          accent: 'green',
          bullets: [
            'I like playing badminton.',
            'She loves collecting dolls.',
            'They hate doing homework.',
          ],
        },
      ],
    },
    {
      id: 's5',
      title: 'Cấu trúc chính',
      subtitle: 'Sau verbs of liking thường dùng V-ing.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Verb of liking + V-ing',
          accent: 'orange',
          content: [
            { text: 'S + like / love / enjoy / hate / dislike / fancy + ' },
            { text: 'V-ing', accent: 'orange', bold: true },
          ],
          example: 'She enjoys making models.',
        },
        {
          title: 'Be interested in',
          accent: 'blue',
          content: [
            { text: 'S + be + interested in + ' },
            { text: 'V-ing / noun', accent: 'blue', bold: true },
          ],
          example: 'I am interested in collecting coins.',
        },
        {
          title: 'Câu hỏi',
          accent: 'green',
          content: 'Do / Does + S + like + V-ing?',
          example: 'Do you like swimming?',
        },
      ],
    },
    {
      id: 's6',
      title: 'V-ing và lỗi thường gặp',
      subtitle: 'Nhìn dạng động từ sau verbs of liking trước khi chốt câu.',
      layout: 'cards',
      cards: [
        {
          title: 'Quy tắc -ing',
          accent: 'green',
          bullets: ['play -> playing', 'make -> making', 'run -> running', 'lie -> lying'],
        },
        {
          title: 'Sau liking verbs',
          accent: 'orange',
          bullets: ['Sai: I like play football.', 'Đúng: I like playing football.'],
        },
        {
          title: 'Với he / she / it',
          accent: 'blue',
          bullets: ['She likes reading.', 'He enjoys playing chess.'],
        },
        {
          title: 'Sau does not',
          accent: 'red',
          bullets: ['Sai: She does not likes cooking.', 'Đúng: She does not like cooking.'],
        },
      ],
    },
    {
      id: 's7',
      title: 'PRESENT SIMPLE',
      subtitle: 'Thì hiện tại đơn',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's8',
      title: 'Present Simple với be',
      subtitle: 'Dùng khi câu có am / is / are.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: 'S + am / is / are + ...',
          example: 'I am interested in music.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: 'S + am / is / are + not + ...',
          example: 'She is not interested in sports.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: 'Am / Is / Are + S + ...?',
          example: 'Are you interested in painting?',
        },
      ],
      examples: ['Yes, I am.', 'No, she is not.'],
    },
    {
      id: 's9',
      title: 'Present Simple với động từ thường',
      subtitle: 'He / she / it cần V-s/es trong câu khẳng định.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'I / You / We / They',
          accent: 'green',
          content: 'S + V nguyên mẫu',
          example: 'I collect stamps.',
        },
        {
          title: 'He / She / It',
          accent: 'orange',
          content: 'S + V-s/es',
          example: 'She collects dolls.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: 'S + do not / does not + V nguyên mẫu',
          example: 'He does not like fishing.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: 'Do / Does + S + V nguyên mẫu?',
          example: 'Does she enjoy cooking?',
        },
      ],
    },
    {
      id: 's10',
      title: 'Cách dùng và dấu hiệu',
      subtitle: 'Present Simple thường đi với thói quen và tần suất.',
      layout: 'cards',
      cards: [
        {
          title: 'Thói quen',
          accent: 'orange',
          bullets: ['I read books every night.', 'He plays football after school.'],
        },
        {
          title: 'Sở thích',
          accent: 'pink',
          bullets: ['I like collecting coins.', 'She enjoys making models.'],
        },
        {
          title: 'Dấu hiệu',
          accent: 'blue',
          bullets: ['always', 'usually', 'often', 'sometimes'],
        },
        {
          title: 'Cụm tần suất',
          accent: 'green',
          bullets: ['every day', 'every weekend', 'once a week', 'twice a month'],
        },
      ],
    },
    {
      id: 's11',
      title: 'Quy tắc thêm -s / -es',
      subtitle: 'Chỉ dùng trong câu khẳng định với he / she / it.',
      layout: 'cards',
      cards: [
        {
          title: 'Thông thường',
          accent: 'orange',
          bullets: ['play -> plays', 'read -> reads'],
        },
        {
          title: 'Thêm -es',
          accent: 'blue',
          bullets: ['watch -> watches', 'go -> goes'],
        },
        {
          title: 'Phụ âm + y',
          accent: 'green',
          bullets: ['study -> studies', 'try -> tries'],
        },
        {
          title: 'Bất quy tắc',
          accent: 'pink',
          bullets: ['have -> has'],
        },
      ],
    },
    {
      id: 's12',
      title: 'Lỗi thường gặp với Present Simple',
      subtitle: 'Do / does đã gánh phần chia ngôi trong câu hỏi và phủ định.',
      layout: 'cards',
      cards: [
        {
          title: 'Khẳng định',
          accent: 'red',
          bullets: ['Sai: She play chess.', 'Đúng: She plays chess.'],
        },
        {
          title: 'Phủ định',
          accent: 'orange',
          bullets: ['Sai: He does not plays football.', 'Đúng: He does not play football.'],
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          bullets: ['Sai: Does she likes drawing?', 'Đúng: Does she like drawing?'],
        },
        {
          title: 'Do / Does',
          accent: 'green',
          bullets: ['I/you/we/they -> do', 'he/she/it -> does'],
        },
      ],
    },
    {
      id: 's13',
      title: 'MY HOBBIES',
      subtitle: 'Từ vựng chủ đề sở thích',
      label: 'Phần 3',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's14',
      title: 'Hobby Vocabulary',
      subtitle: 'Các nhóm từ xuất hiện nhiều trong Unit 1.',
      layout: 'cards',
      cards: [
        {
          title: 'Collecting',
          accent: 'orange',
          bullets: ['collect stamps', 'collect coins', 'collect dolls'],
        },
        {
          title: 'Creative hobbies',
          accent: 'pink',
          bullets: ['make models', 'make pottery', 'draw pictures'],
        },
        {
          title: 'Active hobbies',
          accent: 'blue',
          bullets: ['play football', 'play badminton', 'go cycling'],
        },
        {
          title: 'Quiet hobbies',
          accent: 'green',
          bullets: ['read books', 'listen to music', 'take photos'],
        },
      ],
    },
    {
      id: 's15',
      title: 'Nói về sở thích',
      subtitle: 'Các mẫu giao tiếp cần dùng trong Unit 1.',
      layout: 'explain',
      accent: 'purple',
      sections: [
        {
          title: 'Hỏi sở thích',
          accent: 'orange',
          content: 'What is your hobby?',
          example: 'My hobby is collecting stamps.',
        },
        {
          title: 'Hỏi hoạt động yêu thích',
          accent: 'pink',
          content: 'What do you like doing in your free time?',
          example: 'I like listening to music.',
        },
        {
          title: 'Nói lý do',
          accent: 'blue',
          content: 'I like + V-ing + because + S + V.',
          example: 'I like reading books because it is interesting.',
        },
      ],
    },
    {
      id: 's16',
      title: 'Luyện tập nhanh',
      subtitle: 'Hoàn thành câu với dạng đúng.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'She _____ collecting dolls. (love)' },
        { content: 'I enjoy _____ to music. (listen)' },
        { content: 'He does not _____ gardening. (like)' },
        { content: 'Does Lan often _____ models? (make)' },
      ],
      examples: ['loves', 'listening', 'like', 'make'],
    },
    {
      id: 's17',
      title: 'Unit 1 Recap',
      subtitle: 'My Hobbies',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Verbs of liking thường đi với V-ing.' },
        { content: 'Be interested in đi với V-ing hoặc danh từ.' },
        { content: 'Present Simple dùng cho thói quen, sở thích và việc lặp lại.' },
        { content: 'He / she / it thêm -s / -es trong câu khẳng định.' },
      ],
      examples: [
        'She loves making models.',
        'Do you like playing badminton?',
        'He collects stamps every weekend.',
      ],
    },
  ],
};

export default deck;

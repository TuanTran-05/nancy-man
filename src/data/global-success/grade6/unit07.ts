import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g6-u7-television',
  curriculumFamily: 'global-success',
  grade: 6,
  unitNumber: 7,
  title: 'Grammar Grade 6 - Unit 7: Television',
  description:
    'Bài giảng Unit 7 Global Success 6 về Wh-questions, conjunctions and / but / so và từ vựng Television.',
  createdAt: '2026-05-17T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 6',
      subtitle: 'UNIT 7: TELEVISION',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'WH-QUESTIONS',
          subtitle: '(Câu hỏi với từ để hỏi)',
          accent: 'orange',
        },
        {
          title: 'QUESTION PATTERNS',
          subtitle: '(be / do / does / can)',
          accent: 'pink',
        },
        {
          title: 'AND, BUT, SO',
          subtitle: '(Liên từ cơ bản)',
          accent: 'blue',
        },
        {
          title: 'TELEVISION',
          subtitle: '(Từ vựng và luyện tập)',
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
            { text: 'Dùng đúng các từ hỏi như ' },
            { text: 'what, where, when, who, why, how', accent: 'orange', bold: true },
            { text: '.' },
          ],
        },
        {
          content: 'Đặt câu hỏi Wh- với be, do, does và can theo đúng trật tự từ.',
        },
        {
          content: [
            { text: 'Phân biệt ' },
            { text: 'and', accent: 'pink', bold: true },
            { text: ', ' },
            { text: 'but', accent: 'blue', bold: true },
            { text: ' và ' },
            { text: 'so', accent: 'green', bold: true },
            { text: ' khi nối ý.' },
          ],
        },
        {
          content: 'Hỏi và trả lời về chương trình TV bằng từ vựng trong Unit 7.',
        },
      ],
    },
    {
      id: 's3',
      title: 'WH-QUESTIONS',
      subtitle: 'Câu hỏi với từ để hỏi',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Các từ để hỏi thông dụng',
      subtitle: 'Mỗi Wh-word hỏi một loại thông tin khác nhau.',
      layout: 'cards',
      cards: [
        {
          title: 'Thông tin cơ bản',
          accent: 'orange',
          bullets: ['what: cái gì', 'where: ở đâu', 'when: khi nào'],
        },
        {
          title: 'Người và lý do',
          accent: 'pink',
          bullets: ['who: ai', 'why: tại sao'],
        },
        {
          title: 'Cách thức',
          accent: 'blue',
          bullets: ['how: như thế nào', 'how often: bao lâu một lần'],
        },
        {
          title: 'Số lượng',
          accent: 'green',
          bullets: ['how many: bao nhiêu đếm được', 'how much: bao nhiêu không đếm được'],
        },
      ],
    },
    {
      id: 's5',
      title: 'Wh-question với be',
      subtitle: 'Dùng khi động từ chính trong câu là am / is / are.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Công thức',
          accent: 'orange',
          content: [
            { text: 'Wh-word + ' },
            { text: 'am / is / are + S', accent: 'orange', bold: true },
            { text: ' + ...?' },
          ],
          example: 'What is your favourite programme?',
        },
        {
          title: 'Hỏi thời gian',
          accent: 'blue',
          content: 'When + is + S + on?',
          example: 'When is the cartoon on?',
        },
        {
          title: 'Hỏi người',
          accent: 'green',
          content: 'Who + is + S?',
          example: 'Who is your favourite TV character?',
        },
      ],
    },
    {
      id: 's6',
      title: 'Wh-question với động từ thường',
      subtitle: 'Dùng do với I/you/we/they và does với he/she/it.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Với do',
          accent: 'green',
          content: [
            { text: 'Wh-word + ' },
            { text: 'do + S + V nguyên mẫu', accent: 'green', bold: true },
            { text: '?' },
          ],
          example: 'What do you watch on TV?',
        },
        {
          title: 'Với does',
          accent: 'pink',
          content: [
            { text: 'Wh-word + ' },
            { text: 'does + S + V nguyên mẫu', accent: 'pink', bold: true },
            { text: '?' },
          ],
          example: 'Why does he like game shows?',
        },
        {
          title: 'Ghi nhớ',
          accent: 'red',
          bullets: [
            'Sau does, động từ chính không thêm -s / -es.',
            'does watch, không phải does watches',
          ],
        },
      ],
    },
    {
      id: 's7',
      title: 'Wh-question với can',
      subtitle: 'Hỏi điều có thể làm hoặc có thể xem.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'Công thức',
          accent: 'blue',
          content: [
            { text: 'Wh-word + ' },
            { text: 'can + S + V nguyên mẫu', accent: 'blue', bold: true },
            { text: '?' },
          ],
          example: 'What can you see on this channel?',
        },
        {
          title: 'Ví dụ thêm',
          accent: 'green',
          bullets: [
            'Where can we watch this programme?',
            'How can children learn from educational shows?',
          ],
        },
      ],
    },
    {
      id: 's8',
      title: 'What, Why, When, How often',
      subtitle: 'Một số cặp rất dễ nhầm khi đặt câu hỏi.',
      layout: 'cards',
      cards: [
        {
          title: 'WHAT',
          accent: 'orange',
          bullets: ['Hỏi cái gì', 'What do you watch?'],
        },
        {
          title: 'WHY',
          accent: 'pink',
          bullets: ['Hỏi lý do', 'Trả lời thường bắt đầu bằng because'],
        },
        {
          title: 'WHEN',
          accent: 'blue',
          bullets: ['Hỏi thời gian cụ thể', 'When is the programme on?'],
        },
        {
          title: 'HOW OFTEN',
          accent: 'green',
          bullets: ['Hỏi tần suất', 'every day, twice a week'],
        },
      ],
    },
    {
      id: 's9',
      title: 'Lỗi thường gặp với Wh-questions',
      subtitle: 'Wh-question cần thông tin cụ thể, không chỉ Yes / No.',
      layout: 'cards',
      cards: [
        {
          title: 'Sau does',
          accent: 'red',
          bullets: ['Sai: What does he watches?', 'Đúng: What does he watch?'],
        },
        {
          title: 'Câu trả lời',
          accent: 'orange',
          bullets: ['Sai: What do you watch? - Yes.', 'Đúng: I watch cartoons.'],
        },
        {
          title: 'When vs How often',
          accent: 'blue',
          bullets: ['When = thời gian cụ thể', 'How often = tần suất'],
        },
      ],
    },
    {
      id: 's10',
      title: 'AND, BUT, SO',
      subtitle: 'Liên từ cơ bản',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's11',
      title: 'Ba liên từ cần nhớ',
      subtitle: 'Chọn liên từ theo quan hệ giữa hai ý.',
      layout: 'cards',
      cards: [
        {
          title: 'AND',
          accent: 'green',
          bullets: ['Thêm thông tin', 'Nối ý cùng chiều'],
          example: 'I like cartoons and comedies.',
        },
        {
          title: 'BUT',
          accent: 'pink',
          bullets: ['Nối hai ý trái ngược'],
          example: 'The film is good, but it is long.',
        },
        {
          title: 'SO',
          accent: 'blue',
          bullets: ['Nối nguyên nhân với kết quả'],
          example: 'The cartoon is funny, so children love it.',
        },
      ],
    },
    {
      id: 's12',
      title: 'Dùng and, but, so đúng',
      subtitle: 'Xác định quan hệ giữa hai mệnh đề trước khi chọn.',
      layout: 'cards',
      cards: [
        {
          title: 'AND',
          accent: 'green',
          bullets: ['funny and educational', 'watches TV and listens to music'],
        },
        {
          title: 'BUT',
          accent: 'pink',
          bullets: ['interesting but long', 'wants to watch TV but has homework'],
        },
        {
          title: 'SO',
          accent: 'blue',
          bullets: ['It is funny, so I like it.', 'I am tired, so I go to bed early.'],
        },
        {
          title: 'Lưu ý',
          accent: 'red',
          bullets: ['Không dùng and cho ý trái ngược.', 'So đứng trước kết quả.'],
        },
      ],
    },
    {
      id: 's13',
      title: 'TELEVISION',
      subtitle: 'Từ vựng chủ đề truyền hình',
      label: 'Phần 3',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's14',
      title: 'Television Vocabulary',
      subtitle: 'Các nhóm từ xuất hiện nhiều trong Unit 7.',
      layout: 'cards',
      cards: [
        {
          title: 'Programmes',
          accent: 'orange',
          bullets: ['cartoon', 'comedy', 'game show', 'news'],
        },
        {
          title: 'More programmes',
          accent: 'pink',
          bullets: ['sports programme', 'animal programme', 'talent show', 'music show'],
        },
        {
          title: 'TV words',
          accent: 'blue',
          bullets: ['channel', 'viewer', 'character', 'host'],
        },
        {
          title: 'Adjectives',
          accent: 'green',
          bullets: ['funny', 'interesting', 'boring', 'educational'],
        },
      ],
    },
    {
      id: 's15',
      title: 'Kết hợp cấu trúc',
      subtitle: 'Dùng câu hỏi và liên từ trong ngữ cảnh truyền hình.',
      layout: 'explain',
      accent: 'purple',
      sections: [
        {
          title: 'Mẫu hỏi',
          accent: 'orange',
          content: 'Why do you like cartoons?',
          example: 'Because they are funny and educational.',
        },
        {
          title: 'Mẫu đối lập',
          accent: 'pink',
          content: 'The programme is interesting, but it starts late.',
        },
        {
          title: 'Mẫu kết quả',
          accent: 'blue',
          content: 'The cartoon is funny, so many children like it.',
        },
      ],
    },
    {
      id: 's16',
      title: 'Luyện tập nhanh',
      subtitle: 'Hoàn thành câu với từ hỏi hoặc liên từ phù hợp.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: '_____ is your favourite TV programme?' },
        { content: '_____ does Lan watch the news? - Every evening.' },
        { content: 'The film is interesting, _____ it is very long.' },
        { content: 'The show is funny, _____ many children like it.' },
      ],
      examples: ['What', 'How often', 'but', 'so'],
    },
    {
      id: 's17',
      title: 'Unit 7 Recap',
      subtitle: 'Television',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Wh-question hỏi thông tin cụ thể: what, where, when, who, why, how.' },
        { content: 'Sau do / does, động từ chính giữ nguyên mẫu.' },
        { content: 'And thêm ý, but nối ý trái ngược, so chỉ kết quả.' },
        { content: 'Từ vựng TV giúp hỏi và mô tả chương trình yêu thích.' },
      ],
      examples: [
        'What do you watch?',
        'The show is funny, but it is long.',
        'It is educational, so I like it.',
      ],
    },
  ],
};

export default deck;

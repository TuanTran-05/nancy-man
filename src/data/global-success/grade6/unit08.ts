import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g6-u8-sports-games',
  curriculumFamily: 'global-success',
  grade: 6,
  unitNumber: 8,
  title: 'Grammar Grade 6 - Unit 8: Sports and Games',
  description:
    'Bài giảng Unit 8 Global Success 6 về Past Simple, Imperatives và từ vựng Sports and Games.',
  createdAt: '2026-05-16T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 6',
      subtitle: 'UNIT 8: SPORTS AND GAMES',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'THE PAST SIMPLE',
          subtitle: '(Thì quá khứ đơn)',
          accent: 'orange',
        },
        {
          title: 'IMPERATIVES',
          subtitle: '(Câu mệnh lệnh)',
          accent: 'pink',
        },
        {
          title: 'PLAY, DO, GO',
          subtitle: '(Dùng với môn thể thao)',
          accent: 'blue',
        },
        {
          title: 'SPORTS VOCABULARY',
          subtitle: '(Từ vựng thể thao và trò chơi)',
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
            { text: 'Past Simple', accent: 'orange', bold: true },
            { text: ' để kể hoạt động thể thao đã xảy ra.' },
          ],
        },
        {
          content: [
            { text: 'Phân biệt ' },
            { text: 'was/were', accent: 'blue', bold: true },
            { text: ' và động từ quá khứ ' },
            { text: 'V-ed/V2', accent: 'pink', bold: true },
            { text: '.' },
          ],
        },
        {
          content: [
            { text: 'Dùng câu mệnh lệnh: ' },
            { text: 'V...', accent: 'green', bold: true },
            { text: ' / ' },
            { text: 'Do not + V', accent: 'red', bold: true },
            { text: ' để nói luật chơi.' },
          ],
        },
        {
          content: 'Chọn đúng play, do, go khi nói về môn thể thao và hoạt động vận động.',
        },
      ],
    },
    {
      id: 's3',
      title: 'THE PAST SIMPLE',
      subtitle: 'Thì quá khứ đơn',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Past Simple: was / were',
      subtitle: 'Dùng was/were khi câu không có động từ hành động chính.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: [
            { text: 'I/He/She/It + ' },
            { text: 'was', accent: 'green', bold: true },
            { text: ' | We/You/They + ' },
            { text: 'were', accent: 'green', bold: true },
          ],
          example: 'I was at the stadium yesterday.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: [{ text: 'S + ' }, { text: 'was not / were not', accent: 'red', bold: true }],
          example: 'They were not tired after the game.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: [
            { text: 'Was/Were + ' },
            { text: 'S', accent: 'blue', bold: true },
            { text: ' + ...?' },
          ],
          example: 'Were you at the sports centre last Sunday?',
        },
      ],
      examples: ['Yes, I was.', 'No, they were not.'],
    },
    {
      id: 's5',
      title: 'Past Simple: động từ hành động',
      subtitle: 'Kể lại việc đã xảy ra và đã kết thúc trong quá khứ.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: [{ text: 'S + ' }, { text: 'V-ed / V2', accent: 'green', bold: true }],
          example: 'Our team won the match last week.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: [
            { text: 'S + ' },
            { text: 'did not + V nguyên mẫu', accent: 'red', bold: true },
          ],
          example: 'We did not play badminton yesterday.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: [
            { text: 'Did + S + ' },
            { text: 'V nguyên mẫu', accent: 'blue', bold: true },
            { text: '?' },
          ],
          example: 'Did you watch the football match?',
        },
      ],
      examples: ['Yes, I did.', 'No, she did not.'],
    },
    {
      id: 's6',
      title: 'Dấu hiệu và động từ quá khứ',
      subtitle: 'Nhìn trạng từ thời gian để nhận ra Past Simple.',
      layout: 'cards',
      cards: [
        {
          title: 'Dấu hiệu',
          accent: 'orange',
          bullets: ['yesterday', 'last night / last week', 'two days ago', 'in 2020'],
        },
        {
          title: 'Thêm -ed',
          accent: 'blue',
          bullets: ['play -> played', 'dance -> danced', 'study -> studied', 'stop -> stopped'],
        },
        {
          title: 'Động từ bất quy tắc',
          accent: 'pink',
          bullets: ['win -> won', 'run -> ran', 'swim -> swam', 'ride -> rode'],
        },
        {
          title: 'Nhớ quy tắc',
          accent: 'green',
          bullets: [
            'Did đi với V nguyên mẫu.',
            'Không thêm -ed sau did.',
            'Was/were không đi với did.',
          ],
        },
      ],
    },
    {
      id: 's7',
      title: 'IMPERATIVES',
      subtitle: 'Câu mệnh lệnh',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's8',
      title: 'Imperatives: nói luật chơi',
      subtitle: 'Dùng động từ nguyên mẫu để hướng dẫn hoặc yêu cầu.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Mệnh lệnh khẳng định',
          accent: 'green',
          content: [{ text: 'V nguyên mẫu + ...', accent: 'green', bold: true }],
          example: 'Pass the ball quickly.',
        },
        {
          title: 'Mệnh lệnh phủ định',
          accent: 'red',
          content: [{ text: 'Do not + ' }, { text: 'V nguyên mẫu', accent: 'red', bold: true }],
          example: 'Do not touch the ball with your hands.',
        },
        {
          title: 'Lịch sự hơn',
          accent: 'blue',
          bullets: ['Please stand in line.', 'Let us start the game.'],
        },
      ],
      footerNote: 'Trong luật chơi, câu mệnh lệnh thường ngắn, rõ và bắt đầu bằng động từ.',
    },
    {
      id: 's9',
      title: 'Play, Do, Go',
      subtitle: 'Chọn động từ đúng với từng loại hoạt động.',
      layout: 'cards',
      cards: [
        {
          title: 'PLAY',
          accent: 'red',
          bullets: ['Môn dùng bóng', 'Môn thi đấu đội', 'Nhạc cụ / game'],
          example: 'play football, play chess',
        },
        {
          title: 'DO',
          accent: 'blue',
          bullets: ['Bài tập', 'Võ thuật', 'Hoạt động không dùng bóng'],
          example: 'do karate, do exercise',
        },
        {
          title: 'GO',
          accent: 'green',
          bullets: ['Hoạt động kết thúc bằng -ing', 'Di chuyển hoặc vận động ngoài trời'],
          example: 'go swimming, go cycling',
        },
        {
          title: 'Nơi chốn',
          accent: 'purple',
          bullets: ['stadium', 'sports centre', 'swimming pool', 'court'],
        },
      ],
    },
    {
      id: 's10',
      title: 'Luyện tập nhanh',
      subtitle: 'Hoàn thành câu với dạng đúng.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'Yesterday, I _____ (play) basketball after school.' },
        { content: '_____ you watch the match last night?' },
        { content: 'Do not _____ (run) near the swimming pool.' },
        { content: 'We usually _____ swimming on Sundays.' },
      ],
      examples: ['played', 'Did', 'run', 'go'],
    },
    {
      id: 's11',
      title: 'Unit 8 Recap',
      subtitle: 'Sports and Games',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Past Simple: S + V-ed/V2; S + did not + V; Did + S + V?' },
        { content: 'Was/were dùng cho trạng thái trong quá khứ.' },
        { content: 'Imperatives dùng để hướng dẫn và nói luật chơi.' },
        { content: 'Play, do, go đi với các nhóm hoạt động khác nhau.' },
      ],
      examples: ['I won the game.', 'Do not push.', 'go jogging'],
    },
  ],
};

export default deck;

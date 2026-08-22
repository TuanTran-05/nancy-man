import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g7-u4-music-arts',
  curriculumFamily: 'global-success',
  grade: 7,
  unitNumber: 4,
  title: 'Grammar Grade 7 - Unit 4: Music and Arts',
  description:
    'Bài giảng Unit 4 Global Success 7 về like / different from, (not) as...as và từ vựng Music and Arts.',
  createdAt: '2026-05-17T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 7',
      subtitle: 'UNIT 4: MUSIC AND ARTS',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'LIKE',
          subtitle: '(Giống như)',
          accent: 'orange',
        },
        {
          title: 'DIFFERENT FROM',
          subtitle: '(Khác với)',
          accent: 'pink',
        },
        {
          title: '(NOT) AS... AS',
          subtitle: '(Ngang bằng / không ngang bằng)',
          accent: 'blue',
        },
        {
          title: 'MUSIC AND ARTS',
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
          content: [
            { text: 'Dùng ' },
            { text: 'be like', accent: 'orange', bold: true },
            { text: ' để nói hai đối tượng giống nhau.' },
          ],
        },
        {
          content: [
            { text: 'Dùng ' },
            { text: 'be different from', accent: 'pink', bold: true },
            { text: ' để nói hai đối tượng khác nhau.' },
          ],
        },
        {
          content: [
            { text: 'So sánh ngang bằng với ' },
            { text: 'as...as', accent: 'blue', bold: true },
            { text: ' và không ngang bằng với ' },
            { text: 'not as...as', accent: 'green', bold: true },
            { text: '.' },
          ],
        },
        {
          content: 'Mô tả âm nhạc, tác phẩm nghệ thuật và người biểu diễn bằng từ vựng Unit 4.',
        },
      ],
    },
    {
      id: 's3',
      title: 'LIKE & DIFFERENT FROM',
      subtitle: 'Giống và khác với',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Like trong so sánh',
      subtitle: 'Like ở đây nghĩa là giống như, không phải thích.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Công thức',
          accent: 'orange',
          content: 'S + be + like + N / pronoun',
          example: 'This song is like that song.',
        },
        {
          title: 'So sánh sự giống nhau',
          accent: 'green',
          bullets: ['Your painting is like my painting.', 'This music video is like a short film.'],
        },
        {
          title: 'Không nhầm nghĩa',
          accent: 'blue',
          bullets: ['This song is like that song. = giống', 'I like this song. = thích'],
        },
      ],
    },
    {
      id: 's5',
      title: 'Different from',
      subtitle: 'Dùng để nói hai người hoặc vật không giống nhau.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Công thức',
          accent: 'pink',
          content: 'S + be + different from + N / pronoun',
          example: 'Classical music is different from rock music.',
        },
        {
          title: 'Ví dụ',
          accent: 'blue',
          bullets: ['My drawing is different from yours.', 'A piano is different from a guitar.'],
        },
        {
          title: 'Lưu ý',
          accent: 'red',
          bullets: ['Dùng different from, không dùng different than.'],
        },
      ],
    },
    {
      id: 's6',
      title: 'Like vs Different from',
      subtitle: 'Chọn theo quan hệ giống hay khác.',
      layout: 'cards',
      cards: [
        {
          title: 'BE LIKE',
          accent: 'orange',
          bullets: ['Giống nhau', 'This painting is like mine.'],
        },
        {
          title: 'BE DIFFERENT FROM',
          accent: 'pink',
          bullets: ['Khác nhau', 'This painting is different from mine.'],
        },
        {
          title: 'Đại từ sở hữu',
          accent: 'blue',
          bullets: ['mine', 'yours', 'his', 'hers', 'ours', 'theirs'],
        },
      ],
    },
    {
      id: 's7',
      title: 'Các dạng câu',
      subtitle: 'Cả hai cấu trúc đều dùng động từ be.',
      layout: 'cards',
      cards: [
        {
          title: 'Khẳng định',
          accent: 'green',
          bullets: ['This song is like that song.', 'Rock is different from folk music.'],
        },
        {
          title: 'Phủ định',
          accent: 'red',
          bullets: ['This song is not like that one.', 'My picture is not different from yours.'],
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          bullets: ['Is this song like that one?', 'Is rap different from pop music?'],
        },
      ],
    },
    {
      id: 's8',
      title: '(NOT) AS... AS',
      subtitle: 'So sánh ngang bằng / không ngang bằng',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's9',
      title: 'As...as với tính từ',
      subtitle: 'Giữa hai as dùng tính từ nguyên mẫu.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'Công thức',
          accent: 'blue',
          content: 'S + be + as + adjective + as + N / pronoun',
          example: 'This song is as good as that song.',
        },
        {
          title: 'Ví dụ',
          accent: 'green',
          bullets: [
            'Her painting is as beautiful as mine.',
            'The violin is as expensive as the guitar.',
          ],
        },
        {
          title: 'Nhớ',
          accent: 'orange',
          bullets: ['good, beautiful, colourful giữ nguyên dạng gốc'],
        },
      ],
    },
    {
      id: 's10',
      title: 'Not as...as',
      subtitle: 'Dùng để nói một đối tượng không bằng đối tượng khác.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Công thức',
          accent: 'pink',
          content: 'S + be not + as + adjective + as + N / pronoun',
          example: 'This song is not as good as that song.',
        },
        {
          title: 'Dạng rút gọn',
          accent: 'blue',
          bullets: ['is not -> is not / is not', 'are not -> are not', 'was not / were not'],
        },
        {
          title: 'Ví dụ',
          accent: 'red',
          bullets: [
            'My drawing is not as beautiful as yours.',
            'The guitar is not as expensive as the piano.',
          ],
        },
      ],
    },
    {
      id: 's11',
      title: 'As...as với động từ thường',
      subtitle: 'Khi so sánh cách làm, dùng trạng từ.',
      layout: 'explain',
      accent: 'green',
      sections: [
        {
          title: 'Công thức',
          accent: 'green',
          content: 'S + V + as + adverb + as + N / pronoun',
          example: 'She sings as beautifully as her sister.',
        },
        {
          title: 'Good vs Well',
          accent: 'orange',
          bullets: ['good = tính từ', 'well = trạng từ'],
        },
        {
          title: 'Ví dụ',
          accent: 'blue',
          bullets: [
            'He plays the piano as well as his teacher.',
            'They dance as gracefully as professional dancers.',
          ],
        },
      ],
    },
    {
      id: 's12',
      title: 'As...as vs Comparative',
      subtitle: 'Ba cách so sánh cho ba mức độ khác nhau.',
      layout: 'cards',
      cards: [
        {
          title: 'As...as',
          accent: 'green',
          bullets: ['Ngang bằng', 'This song is as good as that song.'],
        },
        {
          title: 'Not as...as',
          accent: 'pink',
          bullets: ['Không ngang bằng', 'This song is not as good as that song.'],
        },
        {
          title: 'Comparative',
          accent: 'blue',
          bullets: ['So sánh hơn', 'This song is better than that song.'],
        },
      ],
    },
    {
      id: 's13',
      title: 'Lỗi thường gặp',
      subtitle: 'Kiểm tra đúng dạng từ ở giữa hai as.',
      layout: 'cards',
      cards: [
        {
          title: 'Không dùng comparative',
          accent: 'red',
          bullets: ['Sai: as better as', 'Đúng: as good as'],
        },
        {
          title: 'Không quên as thứ hai',
          accent: 'orange',
          bullets: ['Sai: as good that song', 'Đúng: as good as that song'],
        },
        {
          title: 'Adverb',
          accent: 'blue',
          bullets: ['Sai: sings as beautiful as', 'Đúng: sings as beautifully as'],
        },
      ],
    },
    {
      id: 's14',
      title: 'MUSIC AND ARTS',
      subtitle: 'Từ vựng chủ đề âm nhạc và nghệ thuật',
      label: 'Phần 3',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's15',
      title: 'Music and Arts Vocabulary',
      subtitle: 'Những nhóm từ quan trọng trong Unit 4.',
      layout: 'cards',
      cards: [
        {
          title: 'Art forms',
          accent: 'orange',
          bullets: ['painting', 'drawing', 'sculpture', 'photography'],
        },
        {
          title: 'Music genres',
          accent: 'pink',
          bullets: ['pop music', 'rock music', 'classical music', 'folk music'],
        },
        {
          title: 'Instruments',
          accent: 'blue',
          bullets: ['guitar', 'piano', 'violin', 'drum'],
        },
        {
          title: 'People & adjectives',
          accent: 'green',
          bullets: ['artist', 'singer', 'musician', 'creative'],
        },
      ],
    },
    {
      id: 's16',
      title: 'Giao tiếp thường gặp',
      subtitle: 'Các mẫu câu cần dùng khi so sánh tác phẩm nghệ thuật.',
      layout: 'explain',
      accent: 'purple',
      sections: [
        {
          title: 'Giống nhau',
          accent: 'orange',
          content: 'S + be + like + N',
          example: 'Her drawing is like mine.',
        },
        {
          title: 'Khác nhau',
          accent: 'pink',
          content: 'S + be + different from + N',
          example: 'Rock music is different from folk music.',
        },
        {
          title: 'Ngang bằng / không bằng',
          accent: 'blue',
          content: 'S + be + (not) as + adjective + as + N',
          example: 'This show is not as interesting as the concert.',
        },
      ],
    },
    {
      id: 's17',
      title: 'Luyện tập nhanh',
      subtitle: 'Hoàn thành câu với cấu trúc phù hợp.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'This song is _____ that song. (giống)' },
        { content: 'Rock music is _____ classical music. (khác)' },
        { content: 'Her painting is _____ beautiful _____ mine. (ngang bằng)' },
        { content: 'The guitar is not _____ expensive _____ the piano. (không bằng)' },
      ],
      examples: ['like', 'different from', 'as / as', 'as / as'],
    },
    {
      id: 's18',
      title: 'Unit 4 Recap',
      subtitle: 'Music and Arts',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Be like nói sự giống nhau; be different from nói sự khác nhau.' },
        { content: 'As...as diễn tả ngang bằng; not as...as diễn tả không ngang bằng.' },
        { content: 'Giữa as...as dùng tính từ nguyên mẫu, không dùng comparative.' },
        { content: 'Với động từ thường, dùng trạng từ: sings as beautifully as.' },
      ],
      examples: [
        'This song is like that song.',
        'Her painting is as beautiful as mine.',
        'She sings as well as her sister.',
      ],
    },
  ],
};

export default deck;

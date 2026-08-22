import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g6-u9-cities-world',
  curriculumFamily: 'global-success',
  grade: 6,
  unitNumber: 9,
  title: 'Grammar Grade 6 - Unit 9: Cities of the World',
  description:
    'Bài giảng Unit 9 Global Success 6 về possessive adjectives, possessive pronouns, câu cảm thán với What và từ vựng thành phố.',
  createdAt: '2026-05-16T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 6',
      subtitle: 'UNIT 9: CITIES OF THE WORLD',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'POSSESSIVE ADJECTIVES',
          subtitle: '(Tính từ sở hữu)',
          accent: 'orange',
        },
        {
          title: 'POSSESSIVE PRONOUNS',
          subtitle: '(Đại từ sở hữu)',
          accent: 'pink',
        },
        {
          title: 'WHAT EXCLAMATIONS',
          subtitle: '(Câu cảm thán với What)',
          accent: 'blue',
        },
        {
          title: 'CITY VOCABULARY',
          subtitle: '(Từ vựng thành phố)',
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
            { text: 'my, your, his, her, its, our, their', accent: 'orange', bold: true },
            { text: ' trước danh từ.' },
          ],
        },
        {
          content: [
            { text: 'Thay cụm danh từ sở hữu bằng ' },
            { text: 'mine, yours, his, hers, ours, theirs', accent: 'pink', bold: true },
            { text: '.' },
          ],
        },
        {
          content: [
            { text: 'Viết câu cảm thán với ' },
            { text: 'What + noun', accent: 'blue', bold: true },
            { text: ' để mô tả thành phố.' },
          ],
        },
        {
          content: 'Mô tả một thành phố yêu thích bằng từ vựng và cấu trúc trong Unit 9.',
        },
      ],
    },
    {
      id: 's3',
      title: 'POSSESSIVE ADJECTIVES',
      subtitle: 'Tính từ sở hữu',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Tính từ sở hữu đứng trước danh từ',
      subtitle: 'Dùng để nói ai sở hữu người hoặc vật nào đó.',
      layout: 'cards',
      cards: [
        {
          title: 'I / You',
          accent: 'orange',
          bullets: ['I -> my', 'You -> your'],
          example: 'This is my map. Is that your camera?',
        },
        {
          title: 'He / She / It',
          accent: 'pink',
          bullets: ['He -> his', 'She -> her', 'It -> its'],
          example: 'Ha Noi is famous for its old streets.',
        },
        {
          title: 'We / They',
          accent: 'blue',
          bullets: ['We -> our', 'They -> their'],
          example: 'Their city is modern. Our city is peaceful.',
        },
        {
          title: 'Vị trí',
          accent: 'green',
          bullets: ['possessive adjective + noun', 'Không đứng một mình'],
          example: 'This is my bag.',
        },
      ],
    },
    {
      id: 's5',
      title: 'Lỗi thường gặp',
      subtitle: 'Tính từ sở hữu không đổi theo số ít hay số nhiều của danh từ.',
      layout: 'cards',
      cards: [
        {
          title: 'Sai vị trí',
          accent: 'red',
          bullets: ['Không nói: This is bag my.', 'Đúng: This is my bag.'],
        },
        {
          title: 'Your / You are',
          accent: 'blue',
          bullets: ['your = của bạn', 'you are = bạn là'],
          example: 'Your city is beautiful.',
        },
        {
          title: 'Their / They are',
          accent: 'purple',
          bullets: ['their = của họ', 'they are = họ là'],
          example: 'Their buildings are tall.',
        },
      ],
    },
    {
      id: 's6',
      title: 'POSSESSIVE PRONOUNS',
      subtitle: 'Đại từ sở hữu',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's7',
      title: 'Đại từ sở hữu thay cho danh từ',
      subtitle: 'Đại từ sở hữu có thể đứng một mình trong câu.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Cặp cần nhớ',
          accent: 'pink',
          bullets: ['my -> mine', 'your -> yours', 'his -> his', 'her -> hers'],
        },
        {
          title: 'Số nhiều',
          accent: 'blue',
          bullets: ['our -> ours', 'their -> theirs'],
          example: 'This guidebook is ours.',
        },
        {
          title: 'Cách dùng',
          accent: 'green',
          content: [
            { text: 'possessive pronoun = ' },
            { text: 'possessive adjective + noun', accent: 'green', bold: true },
          ],
          example: 'This is her postcard. This postcard is hers.',
        },
      ],
      footerNote: 'Its hầu như không dùng như đại từ sở hữu độc lập trong chương trình lớp 6.',
    },
    {
      id: 's8',
      title: 'WHAT EXCLAMATIONS',
      subtitle: 'Câu cảm thán với What',
      label: 'Phần 3',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's9',
      title: 'Cấu trúc câu cảm thán',
      subtitle: 'Dùng What để nhấn mạnh danh từ trong câu.',
      layout: 'cards',
      cards: [
        {
          title: 'Danh từ số ít',
          accent: 'orange',
          content: 'What + a/an + adjective + singular noun!',
          example: 'What a beautiful city!',
        },
        {
          title: 'Danh từ số nhiều',
          accent: 'blue',
          content: 'What + adjective + plural noun!',
          example: 'What exciting cities!',
        },
        {
          title: 'Danh từ không đếm được',
          accent: 'green',
          content: 'What + adjective + uncountable noun!',
          example: 'What beautiful weather!',
        },
        {
          title: 'What vs How',
          accent: 'purple',
          bullets: ['What đi với danh từ.', 'How đi với tính từ hoặc trạng từ.'],
          example: 'How beautiful!',
        },
      ],
    },
    {
      id: 's10',
      title: 'City Vocabulary',
      subtitle: 'Từ vựng để mô tả thành phố trên thế giới.',
      layout: 'cards',
      cards: [
        {
          title: 'Places',
          accent: 'blue',
          bullets: ['city', 'town', 'capital', 'city centre'],
        },
        {
          title: 'Positive adjectives',
          accent: 'green',
          bullets: ['beautiful', 'amazing', 'wonderful', 'exciting'],
        },
        {
          title: 'Other adjectives',
          accent: 'red',
          bullets: ['crowded', 'noisy', 'peaceful', 'modern'],
        },
        {
          title: 'Verbs',
          accent: 'purple',
          bullets: ['visit', 'explore', 'travel to', 'live in'],
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
        { content: 'This is _____ camera. It belongs to me.' },
        { content: 'That postcard is not ours. It is _____.' },
        { content: '_____ a wonderful capital city!' },
        { content: 'Ho Chi Minh City is famous for _____ busy streets.' },
      ],
      examples: ['my', 'theirs / hers / his', 'What', 'its'],
    },
    {
      id: 's12',
      title: 'Unit 9 Recap',
      subtitle: 'Cities of the World',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Tính từ sở hữu đứng trước danh từ: my city, their streets.' },
        { content: 'Đại từ sở hữu đứng một mình: mine, yours, ours.' },
        { content: 'What + noun dùng để viết câu cảm thán.' },
        { content: 'Từ vựng thành phố giúp mô tả nơi chốn, cảm xúc và trải nghiệm.' },
      ],
      examples: ['What an amazing city!', 'This map is mine.'],
    },
  ],
};

export default deck;

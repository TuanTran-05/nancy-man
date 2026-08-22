import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g6-u4-my-neighbourhood',
  curriculumFamily: 'global-success',
  grade: 6,
  unitNumber: 4,
  title: 'Grammar Grade 6 - Unit 4: My Neighbourhood',
  description:
    'Bài giảng Unit 4 Global Success 6 về comparative adjectives và từ vựng My Neighbourhood.',
  createdAt: '2026-05-17T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 6',
      subtitle: 'UNIT 4: MY NEIGHBOURHOOD',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'COMPARATIVE ADJECTIVES',
          subtitle: '(Tính từ so sánh hơn)',
          accent: 'orange',
        },
        {
          title: 'SPELLING RULES',
          subtitle: '(-er / more / dạng đặc biệt)',
          accent: 'pink',
        },
        {
          title: 'SENTENCE PATTERNS',
          subtitle: '(Khẳng định, phủ định, nghi vấn)',
          accent: 'blue',
        },
        {
          title: 'MY NEIGHBOURHOOD',
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
            { text: 'Dùng ' },
            { text: 'comparative adjectives', accent: 'orange', bold: true },
            { text: ' để so sánh hai địa điểm, người hoặc vật.' },
          ],
        },
        {
          content: [
            { text: 'Chọn đúng dạng ' },
            { text: 'adj-er', accent: 'pink', bold: true },
            { text: ' hoặc ' },
            { text: 'more + adjective', accent: 'green', bold: true },
            { text: '.' },
          ],
        },
        {
          content:
            'Nhận biết các quy tắc chính tả: thêm -er, thêm -r, gấp đôi phụ âm, đổi y thành i.',
        },
        {
          content: 'Dùng từ vựng khu phố để so sánh đường phố, cửa hàng và địa điểm quen thuộc.',
        },
      ],
    },
    {
      id: 's3',
      title: 'COMPARATIVE ADJECTIVES',
      subtitle: 'Tính từ so sánh hơn',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Hai công thức chính',
      subtitle: 'So sánh hai đối tượng với nhau bằng than.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Tính từ ngắn',
          accent: 'orange',
          content: [
            { text: 'S + be + ' },
            { text: 'short adjective-er', accent: 'orange', bold: true },
            { text: ' + than + N' },
          ],
          example: 'This road is wider than that road.',
        },
        {
          title: 'Tính từ dài',
          accent: 'pink',
          content: [
            { text: 'S + be + ' },
            { text: 'more + long adjective', accent: 'pink', bold: true },
            { text: ' + than + N' },
          ],
          example: 'This neighbourhood is more peaceful than the city centre.',
        },
        {
          title: 'Dấu hiệu nhận biết',
          accent: 'blue',
          content: [
            { text: 'Câu so sánh hơn thường có từ ' },
            { text: 'than', accent: 'blue', bold: true },
            { text: ' = hơn.' },
          ],
          example: 'The park is cleaner than the market.',
        },
      ],
    },
    {
      id: 's5',
      title: 'Cách thành lập: nhóm 1',
      subtitle: 'Các quy tắc thường gặp với tính từ ngắn.',
      layout: 'cards',
      cards: [
        {
          title: 'Thêm -er',
          accent: 'orange',
          bullets: ['small -> smaller', 'clean -> cleaner', 'quiet -> quieter'],
        },
        {
          title: 'Kết thúc bằng -e',
          accent: 'blue',
          bullets: ['large -> larger', 'wide -> wider', 'safe -> safer'],
        },
        {
          title: 'Phụ âm + y',
          accent: 'green',
          bullets: ['noisy -> noisier', 'busy -> busier', 'easy -> easier'],
        },
      ],
    },
    {
      id: 's6',
      title: 'Cách thành lập: nhóm 2',
      subtitle: 'Ba nhóm dễ nhầm nhất khi làm bài.',
      layout: 'cards',
      cards: [
        {
          title: '1 nguyên âm + 1 phụ âm',
          accent: 'pink',
          bullets: ['big -> bigger', 'hot -> hotter', 'thin -> thinner'],
        },
        {
          title: 'Tính từ dài',
          accent: 'purple',
          bullets: [
            'beautiful -> more beautiful',
            'modern -> more modern',
            'peaceful -> more peaceful',
          ],
        },
        {
          title: 'Bất quy tắc',
          accent: 'red',
          bullets: ['good -> better', 'bad -> worse', 'far -> farther / further'],
        },
      ],
    },
    {
      id: 's7',
      title: 'Các dạng câu',
      subtitle: 'Giữ nguyên động từ be khi chuyển sang phủ định hoặc nghi vấn.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: 'S + be + comparative adjective + than + N',
          example: 'The park is cleaner than the market.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: 'S + be not + comparative adjective + than + N',
          example: 'My house is not bigger than your house.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: 'Be + S + comparative adjective + than + N?',
          example: 'Is your neighbourhood quieter than mine?',
        },
        {
          title: 'Trả lời ngắn',
          accent: 'purple',
          bullets: ['Yes, it is.', 'No, it is not.'],
        },
      ],
    },
    {
      id: 's8',
      title: 'Dùng trong Unit 4',
      subtitle: 'Comparatives giúp mô tả khu phố rõ hơn.',
      layout: 'cards',
      cards: [
        {
          title: 'So sánh địa điểm',
          accent: 'orange',
          bullets: ['The park is cleaner than the market.', 'The cinema is larger than the café.'],
        },
        {
          title: 'So sánh vật',
          accent: 'blue',
          bullets: [
            'This shop is cheaper than that shop.',
            'The new bridge is wider than the old bridge.',
          ],
        },
        {
          title: 'So sánh mức độ',
          accent: 'green',
          bullets: [
            'The main road is noisier than my street.',
            'The supermarket is more convenient than the small shop.',
          ],
        },
      ],
    },
    {
      id: 's9',
      title: 'Lỗi thường gặp',
      subtitle: 'Kiểm tra dạng tính từ trước khi đặt câu.',
      layout: 'cards',
      cards: [
        {
          title: 'Không dùng more + -er',
          accent: 'red',
          bullets: ['Sai: more wider', 'Đúng: wider'],
        },
        {
          title: 'Không quên than',
          accent: 'orange',
          bullets: ['Sai: cleaner the market', 'Đúng: cleaner than the market'],
        },
        {
          title: 'Chính tả',
          accent: 'blue',
          bullets: ['biger -> bigger', 'noisyer -> noisier', 'beautifuler -> more beautiful'],
        },
      ],
    },
    {
      id: 's10',
      title: 'MY NEIGHBOURHOOD',
      subtitle: 'Từ vựng chủ đề khu phố',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's11',
      title: 'Places in the Neighbourhood',
      subtitle: 'Những địa điểm thường gặp trong Unit 4.',
      layout: 'cards',
      cards: [
        {
          title: 'Around town',
          accent: 'blue',
          bullets: ['street', 'park', 'market', 'school'],
        },
        {
          title: 'Shops & food',
          accent: 'orange',
          bullets: ['supermarket', 'restaurant', 'café', 'shopping mall'],
        },
        {
          title: 'Services',
          accent: 'green',
          bullets: ['hospital', 'post office', 'pharmacy', 'bus stop'],
        },
        {
          title: 'Culture',
          accent: 'purple',
          bullets: ['cinema', 'museum', 'neighbourhood'],
        },
      ],
    },
    {
      id: 's12',
      title: 'Adjectives for Places',
      subtitle: 'Các tính từ rất hay dùng khi so sánh khu phố.',
      layout: 'cards',
      cards: [
        {
          title: 'Short adjectives',
          accent: 'orange',
          bullets: ['quiet -> quieter', 'clean -> cleaner', 'wide -> wider', 'safe -> safer'],
        },
        {
          title: 'Busy places',
          accent: 'pink',
          bullets: ['noisy -> noisier', 'busy -> busier', 'dirty -> dirtier'],
        },
        {
          title: 'Long adjectives',
          accent: 'blue',
          bullets: ['more expensive', 'more modern', 'more beautiful', 'more peaceful'],
        },
        {
          title: 'Irregular',
          accent: 'green',
          bullets: ['good -> better', 'bad -> worse', 'far -> farther / further'],
        },
      ],
    },
    {
      id: 's13',
      title: 'Luyện tập nhanh',
      subtitle: 'Hoàn thành câu với dạng so sánh hơn đúng.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'This street is _____ than that street. (wide)' },
        { content: 'The market is _____ than the library. (noisy)' },
        { content: 'The supermarket is _____ than the shop. (big)' },
        { content: 'This museum is _____ than the cinema. (interesting)' },
      ],
      examples: ['wider', 'noisier', 'bigger', 'more interesting'],
    },
    {
      id: 's14',
      title: 'Unit 4 Recap',
      subtitle: 'My Neighbourhood',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Tính từ ngắn thường thêm -er: small -> smaller.' },
        { content: 'Tính từ dài dùng more: modern -> more modern.' },
        { content: 'Một số dạng đặc biệt: good -> better, bad -> worse.' },
        { content: 'Câu so sánh hơn thường có than.' },
      ],
      examples: [
        'My neighbourhood is quieter than the city centre.',
        'The shopping mall is more modern than the market.',
      ],
    },
  ],
};

export default deck;
